# Elysia with Bun runtime

## Kullanılan Teknolojiler
- Bun + Elysia ile API çatısı
- Drizzle ORM ve `postgres` sürücüsü
- PostgreSQL + Redis servisleri (docker-compose ile)
- Docker/Docker Compose ile konteyner orkestrasyonu

## Docker ile Çalıştırma (Geliştirme)
1) Ortam değişkenlerini ayarla(.env.example dosyasından faydalanarak): `DATABASE_URL`, `REDIS_URL`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
2) Servisleri ayağa kaldır: `docker compose -f docker-compose.dev.yml up -d --build`
3) Shema değişikliklerini database gönder: `docker compose -f docker-compose.dev.yml exec api bun run db:push` 
4) Logları izle (isteğe bağlı): `docker compose -f docker-compose.dev.yml logs -f api`
5) Durdurmak için: `docker compose -f docker-compose.dev.yml down`

**Not1:** Shema değişiklikleri database'e gönderildikten sonra servislerin `docker compose -f docker-compose.dev.yml up -d --build` komutu ile yenilenmesi önerilir.
**Not2:** Container'lar healthcheck ile PostgreSQL ve Redis'in tamamen hazır olmasını bekler, ardından API başlar.

## Drizzle ORM Komutları
- Şema değişikliklerini veritabanına gönder: `bun run db:push`
- Migration dosyası oluştur: `bun run db:generate`
- Migration'ları çalıştır: `bun run db:migrate`
- Drizzle Studio'yu aç (Veritabanı GUI): `bun run db:studio`

## Servis URL'leri (Development)
- **API**: http://localhost:3000
- **OpenAPI/Swagger**: http://localhost:3000/openapi
- **pgAdmin (Database GUI)**: http://localhost:8081
- **WebSocket**: ws://localhost:3000/games/ws

**pgAdmin Credentials:**
- Server: `postgres`
- Database: `arena_db`
- Username: `admin`
- Password: `.env` dosyasındaki `DB_PASSWORD`