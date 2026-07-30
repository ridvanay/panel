# Backend — SaaS Platform API

`docs/architecture/openapi.yaml` ve `docs/architecture/shared-types.ts` kontratının Fastify +
Prisma + PostgreSQL implementasyonu. Kontrat değişmeden bu servisin dış davranışı değişmez.

## Kurulum

Yerel geliştirme için Postgres, `docker-compose.yml` ile ayağa kaldırılır (Docker Desktop kurulu
ve çalışıyor olmalı). `.env` zaten bu compose servisiyle eşleşecek şekilde repoda hazır duruyor
(gitignore'lu — gerçek/paylaşılan bir ortamda bu değerleri asla kullanmayın).

```bash
cd backend
npm install
docker compose up -d       # yerel Postgres'i başlatır (localhost:5432, saas_dev)
npm run prisma:migrate     # şemayı DB'ye uygula (dev)
npm run seed                # örnek planları ekler
npm run dev
```

Sunucu `http://localhost:4000/api/v1` altında ayağa kalkar; sağlık kontrolü: `GET /api/v1/healthz`.

Docker kullanmıyorsanız: `.env` içindeki `DATABASE_URL`'i kendi Postgres bağlantı bilgilerinizle
değiştirin, `docker compose up -d` adımını atlayın, geri kalanı aynı.

Durdurmak için: `docker compose down` (veriyi de silmek isterseniz `docker compose down -v`).

## Mimari plandan bilinçli sapmalar

`../docs/architecture/ARCHITECTURE.md` bölüm 5'te JWT'ye `org_id`/`role` claim'i gömülüp
organizasyon değişiminde token'ın yenileneceği belirtilmişti. Implementasyonda bunun yerine:

- **Access token yalnızca `sub` (userId) ve `email` taşır.** Organizasyon/rol bilgisi her
  `:orgId` içeren istekte `Membership` tablosundan taze okunur (`middleware/rbac.ts`).
- **Neden:** kontrattaki tüm organizasyon-kapsamlı uçlar zaten `orgId`'yi path parametresi
  olarak taşıyor (header değil) ve bu yaklaşım (a) kullanıcının birden fazla organizasyonu
  varken "aktif org" değişimi için ayrı bir token-yenileme uç noktası gerektirmiyor, (b) rol
  bir üyelikten alınıp/geri verilse bile JWT süresi dolana kadar bayatlamış yetkiyle
  çalışmıyor (ör. bir ADMIN OWNER tarafından MEMBER'a düşürüldüğünde bir sonraki istekte
  anında yansır, token yenilenmesini beklemez).
- Bedeli: organizasyon-kapsamlı her istekte bir ekstra `Membership` sorgusu. Ölçek sorun
  olursa Redis'te `userId:orgId -> role` kısa TTL'li cache eklenebilir; kontrat/response
  şekli değişmez.

Bu sapma mimarın (`docs/architecture/ARCHITECTURE.md`) gözden geçirmesi için not düşülmüştür;
onaylanırsa doküman buna göre güncellenmeli.

## Klasör yapısı

```
prisma/schema.prisma       # veri modeli — ARCHITECTURE.md §6 ile birebir
src/config/env.ts          # zod ile doğrulanmış ortam değişkenleri
src/lib/                   # errors, envelope, password, jwt/keys, tokens, pagination, slug, stripe
src/plugins/                # prisma, security (cors/helmet/rate-limit/cookie), error-handler
src/middleware/              # authenticate (JWT), rbac (org rolü guard'ı)
src/schemas/                # openapi.yaml component şemalarının zod karşılığı
src/mappers/                 # Prisma model -> API DTO dönüşümleri
src/modules/<isim>/          # her kaynak için *.routes.ts (+ *.schemas.ts, *.service.ts)
src/app.ts / src/server.ts   # Fastify bootstrap + giriş noktası
```

## Güvenlik notları

- Şifreler argon2id ile hash'lenir; şifre asla loglanmaz/döndürülmez.
- Access token RS256 JWT, 15 dk; refresh token opak+rastgele, DB'de yalnızca SHA-256 hash'i
  saklanır, her kullanımda rotate edilir, tekrar kullanım tespitinde kullanıcının tüm
  oturumları iptal edilir.
- Fiyat/limit gibi değerler yok (bu kapsamda), ama örnek: abonelik durumu her zaman Stripe
  webhook'undan senkronize edilir — istemciden gelen hiçbir alan doğrudan yazılmaz.
- `/webhooks/stripe` imzası `STRIPE_WEBHOOK_SECRET` ile doğrulanır; body bu route için ham
  (parse edilmemiş) okunur.

## Eksik / sıradaki adımlar

- Gerçek e-posta sağlayıcısı (Resend/SES) — şu an davet ve şifre sıfırlama bağlantıları
  yalnızca sunucu loguna yazılıyor (`TODO(email-provider)` yorumlarına bakın).
- Test paketi (Vitest/Node test runner ile modül testleri) eklenmedi.
- `npm install`, `prisma generate`, `tsc build` ve (sahte prisma decorator'ıyla) tüm route'ların
  çakışmasız kaydolduğu bir duman testi bu ortamda çalıştırılıp doğrulandı. Gerçek bir Postgres'e
  karşı `prisma migrate dev` ise bu ortamda mevcut olmadığı için hiç çalıştırılmadı — ilk
  `docker compose up -d` + `npm run prisma:migrate` adımını siz çalıştırdığınızda doğrulanmış olur.
