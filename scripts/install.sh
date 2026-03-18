#!/bin/bash
set -e

APP_DIR="/var/www/app"
BACKEND_DIR="$APP_DIR/backend"

cd "$APP_DIR"

echo "=== Application Installation (CodeDeploy) ==="
echo "Instance ID: $(curl -s http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null || echo 'N/A')"

echo "Installing system dependencies..."
sudo dnf install -y curl postgresql15 > /dev/null 2>&1 || true

echo "Verifying Node.js installation..."
if ! command -v node &> /dev/null; then
    echo "WARNING: Node.js not found. Should be installed via golden image."
    echo "Installing Node.js 18 as fallback..."
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo dnf install -y nodejs
else
    echo "✓ Node.js found (installed via golden image)"
fi

echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

echo "Installing Node.js dependencies (including AWS SDK)..."
cd "$BACKEND_DIR"
npm install --production

echo "Verifying AWS SDK installation..."
if [ -d "node_modules/aws-sdk" ]; then
    echo "✓ AWS SDK installed successfully"
else
    echo "✗ ERROR: AWS SDK not found in node_modules"
    exit 1
fi

echo "Checking if database migrations are needed..."
if [ -d "$BACKEND_DIR/migrations" ] && [ -f "$BACKEND_DIR/scripts/check-and-run-migrations.js" ]; then
    cd "$BACKEND_DIR"
    echo "Checking database migration status..."
    node scripts/check-and-run-migrations.js || {
        echo "⚠ Migration check failed or migrations already applied"
        echo "This is normal if database is already migrated"
    }
else
    echo "Note: Migration files available in backend/migrations/"
    echo "Run migrations manually with: cd backend && npm run migrate"
fi

echo "Installation completed successfully"
