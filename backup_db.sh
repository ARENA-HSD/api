#!/bin/bash

# Path to the .env file (assuming it is in the same directory as the script)
ENV_FILE="$(dirname "$0")/.env"

# Pull variables from the .env file
if [ -f "$ENV_FILE" ]; then
    # Export uncommented lines into the bash environment
    export $(grep -v '^#' "$ENV_FILE" | xargs)
else
    echo "ERROR: .env file not found! ($ENV_FILE)"
    exit 1
fi

TIMESTAMP=$(date +"%F_%H-%M-%S")
BACKUP_DIR="/opt/backups"
MACHINE_NAME=$(hostname) # Gets the unique name of the machine (e.g., ubuntu-node-1)

# In a load balancing scenario (multi-server), wait randomly between 0 to 5 minutes
# to prevent network or disk lockups caused by simultaneous uploads:
sleep $((RANDOM % 300))

# Create the backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "[$TIMESTAMP] [$MACHINE_NAME] Backup started..."

# 1. PostgreSQL Database Backup
# (DB_USER and DB_NAME variables are read from .env)
docker exec arena-postgres-prod pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_DIR/db_backup_${MACHINE_NAME}_${TIMESTAMP}.sql.gz"
echo "Database backup completed: db_backup_${MACHINE_NAME}_${TIMESTAMP}.sql.gz"

# 2. Compress and Backup Docker Volumes
# Since we already took a pg_dump for PostgreSQL (above), we only backup volumes holding config/logs.
VOLUMES_DIR="/var/lib/docker/volumes"
tar -czf "$BACKUP_DIR/volumes_backup_${MACHINE_NAME}_${TIMESTAMP}.tar.gz" \
    "$VOLUMES_DIR/api_redis_data_prod" \
    "$VOLUMES_DIR/api_loki_data_prod" \
    "$VOLUMES_DIR/api_promtail_data_prod" \
    "$VOLUMES_DIR/api_grafana_data_prod" \
    "$VOLUMES_DIR/api_prometheus_data_prod" > /dev/null 2>&1

echo "Docker volumes archived: volumes_backup_${MACHINE_NAME}_${TIMESTAMP}.tar.gz"

# 3. Delete backups older than 7 days from the server (to prevent disk full issues)
find "$BACKUP_DIR" -name "*_backup_*.gz" -type f -mtime +7 -exec rm {} \;

# -------------------------------------------------------------
# 4. TRANSFER TO REMOTE STORAGE (VIA RSYNC)
# -------------------------------------------------------------
REMOTE_USER="root"
REMOTE_IP="123.45.67.89"
REMOTE_PORT="22"
REMOTE_DEST="/root/arena-backups"

# rsync is very fast because it only transfers changed/newly added files.
# Push the backup to the remote server using the specific SSH key:
rsync -avz -e "ssh -i $HOME/.ssh/server_backup_ssh_key -p $REMOTE_PORT" --delete "$BACKUP_DIR/" "${REMOTE_USER}@${REMOTE_IP}:${REMOTE_DEST}"

echo "[$TIMESTAMP] Backup process completed!"