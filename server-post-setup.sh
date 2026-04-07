#!/bin/bash

set -euo pipefail

[ "$EUID" -eq 0 ] && echo "Please run without sudo" && exit

echo "Do not afraid while typing password, it will not show up."
sleep 2
echo ""
echo "--- Veritabanı Bilgileri ---"
read -p "DB_USER: " DB_USER
read -s -p "DB_PASSWORD: " DB_PASSWORD
echo ""
read -p "DB_NAME: " DB_NAME

echo -e "\n--- Uygulama Bilgileri ---"
read -s -p "JWT_SECRET: " JWT_SECRET
echo ""

echo -e "\n--- Grafana Dashboard ---"
read -p "GRAFANA_ADMIN_USER: " GRAFANA_ADMIN_USER
read -s -p "GRAFANA_ADMIN_PASSWORD: " GRAFANA_ADMIN_PASSWORD
echo ""

echo -e "\n--- Telegram Log ---"
read -p "TELEGRAM_BOT_TOKEN: " TELEGRAM_BOT_TOKEN
read -p "TELEGRAM_CHAT_ID: " TELEGRAM_CHAT_ID
read -p "TELEGRAM_WARNING_TOPIC_ID: " TELEGRAM_WARNING_TOPIC_ID
read -p "TELEGRAM_INFO_TOPIC_ID: " TELEGRAM_INFO_TOPIC_ID
read -p "TELEGRAM_ERROR_TOPIC_ID: " TELEGRAM_ERROR_TOPIC_ID
read -p "TELEGRAM_CRITICAL_TOPIC_ID: " TELEGRAM_CRITICAL_TOPIC_ID

echo -e "\n--- Cloudflare Settings ---"
read -p "TURNSTILE_SECRET_KEY: " TURNSTILE_SECRET_KEY
read -p "CLOUDFLARE_API_TOKEN: " CLOUDFLARE_API_TOKEN
read -p "CLOUDFLARE_R2_ACCESS_KEY: " CLOUDFLARE_R2_ACCESS_KEY
read -p "CLOUDFLARE_R2_SECRET_KEY: " CLOUDFLARE_R2_SECRET_KEY
read -p "CLOUDFLARE_S3_ENDPOINT: " CLOUDFLARE_S3_ENDPOINT
read -p "CLOUDFLARE_ACCOUNT_ID: " CLOUDFLARE_ACCOUNT_ID
read -p "CLOUDFLARE_R2_BUCKET: " CLOUDFLARE_R2_BUCKET
read -p "CLOUDFLARE_R2_PUBLIC_URL: " CLOUDFLARE_R2_PUBLIC_URL

cat <<EOF > .env
# --- Veritabanı Ayarları ---
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}

# --- Bağlantı Linkleri ---
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}
REDIS_URL=redis://redis:6379

# --- Uygulama Ayarları ---
JWT_SECRET=${JWT_SECRET}
API_PORT=3000
NODE_ENV=production

# --- GRAFANA ---
GRAFANA_ADMIN_USER=${GRAFANA_ADMIN_USER}
GRAFANA_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD}

# --- TELEGRAM ---
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
TELEGRAM_WARNING_TOPIC_ID=${TELEGRAM_WARNING_TOPIC_ID}
TELEGRAM_INFO_TOPIC_ID=${TELEGRAM_INFO_TOPIC_ID}
TELEGRAM_ERROR_TOPIC_ID=${TELEGRAM_ERROR_TOPIC_ID}
TELEGRAM_CRITICAL_TOPIC_ID=${TELEGRAM_CRITICAL_TOPIC_ID}

# --- CLOUDFLARE SETTINGS ---
TURNSTILE_SECRET_KEY=${TURNSTILE_SECRET_KEY}
CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}
CLOUDFLARE_R2_ACCESS_KEY=${CLOUDFLARE_R2_ACCESS_KEY}
CLOUDFLARE_R2_SECRET_KEY=${CLOUDFLARE_R2_SECRET_KEY}
CLOUDFLARE_S3_ENDPOINT=${CLOUDFLARE_S3_ENDPOINT}
CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID}
CLOUDFLARE_R2_BUCKET=${CLOUDFLARE_R2_BUCKET}
CLOUDFLARE_R2_PUBLIC_URL=${CLOUDFLARE_R2_PUBLIC_URL}
EOF

