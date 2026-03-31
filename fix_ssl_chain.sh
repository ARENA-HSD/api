#!/bin/bash

# SSL Zincir Düzenleme Betiği
# Bu betik, Cloudflare Origin CA sertifikanızı Cloudflare Root CA ile birleştirerek 
# "Full Chain" (Tam Zincir) oluşturur.

CERT_PATH="./config/nginx/origin.cert.pem"
ROOT_CA_URL="https://developers.cloudflare.com/ssl/static/origin_ca_rsa_root.pem"
ROOT_CA_TMP="/tmp/cloudflare_root.pem"

# 1. Dosya Kontrolü
if [ ! -f "$CERT_PATH" ]; then
    echo "Hata: $CERT_PATH bulunamadı!"
    exit 1
fi

# 2. Mevcut Zincir Kontrolü (Zaten birden fazla sertifika var mı?)
CERT_COUNT=$(grep -c "BEGIN CERTIFICATE" "$CERT_PATH")
if [ "$CERT_COUNT" -gt 1 ]; then
    echo "Bilgi: Sertifika zaten birden fazla blok içeriyor (Muhtemelen zaten Full Chain)."
    exit 0
fi

echo "Sertifika tekil (leaf) olarak tespit edildi. Zincir tamamlanıyor..."

# 3. Cloudflare Root CA İndir
echo "Cloudflare Root CA indiriliyor..."
curl -sL "$ROOT_CA_URL" -o "$ROOT_CA_TMP"

if [ ! -s "$ROOT_CA_TMP" ]; then
    echo "Hata: Root CA indirilemedi!"
    exit 1
fi

# 4. Yedek Al ve Birleştir
cp "$CERT_PATH" "${CERT_PATH}.bak"
echo "" >> "$CERT_PATH" # Satır sonu garantisi
cat "$ROOT_CA_TMP" >> "$CERT_PATH"

echo "Başarılı: Sertifika güncellendi ve yedek alındı (${CERT_PATH}.bak)."
echo "Lütfen Nginx konteynerini yeniden başlatın veya reload yapın:"
echo "docker compose -f docker-compose.prod.yml exec nginx nginx -s reload"

# 5. Temizlik
rm "$ROOT_CA_TMP"
