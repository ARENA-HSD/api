# Temel imaj olarak resmi Bun imajını kullanıyoruz
FROM oven/bun:1 AS base
WORKDIR /app

# --- 1. Aşama: Bağımlılıkları Yükle (Cache Katmanı) ---
# Bu aşama sadece package.json değişirse çalışır.
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
# --frozen-lockfile: Lock dosyasına sadık kalır, güncelleme yapmaz (Hız ve güvenlik için)
RUN cd /temp/dev && bun install --frozen-lockfile

# --- 2. Aşama: Build (Derleme) ---
FROM base AS prerelease
WORKDIR /app
# Önceki aşamadan cache'lenmiş node_modules'ü kopyala
COPY --from=install /temp/dev/node_modules node_modules
# Şimdi kaynak kodları kopyala (En sık değişen kısım burası olduğu için sona koyduk)
COPY . .

ENV NODE_ENV=production

# ElysiaJS uygulamasını tek bir binary dosyaya derle
# Bu işlem node_modules klasörüne olan ihtiyacı final imajda ortadan kaldırır
RUN bun build \
    --compile \
    --minify-whitespace \
    --minify-syntax \
    --target bun \
    --outfile server \
    ./src/index.ts

# --- 3. Aşama: Final (Release) ---
# Google'ın distroless imajını kullanarak ultra güvenli ve küçük boyutlu bir imaj oluşturuyoruz
FROM gcr.io/distroless/base-debian12
WORKDIR /app

# Sadece derlenmiş "server" dosyasını alıyoruz
COPY --from=prerelease /app/server server

ENV NODE_ENV=production
EXPOSE 3000

CMD ["./server"]