echo "Created api .env file"

docker compose -f docker-compose.prod.yml up -d --build
echo "Success. API containers are running."



read -p "VITE_API_URL [example: http://localhost:3000]: " VITE_API_URL
read -p "VITE_BASE_DOMAIN [example: api.localhost.tr]: " VITE_BASE_DOMAIN
read -p "TURNSTILE_SITE_KEY [Public Key]: " TURNSTILE_SITE_KEY

cat <<EOF > ../frontend/.env
# --- Bağlantı Linkleri ---
VITE_API_URL=${VITE_API_URL}
VITE_API_PORT=5173
VITE_BASE_DOMAIN=${VITE_BASE_DOMAIN}
VITE_TURNSTILE_SITE_KEY=${TURNSTILE_SITE_KEY}
EOF

cd ../frontend
docker compose -f docker-compose.prod.yml up -d --build
echo "Success. Frontend container is running."

cd ../

echo -e "\n--- Automated Backup and SSH Configuration ---"
read -p "Do you want to setup automated remote rsync backup? (y/n): " DO_BACKUP
if [[ "$DO_BACKUP" =~ ^[Yy]$ ]]; then
    # Create SSH key if it doesn't exist
    SSH_KEY_PATH="$HOME/.ssh/server_backup_ssh_key"
    if [ ! -f "$SSH_KEY_PATH" ]; then
        echo "Custom SSH key not found, generating a new one ($SSH_KEY_PATH)..."
        ssh-keygen -t ed25519 -N "" -f "$SSH_KEY_PATH"
    fi

    echo -e "\nPlease enter your remote backup server credentials:"
    read -p "Remote Server IP: " BACKUP_IP
    read -p "Remote Server Port [22]: " BACKUP_PORT
    BACKUP_PORT=${BACKUP_PORT:-22}
    read -p "Remote Server Username (e.g., root): " BACKUP_USER

    # Automatically determine destination based on user
    if [ "$BACKUP_USER" = "root" ]; then
        BACKUP_DEST="/root/arena_backups"
    else
        BACKUP_DEST="/home/$BACKUP_USER/arena_backups"
    fi
    echo "Target directory automatically set to: $BACKUP_DEST"

    echo "Generating backup_db.sh script dynamically..."
    cat <<EOF > backup_db.sh
#!/bin/bash
set -eo pipefail

if [ "\$EUID" -ne 0 ]; then
    echo "ERROR: backup_db.sh MUST be run as root (or sudo) to backup /var/lib/docker/volumes and write to /opt/backups."
    exit 1
fi

# Path to the .env file (assuming it is in the same directory as the script)
ENV_FILE="\$(dirname "\$0")/.env"

# Pull variables from the .env file
if [ -f "\$ENV_FILE" ]; then
    # Export uncommented lines into the bash environment
    export \$(grep -v '^#' "\$ENV_FILE" | xargs)
else
    echo "ERROR: .env file not found! (\$ENV_FILE)"
    exit 1
fi

TIMESTAMP=\$(date +"%F_%H-%M-%S")
BACKUP_DIR="/opt/backups"
MACHINE_NAME=\$(hostname) # Gets the unique name of the machine (e.g., ubuntu-node-1)

# In a load balancing scenario (multi-server), wait randomly between 0 to 5 minutes
# to prevent network or disk lockups caused by simultaneous uploads:
sleep \$((\$RANDOM % 300))

# Create the backup directory if it doesn't exist
mkdir -p "\$BACKUP_DIR"

echo "[\$TIMESTAMP] [\$MACHINE_NAME] Backup started..."

