#!/bin/bash
set -e

APP_DIR="/var/www/app"
PID_FILE="$APP_DIR/app.pid"

echo "Stopping application..."

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p $PID > /dev/null 2>&1; then
        echo "Stopping process $PID"
        kill $PID
        sleep 2
        if ps -p $PID > /dev/null 2>&1; then
            echo "Force stopping process $PID"
            kill -9 $PID
        fi
    fi
    rm -f "$PID_FILE"
fi

pkill -f "node.*server.js" || true

echo "Application stopped"
