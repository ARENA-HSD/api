# 📡 Telegram Log Sistemi

HSD Arena API'deki olayları **Telegram Forum grubu** üzerinden takip eden webhook tabanlı loglama sistemidir.

## Mimari

```
┌─────────────────┐     logEvent()      ┌──────────────┐    HTTP POST     ┌─────────────────────────┐
│   HSD Arena API │ ──────────────────► │ log.helper.ts│ ──────────────► │ Telegram Bot API        │
│   (Elysia)      │  fire-and-forget    │              │                 │ /sendMessage             │
└─────────────────┘                     └──────────────┘                 └────────┬────────────────┘
                                                                                  │ message_thread_id
                                                                                  ▼
                                                                     ┌────────────────────────┐
                                                                     │ ARENA PROJESİ BİLDİRİM │
                                                                     │ (Tek Forum Grubu)      │
                                                                     ├────────────────────────┤
                                                                     │ ⚡ WARNING  (topic: 5) │
                                                                     │ ℹ️ INFO     (topic: 7) │
                                                                     │ ❗ ERROR    (topic: 6) │
                                                                     │ ‼️ CRITICAL (topic: 2) │
                                                                     └────────────────────────┘
```

## Nasıl Çalışır?

1. Uygulama içinde bir olay tetiklendiğinde `logEvent()` fonksiyonu çağrılır.
2. Fonksiyon, olayın **seviyesine** göre ilgili konu ID'sini (`message_thread_id`) seçer.
3. Mesajı formatlar (ikon, seviye, kaynak, zaman, detay) ve Telegram Bot API'ye HTTP POST gönderir.
4. İstek **fire-and-forget** mantığıyla çalışır — ana iş akışını bloklamaz, kullanıcı gecikme yaşamaz.

## Seviye Açıklamaları

| Seviye | Açıklama | Örnek Olaylar |
|--------|----------|---------------|
| ⚠️ **WARNING** | Sistem çalışıyor ama şüpheli durum var | Geçersiz PIN, yetkisiz erişim denemesi |
| ℹ️ **INFO** | Bilgilendirme amaçlı kayıtlar | Genel sistem olayları |
| ❌ **ERROR** | Bir işlem başarısız oldu | Veritabanı sorgu hatası, WebSocket broadcast hatası |
| 🔺 **CRITICAL** | Sistem çöktü, acil müdahale gerekli | DB/Redis bağlantı kaybı, Publisher hatası |

## Loglanan Olaylar

| Modül | Olay | Seviye |
|-------|------|--------|
| Auth | `auth.token.error` | ERROR |
| Organizations | `org.access.denied` | WARNING |
| Organizations | `org.db.error` | ERROR |
| Quizzes | `quiz.access.denied` | WARNING |
| Quizzes | `quiz.db.error` | ERROR |
| Questions | `question.db.error` | ERROR |
| Invitations | `invitation.access.denied` | WARNING |
| Games | `game.join.invalid_pin` | WARNING |
| Games | `game.start.denied` | WARNING |
| Games | `game.player.disconnected` | WARNING |
| WebSocket | `ws.unknown_event` | WARNING |
| WebSocket | `ws.parse.error` | ERROR |
| WebSocket | `ws.broadcast.error` | ERROR |
| PubSub | `pubsub.publish.error` | ERROR |
| Infrastructure | `db.connection.failed` | CRITICAL |
| Infrastructure | `redis.connection.failed` | CRITICAL |
| Infrastructure | `ws.publisher.error` | CRITICAL |

## Ortam Değişkenleri

```env
TELEGRAM_BOT_TOKEN=           # BotFather'dan alınan bot tokeni
TELEGRAM_CHAT_ID=             # Forum grubunun chat ID'si
TELEGRAM_WARNING_TOPIC_ID=    # ⚠️ WARNING konusunun thread ID'si
TELEGRAM_INFO_TOPIC_ID=       # ℹ️ INFO konusunun thread ID'si
TELEGRAM_ERROR_TOPIC_ID=      # ❌ ERROR konusunun thread ID'si
TELEGRAM_CRITICAL_TOPIC_ID=   # 🔺 CRITICAL konusunun thread ID'si
```

> **Not:** Bu değişkenler `docker-compose.dev.yml` içinde de tanımlıdır. Değişiklik yapıldığında `docker compose up -d` ile konteyner yenilenmelidir.

## Kullanım

```typescript
import { logEvent } from '@/shared/helpers/log.helper';

logEvent({
  event: 'user.login.failed',   // Olay adı
  level: 'WARNING',              // INFO | WARNING | ERROR | CRITICAL
  source: 'code',                // 'code' veya 'system'
  data: { userId: 123 },         // Opsiyonel ek veri
});
```

## Dosya Yapısı

```
src/shared/helpers/log.helper.ts   ← Merkezi logEvent() fonksiyonu
.env                                ← Token ve ID değerleri
.env.example                        ← Şablon
docker-compose.dev.yml              ← Docker ortam değişkenleri
```