# 1. PostgreSQL Database Backup
# (DB_USER and DB_NAME variables are read from .env)
docker exec arena-postgres-prod pg_dump -U "\$DB_USER" -d "\$DB_NAME" | gzip > "\$BACKUP_DIR/db_backup_\${MACHINE_NAME}_\${TIMESTAMP}.sql.gz"
echo "Database backup completed: db_backup_\${MACHINE_NAME}_\${TIMESTAMP}.sql.gz"

# 2. Compress and Backup Docker Volumes
# Since we already took a pg_dump for PostgreSQL (above), we only backup volumes holding config/logs.
VOLUMES_DIR="/var/lib/docker/volumes"
tar -czf "\$BACKUP_DIR/volumes_backup_\${MACHINE_NAME}_\${TIMESTAMP}.tar.gz" \\
    "\$VOLUMES_DIR/api_redis_data_prod" \\
    "\$VOLUMES_DIR/api_loki_data_prod" \\
    "\$VOLUMES_DIR/api_promtail_data_prod" \\
    "\$VOLUMES_DIR/api_grafana_data_prod" \\
    "\$VOLUMES_DIR/api_prometheus_data_prod" > /dev/null 2>&1

echo "Docker volumes archived: volumes_backup_\${MACHINE_NAME}_\${TIMESTAMP}.tar.gz"

# 3. Delete backups older than 7 days from the server (to prevent disk full issues)
# Using find -delete is much safer and bypasses the interactive alias (rm -i) trap
find "\$BACKUP_DIR" -name "*_backup_*.gz" -type f -mtime +7 -delete

# -------------------------------------------------------------
# 4. TRANSFER TO REMOTE STORAGE (VIA RSYNC)
# -------------------------------------------------------------
REMOTE_USER="${BACKUP_USER}"
REMOTE_IP="${BACKUP_IP}"
REMOTE_PORT="${BACKUP_PORT}"
REMOTE_DEST="${BACKUP_DEST}"

# rsync is very fast because it only transfers changed/newly added files.
# Push the backup to the remote server using the specific SSH key:
rsync -avz -e "ssh -i \$HOME/.ssh/server_backup_ssh_key -p \$REMOTE_PORT -o StrictHostKeyChecking=no" --delete "\$BACKUP_DIR/" "\${REMOTE_USER}@\${REMOTE_IP}:\${REMOTE_DEST}"

echo "[\$TIMESTAMP] Backup process completed!"
EOF
    chmod +x backup_db.sh
    echo "backup_db.sh has been successfully generated."

    echo -e "\n\033[1;33m>>> ATTENTION: REQUIRED FOR PASSWORDLESS TRANSFER <<<\033[0m"
    echo "Please copy the following Public Key and append it as a new line into the target server's (~/.ssh/authorized_keys) file:"
    echo "--------------------------------------------------------"
    cat "${SSH_KEY_PATH}.pub"
    echo "--------------------------------------------------------"
    read -p "Press ENTER to continue after you have added the key to the target server..."

    echo -e "\n--- Cronjob (Scheduled Task) Setup ---"
    read -p "Do you want to enable automatic daily backups? (y/n): " DO_CRON
    if [[ "$DO_CRON" =~ ^[Yy]$ ]]; then
        read -p "At what hour should the backup run daily? (0-23) [Default: 03]: " CRON_HOUR
        CRON_HOUR=${CRON_HOUR:-3}
        # Basic validation for hour
        if ! [[ "$CRON_HOUR" =~ ^([0-9]|0[0-9]|1[0-9]|2[0-3])$ ]]; then
            echo "Invalid hour entered, using default (03)."
            CRON_HOUR=3
        fi
        
        CRON_CMD="0 $CRON_HOUR * * * $(pwd)/backup_db.sh > /dev/null 2>&1"
        # If backup_db.sh cronjob exists, remove and re-add
        (crontab -l 2>/dev/null | grep -v "backup_db.sh"; echo "$CRON_CMD") | crontab -
        echo "Cronjob added successfully! (It will run daily at $CRON_HOUR:00)"
    fi
    echo "Backup setup completed!"
fi
