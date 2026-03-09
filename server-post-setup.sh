#!/bin/bash

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
EOF

echo "Created .env file"

docker compose -f docker-compose.prod.yml up -d
echo "Success. API containers are running."

cd ../frontend
docker compose up -d
echo "Success. Frontend container is running."

cd ../
