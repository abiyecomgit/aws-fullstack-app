#!/bin/bash
set -e

APP_DIR="/var/www/app"

if [ ! -d "$APP_DIR" ]; then
    echo "Creating $APP_DIR..."
    sudo mkdir -p "$APP_DIR"
    sudo chown ec2-user:ec2-user "$APP_DIR"
    echo "Created $APP_DIR"
else
    echo "$APP_DIR already exists"
fi
