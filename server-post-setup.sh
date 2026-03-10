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
read -p "TELEGRAM_WARNING_TOPIC_ID: " TELEGRAM_WARNING_TOPIC_ID
read -p "TELEGRAM_INFO_TOPIC_ID: " TELEGRAM_INFO_TOPIC_ID
read -p "TELEGRAM_ERROR_TOPIC_ID: " TELEGRAM_ERROR_TOPIC_ID
read -p "TELEGRAM_CRITICAL_TOPIC_ID: " TELEGRAM_CRITICAL_TOPIC_ID

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
EOF

echo "Created api .env file"

docker compose -f docker-compose.prod.yml up -d --build
echo "Success. API containers are running."

read -p "VITE_API_URL [example: http://localhost:3000]: " VITE_API_URL
read -p "VITE_BASE_DOMAIN [example: api.localhost.tr]: " VITE_BASE_DOMAIN

cat <<EOF > ../frontend/.env
# --- Bağlantı Linkleri ---
VITE_API_URL=${VITE_API_URL}
VITE_API_PORT=5173
VITE_BASE_DOMAIN=${VITE_BASE_DOMAIN}
EOF

cd ../frontend
docker compose -f docker-compose.prod.yml up -d --buiild
echo "Success. Frontend container is running."

cd ../
