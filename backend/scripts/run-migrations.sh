#!/bin/bash
set -e

APP_DIR="/var/www/app"
BACKEND_DIR="$APP_DIR/backend"
MIGRATIONS_DIR="$BACKEND_DIR/migrations"

echo "=== Database Migration Runner (psql) ==="

if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo "ERROR: Migrations directory not found: $MIGRATIONS_DIR"
    exit 1
fi

if ! command -v psql &> /dev/null; then
    echo "ERROR: psql not found. Install postgresql-client."
    exit 1
fi

if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ] || [ -z "$DB_NAME" ]; then
    echo "ERROR: Database credentials not set."
    echo "Required environment variables:"
    echo "  - DB_HOST"
    echo "  - DB_USER"
    echo "  - DB_PASSWORD"
    echo "  - DB_NAME"
    echo ""
    echo "For AWS RDS, retrieve credentials from Secrets Manager first."
    exit 1
fi

export PGPASSWORD="$DB_PASSWORD"

echo "Connecting to database: $DB_NAME@$DB_HOST"
echo ""

for migration_file in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
    filename=$(basename "$migration_file")
    echo "Running: $filename"
    
    if psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f "$migration_file" > /dev/null 2>&1; then
        echo "✓ Successfully applied: $filename"
    else
        if psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f "$migration_file" 2>&1 | grep -q "already exists\|duplicate"; then
            echo "⚠ Skipped (already applied): $filename"
        else
            echo "✗ Error applying: $filename"
            exit 1
        fi
    fi
    echo ""
done

echo "=== All migrations completed ==="
unset PGPASSWORD
