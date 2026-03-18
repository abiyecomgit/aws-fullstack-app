#!/bin/bash
set -e

APP_DIR="/var/www/app"
PID_FILE="$APP_DIR/app.pid"
PORT=${PORT:-3000}

echo "Validating service..."

if [ ! -f "$PID_FILE" ]; then
    echo "Error: PID file not found"
    exit 1
fi

PID=$(cat "$PID_FILE")

if ! ps -p $PID > /dev/null 2>&1; then
    echo "Error: Process $PID is not running"
    exit 1
fi

if ! command -v curl > /dev/null 2>&1; then
    echo "Warning: curl not found, installing..."
    sudo dnf install -y curl > /dev/null 2>&1
fi

if ! curl -f -s http://localhost:$PORT/api/health > /dev/null 2>&1; then
    echo "Error: Health check failed"
    echo "Attempting to check process status..."
    ps aux | grep node || true
    ss -tlnp 2>/dev/null | grep $PORT || netstat -tlnp 2>/dev/null | grep $PORT || true
    exit 1
fi

echo "Service validation passed"
