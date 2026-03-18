const { Pool } = require('pg');
const AWS = require('aws-sdk');

let pool = null;
let cachedSecret = null;

async function getSecret() {
  if (cachedSecret) return cachedSecret;

  const secretsManager = new AWS.SecretsManager({
    region: process.env.AWS_REGION || 'us-west-2'
  });

  const secretName = process.env.DB_SECRET_NAME || 'voteapp-secret';

  try {
    console.log(`Retrieving secrets from Secrets Manager: ${secretName}`);
    const data = await secretsManager.getSecretValue({ SecretId: secretName }).promise();

    if (!data.SecretString) {
      throw new Error('Secret string is empty or undefined');
    }

    cachedSecret = JSON.parse(data.SecretString);
    return cachedSecret;
  } catch (error) {
    console.error('Error retrieving secrets from Secrets Manager:', error);
    if (error.code === 'ResourceNotFoundException') {
      throw new Error(`Secret "${secretName}" not found in Secrets Manager. Check the secret name and AWS region.`);
    }
    if (error.code === 'AccessDeniedException') {
      throw new Error(`Access denied to secret "${secretName}". Check IAM permissions for Secrets Manager.`);
    }
    throw error;
  }
}

async function getDatabaseCredentials() {
  const secret = await getSecret();

  if (!secret.host || !secret.username || !secret.password) {
    throw new Error('Missing required credential fields: host, username, or password');
  }

  const credentials = {
    host: secret.host,
    port: secret.port || 5432,
    database: secret.dbname || secret.database,
    user: secret.username,
    password: secret.password
  };

  if (!credentials.database) {
    throw new Error('Missing database name (expected "dbname" or "database" key in secret)');
  }

  console.log(`Successfully retrieved credentials for database: ${credentials.database}@${credentials.host}:${credentials.port}`);
  return credentials;
}

async function getJwtSecret() {
  const secret = await getSecret();
  const jwtSecret = secret.jwt_secret || secret.JWT_SECRET || process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('Missing jwt_secret in Secrets Manager. Add "jwt_secret" to voteapp-secret.');
  }
  return jwtSecret;
}

async function initializeDatabase() {
  if (pool) {
    return pool;
  }

  try {
    const credentials = await getDatabaseCredentials();
    
    pool = new Pool({
      host: credentials.host,
      port: credentials.port,
      database: credentials.database,
      user: credentials.user,
      password: credentials.password,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
      process.exit(-1);
    });

    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    
    console.log('Database connection established successfully');
    return pool;
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

function getPool() {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initializeDatabase() first.');
  }
  return pool;
}

module.exports = {
  initializeDatabase,
  getPool,
  getJwtSecret
};
