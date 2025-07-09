#!/bin/sh
# Database backup script

set -e

BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_NAME="${DB_NAME:-speedmonitor}"
DB_USER="${DB_USER:-speedmonitor}"
DB_HOST="${DB_HOST:-db}"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Perform backup
echo "Starting backup of database $DB_NAME..."
pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f "$BACKUP_DIR/speedmonitor_$TIMESTAMP.sql"

# Compress backup
gzip "$BACKUP_DIR/speedmonitor_$TIMESTAMP.sql"

echo "Backup completed: speedmonitor_$TIMESTAMP.sql.gz"

# Remove backups older than 30 days
find "$BACKUP_DIR" -name "speedmonitor_*.sql.gz" -mtime +30 -delete

echo "Old backups cleaned up"