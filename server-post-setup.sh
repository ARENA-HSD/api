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

echo -e "\n--- Cloudflare Turnstile ---"
read -p "TURNSTILE_SECRET_KEY: " TURNSTILE_SECRET_KEY

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

# --- CLOUDFLARE TURNSTILE ---
TURNSTILE_SECRET_KEY=${TURNSTILE_SECRET_KEY}
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
    read -p "Remote Server Username (e.g., root): " BACKUP_USER

    # Automatically determine destination based on user
    if [ "$BACKUP_USER" = "root" ]; then
        BACKUP_DEST="/root/arena_backups"
    else
        BACKUP_DEST="/home/$BACKUP_USER/arena_backups"
    fi
    echo "Target directory automatically set to: $BACKUP_DEST"

    # Replace variables in backup_db.sh using sed
    sed -i "s/^REMOTE_USER=.*/REMOTE_USER=\"$BACKUP_USER\"/" backup_db.sh
    sed -i "s/^REMOTE_IP=.*/REMOTE_IP=\"$BACKUP_IP\"/" backup_db.sh
    sed -i "s|^REMOTE_DEST=.*|REMOTE_DEST=\"$BACKUP_DEST\"|" backup_db.sh

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
