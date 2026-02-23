# Elysia with Bun runtime

## Kullanılan Teknolojiler
- Bun + Elysia ile API çatısı
- Drizzle ORM ve `postgres` sürücüsü
- PostgreSQL + Redis servisleri (docker-compose ile)
- Docker/Docker Compose ile konteyner orkestrasyonu

## Proje Yapısı (Enterprise Architecture)

Proje **Domain-Driven Design (DDD)** prensiplerine göre organize edilmiştir:

```
src/
├── config/                              # Merkezi konfigürasyon yönetimi
│   └── index.ts                         # Environment değişkenleri ve uygulama ayarları
│
├── core/                                # Altyapı katmanı (Infrastructure Layer)
│   ├── database/                        # Veritabanı yönetimi
│   │   ├── client.ts                    # Drizzle ORM client instance
│   │   └── schema/                      # Database schema tanımları
│   │       ├── index.ts                 # Schema barrel export
│   │       ├── organizations.ts         # Organizations tablosu
│   │       ├── users.ts                 # Users tablosu
│   │       ├── members.ts               # Members tablosu (org-user ilişkisi)
│   │       ├── quizzes.ts               # Quizzes tablosu
│   │       ├── questions.ts             # Questions tablosu
│   │       └── invitations.ts           # Invitations tablosu
│   └── cache/                           # Cache yönetimi
│       └── repositories/                # Redis repository pattern
│           └── game.repository.ts       # Game cache operations
│
├── modules/                             # İş mantığı modülleri (Domain Layer)
│   ├── auth/                            # Authentication modülü
│   │   └── auth.controller.ts           # Login/register endpoints
│   ├── games/                           # Games domain
│   │   ├── games.controller.ts          # HTTP routes & WebSocket handlers
│   │   ├── games.service.ts             # Game business logic
│   │   └── games.types.ts               # Game type definitions
│   ├── organizations/                   # Organizations domain
│   │   ├── organizations.controller.ts  # Org CRUD endpoints
│   │   └── organizations.service.ts     # Org business logic
│   ├── quizzes/                         # Quizzes domain
│   │   ├── quizzes.controller.ts        # Quiz CRUD endpoints
│   │   └── quizzes.service.ts           # Quiz business logic
│   ├── questions/                       # Questions domain
│   │   ├── questions.controller.ts      # Question CRUD endpoints
│   │   └── questions.service.ts         # Question business logic
│   ├── users/                           # Users domain
│   │   └── users.controller.ts          # User management endpoints
│   ├── invitations/                     # Invitations domain
│   │   └── invitations.controller.ts    # Invitation endpoints (stub)
│   └── members/                         # Members domain (empty)
│
├── middleware/                          # Cross-cutting concerns
│   ├── auth.middleware.ts               # JWT configuration & helpers
│   └── rbac.middleware.ts               # Role-based access control logic
│
├── shared/                              # Paylaşılan utilities
│   ├── helpers/                         # Yardımcı fonksiyonlar
│   │   └── crypto.helper.ts             # Şifreleme & hash utilities
│   └── utils/                           # Genel utilities
│       └── sanitize.util.ts             # Input sanitization
│
└── index.ts                             # Ana entry point - Elysia app
```

### Mimari Prensipleri

**1. Domain-Driven Design (DDD)**
- Her modül kendi business logic'ini içerir (self-contained)
- Modüller arası bağımlılık minimum düzeyde
- Mikroservis mimarisine kolay geçiş imkanı

**2. Separation of Concerns**
- `core/`: Altyapı ve teknik detaylar (DB, Cache)
- `modules/`: İş kuralları ve domain logic
- `middleware/`: Kesişen kaygılar (Auth, RBAC)
- `shared/`: Ortak yardımcı fonksiyonlar

**3. Modül Yapısı**
Her domain modülü şu yapıyı takip eder:
- `*.controller.ts`: HTTP routes ve request handling
- `*.service.ts`: Business logic ve data operations
- `*.types.ts`: TypeScript type definitions

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

**Grafana**
- http://localhost:3001 adresinden ulaşabilirsiniz.
- Kullanıcı adı: admin
- Şifre: admin
- Dashboard dosyası: `config/grafana/dashboards/arena_dashboard.json`
- Dashboard'u import etmek için: `Grafana -> Dashboards -> Import` -> `Upload JSON file`