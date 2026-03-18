require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { initializeDatabase, getPool } = require('../config/database');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function checkIfMigrationNeeded() {
  try {
    await initializeDatabase();
    const pool = getPool();
    
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      )
    `);
    
    const usersTableExists = result.rows[0].exists;
    await pool.end();
    
    return !usersTableExists;
  } catch (error) {
    console.error('Error checking migration status:', error.message);
    return false;
  }
}

async function runMigrations() {
  try {
    console.log('=== Database Migration Runner ===\n');
    
    await initializeDatabase();
    const pool = getPool();
    
    const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
      .filter(file => file.endsWith('.sql'))
      .sort();
    
    if (migrationFiles.length === 0) {
      console.log('No migration files found.');
      await pool.end();
      return;
    }
    
    console.log(`Found ${migrationFiles.length} migration file(s):\n`);
    
    for (const file of migrationFiles) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      
      console.log(`Running: ${file}`);
      
      try {
        await pool.query(sql);
        console.log(`✓ Successfully applied: ${file}\n`);
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate')) {
          console.log(`⚠ Skipped (already applied): ${file}\n`);
        } else {
          console.error(`✗ Error applying ${file}:`, error.message);
          await pool.end();
          throw error;
        }
      }
    }
    
    console.log('=== All migrations completed ===');
    await pool.end();
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

async function main() {
  try {
    const migrationNeeded = await checkIfMigrationNeeded();
    
    if (migrationNeeded) {
      console.log('Database tables not found. Running migrations...\n');
      await runMigrations();
      process.exit(0);
    } else {
      console.log('✓ Database already migrated. Tables exist. Skipping migrations.');
      process.exit(0);
    }
  } catch (error) {
    console.error('Migration check failed:', error);
    process.exit(1);
  }
}

main();
