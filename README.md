# Elysia with Bun runtime

## Kullanılan Teknolojiler
- Bun + Elysia ile API çatısı
- Drizzle ORM ve `postgres` sürücüsü
- PostgreSQL + Redis servisleri (docker-compose ile)
- Docker/Docker Compose ile konteyner orkestrasyonu

## Docker ile Çalıştırma (Geliştirme)
1) Ortam değişkenlerini ayarla: `DATABASE_URL`, `REDIS_URL`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
2) Servisleri ayağa kaldır: `docker compose -f docker-compose.dev.yml up -d --build`
3) Logları izle (isteğe bağlı): `docker compose -f docker-compose.dev.yml logs -f api`
4) Durdurmak için: `docker compose -f docker-compose.dev.yml down`