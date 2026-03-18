#!/bin/bash
set -e

APP_DIR="/var/www/app"
BACKEND_DIR="$APP_DIR/backend"
PID_FILE="$APP_DIR/app.pid"
LOG_FILE="$APP_DIR/app.log"

cd "$BACKEND_DIR"

echo "Starting application..."
export DB_SSL=true
export NODE_ENV=production
export PORT=${PORT:-3000}
export AWS_REGION=${AWS_REGION:-us-west-2}
export DB_SECRET_NAME=${DB_SECRET_NAME:-voteapp-secret}
echo "Environment variables set:"
echo "  - AWS_REGION: $AWS_REGION"
echo "  - DB_SECRET_NAME: $DB_SECRET_NAME"
echo "  - PORT: $PORT"
echo ""
echo "Note: Database credentials and JWT_SECRET are retrieved from Secrets Manager (voteapp-secret) at runtime"

nohup node server.js > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

sleep 3

if ps -p $(cat "$PID_FILE") > /dev/null 2>&1; then
    echo "Application started successfully (PID: $(cat $PID_FILE))"
else
    echo "Failed to start application"
    cat "$LOG_FILE" || true
    exit 1
fi
