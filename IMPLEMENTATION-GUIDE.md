# Step-by-Step Implementation Guide

## AWS Full-Stack Deployment with PostgreSQL on EC2 (Amazon Linux)

This guide walks you through implementing the architecture from `Final-Architectural-Diagram.png`. **PostgreSQL is hosted on a dedicated Amazon Linux EC2 instance** instead of RDS; all other components (Node.js app, CI/CD, ALB, CloudFront, etc.) remain as designed. The app runs on a **single EC2 instance** (in an Auto Scaling group for future scaling) using a **golden image (AMI)** with Node.js and CodeDeploy agent pre-installed.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Phase 1: Use Default VPC](#2-phase-1-use-default-vpc)
3. [Phase 2: PostgreSQL on EC2 (Amazon Linux)](#3-phase-2-postgresql-on-ec2-amazon-linux)
4. [Phase 3: IAM Roles & Secrets Manager](#4-phase-3-iam-roles--secrets-manager)
5. [Phase 4: Application EC2 Infrastructure](#5-phase-4-application-ec2-infrastructure)
6. [Phase 5: S3 Buckets](#6-phase-5-s3-buckets)
7. [Phase 6: CI/CD Pipeline](#7-phase-6-cicd-pipeline)
8. [Phase 7: Load Balancer & Auto Scaling](#8-phase-7-load-balancer--auto-scaling)
9. [Phase 8: CloudFront, WAF & Route 53](#9-phase-8-cloudfront-waf--route-53)
10. [Phase 9: Monitoring & Validation](#10-phase-9-monitoring--validation)

---

## 1. Prerequisites

- **AWS Account** with appropriate permissions
- **AWS CLI** installed and configured (`aws configure`)
- **Domain name** (optional, for Route 53)
- **Application code** in the `app/` directory

### Verify AWS CLI

```bash
aws sts get-caller-identity
```

Choose a region (e.g., `us-east-1`) and use it consistently throughout.

---

## 2. Phase 1: Use Default VPC

### Step 2.1: Verify Default VPC Exists

1. **AWS Console** → **VPC** → **Your VPCs**
2. You should see a VPC named **default** with your region's default CIDR (typically `172.31.0.0/16`)
3. If you previously deleted it, recreate via **Actions** → **Create default VPC**

### Step 2.2: Note Default Subnets

- The default VPC includes **public subnets** (one per Availability Zone)
- **VPC** → **Subnets** → Filter by your default VPC
- Note 2+ subnet IDs (e.g., `subnet-xxx` in `us-east-1a`, `subnet-yyy` in `us-east-1b`) for use in later phases
- Default subnets have a route to the Internet Gateway—no NAT Gateway needed

---

## 3. Phase 2: PostgreSQL on EC2 (Amazon Linux)

### Step 3.1: Create Security Group for PostgreSQL

1. **VPC** → **Security Groups** → **Create security group**
2. **Name:** `postgres-sg`
3. **VPC:** **default**
4. **Inbound rules:**
   - Type: **PostgreSQL**, Port: **5432**, Source: **Application security group** (create `app-sg` first in Phase 4 and reference it, or use your default VPC CIDR, e.g. `172.31.0.0/16`)
5. **Outbound:** All traffic (default)
6. Click **Create**

> **Note:** Create `app-sg` in Phase 4 first if you prefer referencing it here. You can edit `postgres-sg` later to allow traffic from `app-sg`.

### Step 3.2: Launch PostgreSQL EC2 Instance

1. **EC2** → **Launch Instance**
2. **Name:** `postgres-db-server`
3. **AMI:** **Amazon Linux 2023**
4. **Instance type:** `t3.micro` (or `t3.small` for production)
5. **Key pair:** Create or select existing
6. **Network settings:**
   - VPC: **default**
   - Subnet: Any **default subnet** (e.g., in `us-east-1a`)
   - Auto-assign public IP: **Disable** (use Session Manager to connect; no SSH needed)
   - Security group: `postgres-sg`
7. **Storage:** 20 GB gp3 (adjust as needed)
8. **Advanced details:**
   - IAM instance profile: Create one with `AmazonSSMManagedInstanceCore` for Session Manager access (no SSH key needed)
9. Click **Launch instance**

### Step 3.3: Connect to PostgreSQL EC2 (via Session Manager or Bastion)

**Option A: Systems Manager Session Manager (recommended)**

1. Ensure the instance has **SSM Agent** (Amazon Linux 2023 has it by default)
2. Attach IAM role with `AmazonSSMManagedInstanceCore`
3. **EC2** → Select instance → **Connect** → **Session Manager** → **Connect**

**Option B: Bastion host**

1. Launch a small EC2 in a default (public) subnet with a key pair
2. SSH into bastion, then SSH to PostgreSQL instance using its private IP

### Step 3.4: Install and Configure PostgreSQL on Amazon Linux 2023

Run these commands on the PostgreSQL EC2 instance:

```bash
# Update system
sudo dnf update -y

# Install PostgreSQL 15
sudo dnf install postgresql15 postgresql15-server -y

# Initialize database
sudo postgresql-setup --initdb

# Start and enable PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Switch to postgres user and configure
sudo -u postgres psql
```

In the PostgreSQL prompt, run these **one at a time** (pasting all at once can cause `\c` to misparse the next line as connection options):

```sql
CREATE DATABASE iyere_app;
CREATE USER iyere_app_user WITH PASSWORD 'YOUR_SECURE_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE iyere_app TO iyere_app_user;
```

Then connect to the new database (run this alone, then press Enter):

```
\c iyere_app
```

After the prompt shows `iyere_app=#`, run:

```sql
GRANT ALL ON SCHEMA public TO iyere_app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO iyere_app_user;
```

Exit with `\q`.

### Step 3.5: Configure PostgreSQL to Accept Connections

Edit `pg_hba.conf` (path may be `.../data/` or `.../15/data/` depending on install):

```bash
sudo vi /var/lib/pgsql/data/pg_hba.conf
```

Add (or modify) to allow connections from the default VPC (replace with your actual VPC CIDR, typically `172.31.0.0/16`):

```
# Allow from default VPC
host    all             all             172.31.0.0/16           scram-sha-256
```

Edit `postgresql.conf`:

```bash
sudo vi /var/lib/pgsql/data/postgresql.conf
```

Set:

```
listen_addresses = '*'
```

Restart PostgreSQL:

```bash
sudo systemctl restart postgresql
```

### Step 3.6: Record PostgreSQL Private IP

Note the **private IP** of the PostgreSQL EC2 instance (e.g., `172.31.x.x`). You will use this in Secrets Manager.

---

## 4. Phase 3: IAM Roles & Secrets Manager

### Step 4.1: Store Database Credentials in Secrets Manager

1. **Secrets Manager** → **Store a new secret**
2. **Secret type:** Other type of secret
3. **Key/value pairs** (add these):

   | Key         | Value                    |
   |-------------|--------------------------|
   | host        | `localhost`              |
   | port        | 5432                     |
   | dbname      | iyere_app                |
   | username    | iyere_app_user           |
   | password    | `<YOUR_SECURE_PASSWORD>` |
   | jwt_secret   | `<YOUR_JWT_SECRET>`      |

4. **Secret name:** `sam-secrets`
5. Click **Store**

**Generate JWT_SECRET locally:** Run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and use the output as `jwt_secret`.

> **Important:** The app fetches `host`, `port`, `dbname`, `username`, `password`, and `jwt_secret` from Secrets Manager. Use `host: localhost` for single-instance setup.

### Step 4.2: Create IAM Role for Application EC2 Instances

1. **IAM** → **Roles** → **Create role**
2. **Trusted entity:** AWS service → **EC2**
3. **Permissions:** Attach these policies:
   - `AmazonSSMManagedInstanceCore` (for Session Manager)
   - Custom policy (Secrets Manager + S3 for CodeDeploy):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:sam-secrets*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::iyere-app-build-artifacts/*"
    }
  ]
}
```

Replace `REGION`, `ACCOUNT_ID`, and bucket name with your values. **S3 GetObject** lets the CodeDeploy agent on EC2 pull deployment artifacts from the bucket.

4. **Role name:** `iyere-app-ec2-role`
5. Create role

### Step 4.3: Create IAM Role for CodePipeline

1. **IAM** → **Roles** → **Create role**
2. **Trusted entity:** AWS service → **CodePipeline**
3. **Permissions:** Attach `AWSCodePipeline_FullAccess` or a minimal custom policy that includes:
   - **CodeCommit** (Source stage): `GetBranch`, `GetCommit`, `GetRepository`, `ListBranches`, `GitPull`
   - **CodeBuild** (Build stage): `StartBuild`, `BatchGetBuilds`
   - **CodeDeploy** (Deploy stage): `CreateDeployment`, `GetDeployment`, etc.
   - **S3** (artifact bucket): read/write
4. **Role name:** `iyere-codepipeline-role`

### Step 4.4: Create IAM Role for CodeBuild

1. **IAM** → **Roles** → **Create role**
2. **Trusted entity:** AWS service → **CodeBuild**
3. **Permissions:** Attach:
   - `AWSCodeBuildAdminAccess` (or minimal: `CloudWatchLogsFullAccess`, `AmazonS3FullAccess` for artifact bucket)
   - Custom policy for S3 buckets (artifact + static content):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::iyere-app-build-artifacts/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::app-static-content12345/*"
    }
  ]
}
```

Replace bucket names with yours. **Build-artifacts:** CodeBuild uploads deployment bundles. **Static-content:** CodeBuild uploads frontend files for CloudFront to serve (e.g. via `aws s3 sync` in buildspec).

4. **Role name:** `iyere-codebuild-role`

### Step 4.5: Create IAM Role for CodeDeploy

1. **IAM** → **Roles** → **Create role**
2. **Trusted entity:** AWS service → **CodeDeploy**
3. **Permissions:** `AWSCodeDeployRoleForEC2` (or equivalent)
4. **Role name:** `iyere-codedeploy-role`

---

## 5. Phase 4: Application EC2 Infrastructure

### Step 5.1: Create Security Group for Application EC2

1. **VPC** → **Security Groups** → **Create security group**
2. **Name:** `app-sg`
3. **VPC:** **default**
4. **Inbound rules:**
   - Type: **HTTP**, Port: 80, Source: `0.0.0.0/0` (or ALB SG)
   - Type: **HTTPS**, Port: 443, Source: `0.0.0.0/0` (or ALB SG)
   - Type: **Custom TCP**, Port: 3000, Source: ALB security group (add after ALB creation)
5. **Outbound:** All traffic
6. Create

**Update `postgres-sg`:** Add inbound rule allowing PostgreSQL (5432) from `app-sg`.

### Step 5.2: Create Golden Image (AMI)

A **golden image** pre-installs Node.js, CodeDeploy agent, and system dependencies so new instances launch faster and consistently. Create it once, then use it in your Launch Template.

#### Step 5.2a: Launch Base Instance for Golden Image

1. **EC2** → **Launch Instance**
2. **Name:** `iyere-app-golden-image-source`
3. **AMI:** **Amazon Linux 2023**
4. **Instance type:** `t3.micro`
5. **Key pair:** Select one (needed to SSH and configure)
6. **Network:** Default VPC, any default subnet, `app-sg`
7. **IAM instance profile:** `iyere-app-ec2-role`
8. Launch and wait for it to be running

#### Step 5.2b: Connect and Configure the Instance

SSH into the instance as `ec2-user`, then run:

```bash
# Update system
sudo dnf update -y

# Install Node.js 18 (NodeSource for Amazon Linux)
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo dnf install -y nodejs

# Install CodeDeploy agent (replace REGION with your region, e.g. us-east-1)
cd /home/ec2-user
wget https://aws-codedeploy-REGION.s3.REGION.amazonaws.com/latest/install
chmod +x ./install
sudo ./install auto
sudo systemctl enable codedeploy-agent
sudo systemctl start codedeploy-agent

# Install runtime dependencies
sudo dnf install -y curl postgresql15

# Create app directory (CodeDeploy deploys here)
sudo mkdir -p /var/www/app
sudo chown -R ec2-user:ec2-user /var/www/app

# Clean up (optional, reduces AMI size)
sudo dnf clean all
history -c
```

#### Step 5.2c: Create AMI from Instance

1. **EC2** → **Instances** → Select `iyere-app-golden-image-source`
2. **Actions** → **Image and templates** → **Create image**
3. **Image name:** `iyere-app-golden-image`
4. **Description:** `Pre-configured Amazon Linux 2023 with Node.js 18 and CodeDeploy agent`
5. **No reboot:** Uncheck (recommended for consistency)
6. Click **Create image**

#### Step 5.2d: Wait and Terminate Source Instance

1. **EC2** → **AMIs** → Wait until `iyere-app-golden-image` status is **Available**
2. Terminate `iyere-app-golden-image-source` (no longer needed)

### Step 5.3: Create Launch Template for Application EC2

1. **EC2** → **Launch Templates** → **Create launch template**
2. **Name:** `iyere-c`
3. **AMI:** **My AMIs** → Select `iyere-app-golden-image` (your golden image)
4. **Instance type:** `t3.micro`
5. **Key pair:** Optional (for debugging)
6. **Network:**
   - Subnet: (any; Auto Scaling will use default subnets)
   - Security group: `app-sg`
7. **Advanced details:**
   - IAM instance profile: `iyere-app-ec2-role`
   - User data: **Leave empty** (golden image has everything pre-installed)
8. Create launch template

### Step 5.4: Create Application Load Balancer (ALB)

1. **EC2** → **Load Balancers** → **Create**
2. **Type:** Application Load Balancer
3. **Name:** `iyere-app-alb`
4. **Scheme:** Internet-facing
5. **IP address type:** IPv4
6. **Network mapping:**
   - VPC: **default**
   - Subnets: Select **2+ default subnets** (one per AZ)
7. **Security groups:** Create new or use existing; allow 80, 443 from `0.0.0.0/0`
8. **Listeners:**
   - HTTP 80 → Forward to target group (create new)
   - HTTPS 443 → Forward to same target group (add ACM certificate later if needed)
9. **Target group:**
   - Name: `iyere-app-targets`
   - Target type: Instances
   - Protocol: HTTP
   - Port: 3000
   - Health check path: `/` or `/api/health` (if your app has one)
   - Health check interval: 30
10. Create load balancer

**Record ALB security group ID** (e.g., `sg-alb-xxx`). Update `app-sg` to allow traffic from this SG on port 3000.

### Step 5.5: Create Auto Scaling Group

1. **EC2** → **Auto Scaling Groups** → **Create**
2. **Name:** `iyere-app-asg`
3. **Launch template:** `iyere-app-template`
4. **VPC:** **default**
5. **Subnets:** Select **2+ default subnets** (one per AZ)
6. **Load balancing:** Attach to existing ALB, target group: `iyere-app-targets`
7. **Group size:** Min 1, Desired 1, **Max 2** (required for Blue/Green deployment—CodeDeploy needs capacity to launch green instances during deployment)
8. **Scaling policies:** Optional (e.g., scale on CPU > 70%)
9. Create

---

## 6. Phase 5: S3 Buckets

### Step 6.1: Create S3 Buckets

Create three buckets (use unique names, e.g., prefix with your project/account):

| Bucket Name (example)        | Purpose                          |
|-----------------------------|----------------------------------|
| `app-static-content12345`   | Static assets, frontend files; CodeBuild uploads here; CloudFront serves via OAC (bucket policy) |
| `iyere-app-build-artifacts` | CI/CD build artifacts; CodeBuild uploads here, EC2 (CodeDeploy agent) pulls from here |

> **Note:** **Build-artifacts:** CodeBuild **PutObject**, EC2 **GetObject** (Steps 4.2, 4.4). **Static-content:** CodeBuild **PutObject** to upload frontend (Step 4.4); CloudFront reads via Origin Access Control (OAC)—configure bucket policy when setting up CloudFront, no IAM role for CloudFront.

1. **S3** → **Create bucket**
2. **Block Public Access:** Configure as needed:
   - Static content: Enable public read if serving directly, or use CloudFront OAI
   - Build/CodeDeploy: Keep private
3. **Versioning:** Optional for build artifacts

### Step 6.2: Configure Static Content Bucket for CloudFront (Phase 8)

You will configure this when setting up CloudFront. For now, ensure the bucket exists.

---

## 7. Phase 6: CI/CD Pipeline

**Pipeline flow:** CodeCommit (Source) → CodeBuild (Build) → CodeDeploy (Deploy). CodeBuild runs **before** CodeDeploy—it produces artifacts that CodeDeploy then deploys to EC2.

### Step 7.1: Create CodeCommit Repository (Source Stage)

1. **CodeCommit** → **Create repository**
2. **Name:** `iyere-app`
3. **Description:** (optional) Application source code
4. Create repository

5. **Set up Git credentials** (for pushing from your machine):
   - **IAM** → **Users** → Your user → **Security credentials** → **HTTPS Git credentials for AWS CodeCommit** → **Generate credentials**
   - Or use SSH key, or AWS CLI credential helper (`git config credential.helper '!aws codecommit credential-helper $@'`)

6. **Clone and push your code:**

```bash
git clone https://git-codecommit.REGION.amazonaws.com/v1/repos/iyere-app
cd iyere-app
# Copy app contents (buildspec.yml, backend/, frontend/, scripts/, appspec.yml)
cp -r /path/to/iyere-capstone/app/* .
git add .
git commit -m "Initial commit"
git push -u origin main
```

7. **CodePipeline role** needs CodeCommit access: ensure `iyere-codepipeline-role` has `codecommit:GetBranch`, `codecommit:GetCommit`, `codecommit:GetRepository`, `codecommit:ListBranches`, `codecommit:GitPull` (or attach `AWSCodeCommitReadOnly`).

### Step 7.2: Create CodeBuild Project

1. **CodeBuild** → **Create build project**
2. **Name:** `iyere-app-build`
3. **Source:** CodeCommit, repository: `iyere-app`, branch: `main`
4. **Environment:**
   - Managed image, Amazon Linux 2
   - Runtime: Standard
   - Image: aws/codebuild/amazonlinux2-x86_64-standard:4.0
   - Privileged: No
   - Service role: `iyere-codebuild-role`
5. **Buildspec:** Use `app/buildspec.yml` from repo (path: `buildspec.yml`)
6. **Artifacts:** Type: Codepipeline
7. **Environment variables:** Not needed—bucket name is in `buildspec.yml`
8. Create

### Step 7.3: Create CodeDeploy Application

1. **CodeDeploy** → **Applications** → **Create application**
2. **Name:** `iyere-app`
3. **Compute platform:** EC2/On-premises
4. **Create deployment group:**
   - Name: `iyere-app-dg`
   - Service role: `iyere-codedeploy-role`
   - **Deployment type: Blue/Green**
   - Environment: EC2 instances
   - Tag group: Key `Name`, Value `iyere-app` (or use Auto Scaling group: `iyere-app-asg`)
   - Load balancer: Enable, select `iyere-app-alb` and `iyere-app-targets`
   - Deployment settings: AllAtOnce or Rolling

> **Blue/Green deployment:** CodeDeploy launches new (green) instances, deploys the new revision, validates, then switches traffic from old (blue) to green. Requires ASG **Max ≥ 2** so the ASG can add instances during deployment. CodeDeploy triggers the scale-up directly—it does not rely on the CPU scaling policy.

### Step 7.4: Create CodePipeline

1. **CodePipeline** → **Create pipeline**
2. **Name:** `iyere-app-pipeline`
3. **Service role:** New or existing (`iyere-codepipeline-role`)
4. **Artifact store:** Use default (CodePipeline creates a bucket) or **Custom location** → select `iyere-app-build-artifacts` (create bucket in Phase 4 first). Ensure the pipeline role has S3 read/write to this bucket.

5. **Add stages in this order:**

   **Stage 1 – Source (CodeCommit)**
   - Provider: **CodeCommit**
   - Repository: `iyere-app`
   - Branch: `main`
   - Output artifact name: `SourceArtifact`
   - Change detection: CloudWatch Events (pipeline runs on new commits)

   **Stage 2 – Build (CodeBuild)**
   - Provider: **CodeBuild**
   - Project: `iyere-app-build`
   - Input artifact: `SourceArtifact` (from Source stage)
   - Output artifact name: `BuildArtifact`

   **Stage 3 – Deploy (CodeDeploy)**
   - Provider: **CodeDeploy**
   - Application: `iyere-app`
   - Deployment group: `iyere-app-dg`
   - Input artifact: `BuildArtifact` (from Build stage)

6. Create pipeline

The pipeline will build and deploy on the first run. Ensure the deployment group targets your Auto Scaling instances (tag or ASG).

### Step 7.5: Blue/Green Deployment (Overview)

This guide uses **Blue/Green** deployment for zero-downtime releases. Key points:

| Aspect | Details |
|--------|---------|
| **How it works** | CodeDeploy launches new (green) instances, deploys the new revision, validates, then switches ALB traffic from old (blue) to green. Old instances are terminated. |
| **ASG requirement** | **Max ≥ 2**—CodeDeploy increases desired capacity during deployment to add green instances. With Max=1, deployment would fail. |
| **Scaling trigger** | CodeDeploy directly adjusts ASG desired capacity—it does **not** use the CPU scaling policy. Your CPU > 70% policy applies only to production load. |
| **Database note** | With PostgreSQL on the same EC2 instance, each blue/green instance has its own database. Migrations run on the green instance during `install.sh`. After cutover, green's DB is the active one; blue's is terminated. **Data on blue is lost**—suitable for dev/test. For production with persistent data, use a shared database (RDS or dedicated PostgreSQL instance) so both blue and green connect to the same DB. |
| **Cost** | Extra instance cost only during deployment (typically a few minutes). After cutover, ASG returns to 1 instance. |

**Deployment flow:**
1. Pipeline triggers deployment
2. CodeDeploy scales ASG to 2 instances (blue + green)
3. CodeDeploy deploys to green instance (BeforeInstall → Install → ApplicationStart → ValidateService)
4. Traffic switches from blue to green
5. Blue instance terminated; ASG desired capacity back to 1

---

## 8. Phase 7: Load Balancer & Auto Scaling

You created the ALB and ASG in Phase 4–5. Verify:

1. **Target group** shows healthy targets (after first deployment)
2. **ALB listener** forwards to the target group
3. **Security groups:** ALB SG allows 80/443 inbound; `app-sg` allows 3000 from ALB SG

### Health Check

If your Node.js app exposes a health endpoint (e.g., `GET /api/health`), set the target group health check path accordingly. Otherwise use `GET /`.

---

## 8. Phase 7: CloudFront, WAF & Route 53

### Step 9.1: Request ACM Certificate (for HTTPS)

1. **ACM** → **Request certificate**
2. **Domain names:** Your domain (e.g., `app.example.com`) or use `*.example.com`
3. **Validation:** DNS validation
4. Add CNAME records in your DNS as instructed

### Step 9.2: Create CloudFront Distribution

1. **CloudFront** → **Create distribution**
2. **Origin:**
   - Origin domain: Your ALB (`iyere-app-alb-xxx.us-east-1.elb.amazonaws.com`)
   - Protocol: HTTPS only
   - Origin path: (empty)
3. **Default cache behavior:**
   - Viewer protocol: Redirect HTTP to HTTPS
   - Allowed methods: GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE
   - Cache policy: CachingDisabled (for API) or custom
4. **Alternate domain:** Your domain (e.g., `app.example.com`)
5. **Custom SSL certificate:** Select ACM certificate
6. Create distribution

### Step 9.3: AWS WAF (Optional)

1. **WAF & Shield** → **Web ACLs** → **Create**
2. Add rules (e.g., AWS managed rule sets for common threats)
3. Associate with CloudFront distribution

### Step 9.4: Route 53

1. **Route 53** → **Hosted zones** → Select your domain
2. **Create record:**
   - Name: `app` (or subdomain)
   - Type: A
   - Alias: Yes
   - Route traffic to: CloudFront distribution
   - Select your distribution
3. Create

### Step 9.5: Static Content (S3 + CloudFront)

**CloudFront does not use an IAM role** to read from S3. Instead, you grant CloudFront access via a **bucket policy** using Origin Access Control (OAC).

1. **CloudFront** → Create distribution (or add S3 as second origin)
2. **Origin:** S3 bucket `app-static-content12345`
3. **Origin access:** Origin Access Control (OAC) — create new OAC, attach to origin
4. **Bucket policy:** CloudFront will show a policy to copy. Apply it to the S3 bucket so CloudFront can read objects. Example:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipal",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::app-static-content12345/*",
      "Condition": { "StringEquals": { "AWS:SourceArn": "arn:aws:cloudfront::ACCOUNT_ID:distribution/DISTRIBUTION_ID" } }
    }
  ]
}
```

5. **CodeBuild** uploads frontend to this bucket (IAM in Step 3.4). The bucket name is set in `buildspec.yml` (`env.variables.STATIC_CONTENT_BUCKET`).

---

## 10. Phase 9: Monitoring & Validation

### Step 10.1: CloudWatch Logs

- Application logs: Ensure your Node.js app logs to stdout/stderr; CloudWatch agent on EC2 can ship them
- Or use `app.log` and configure CloudWatch agent to ship `/var/www/app/app.log`

### Step 10.2: Environment Variables for Application EC2

CodeDeploy install scripts use:

- `DB_SECRET_NAME`: `sam-secrets` (default in `application_start.sh`)
- `AWS_REGION`: e.g., `us-east-1`
- `JWT_SECRET`: Set via Systems Manager Parameter Store or User Data

Add to Launch Template User Data or use SSM Parameter Store:

```bash
# In User Data or via SSM
export DB_SECRET_NAME=sam-secrets
export AWS_REGION=us-east-1
export JWT_SECRET=your-jwt-secret
```

Or store in `/var/www/app/.env` during `install.sh` if needed.

### Step 9.3: Run Database Migrations

Migrations run automatically during CodeDeploy `AfterInstall` via `check-and-run-migrations.js`. Ensure:

1. PostgreSQL is running on the same instance (`sudo systemctl status postgresql` → active)
2. Secrets Manager has correct credentials (host = `localhost`)
3. App EC2 IAM role can read the secret

### Step 9.4: Validation Checklist

- [ ] PostgreSQL: `sudo systemctl status postgresql` → active (on app instance)
- [ ] Can connect: `psql -h localhost -U iyere_app_user -d iyere_app` (from app instance)
- [ ] Secrets Manager: Secret exists with host `localhost`, app role has `GetSecretValue`
- [ ] CodePipeline: Pipeline runs successfully
- [ ] Target group: Healthy targets
- [ ] ALB/CloudFront: Returns 200 for health check
- [ ] Application: Login/API works end-to-end

---

## Architecture Summary (PostgreSQL on EC2)

| Component              | Implementation                                      |
|------------------------|-----------------------------------------------------|
| Database               | PostgreSQL 15 on Amazon Linux 2023 EC2 (default VPC)   |
| App Servers            | Node.js on Amazon Linux 2023 EC2 (golden image AMI, ASG with Max=2 for Blue/Green) |
| Deployment             | CodeDeploy **Blue/Green** (zero-downtime)            |
| DB Credentials         | AWS Secrets Manager (`sam-secrets`)           |
| Load Balancing         | Application Load Balancer                           |
| CI/CD                  | CodeCommit → CodePipeline → CodeBuild → CodeDeploy  |
| Static Content         | S3 + CloudFront                                     |
| DNS / HTTPS            | Route 53 + ACM + CloudFront                         |
| Security               | Security groups, WAF (optional)                     |

---

## Troubleshooting

### App cannot connect to PostgreSQL

- Ensure PostgreSQL is running: `sudo systemctl status postgresql`
- Verify Secrets Manager `host` is **localhost** (DB on same instance)
- Check `pg_hba.conf` allows `127.0.0.1` (configured in golden image)

### CodeDeploy fails

- Ensure EC2 instances have CodeDeploy agent (from golden image or User Data)
- Check IAM roles for CodeDeploy and EC2
- Verify `appspec.yml` paths match deployed structure

### Migrations fail

- Run `node scripts/check-and-run-migrations.js` manually on an app EC2 (via Session Manager)
- Ensure `AWS_REGION` and `DB_SECRET_NAME` are set
- Check CloudWatch logs for errors

---

## Next Steps

1. Implement each phase in order
2. Test connectivity between components before moving to the next phase
3. Use Infrastructure as Code (Terraform/CloudFormation) for repeatability
4. Consider backup strategy for PostgreSQL (e.g., `pg_dump` cron + S3)
5. **Recreate golden image** when upgrading Node.js or CodeDeploy agent: repeat Step 5.2, then update the Launch Template to use the new AMI

#testing