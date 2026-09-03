# SaaS Platform

Fastify + Prisma + PostgreSQL backend ve Next.js (App Router) frontend'den oluşan çok
kiracılı olmayan (tek site), admin panelli bir SaaS/CMS platformu. Sayfa/blog/ürün/portföy
içerik yönetimi, e-posta şablonu editörü, iletişim formu, üyelik/organizasyon/faturalama
(Stripe) ve genel amaçlı bir public API içerir.

> Kaynak doğruluk (single source of truth): API kontratı için
> `docs/architecture/openapi.yaml` + `docs/architecture/shared-types.ts`; mimari kararlar
> için `docs/architecture/ARCHITECTURE.md`. Bu README onların **özetidir** — çelişki
> durumunda kontrat/mimari doküman geçerlidir.

## İçindekiler

- [Hızlı başlangıç (Docker)](#hızlı-başlangıç-docker)
- [Yerel geliştirme (Docker'sız)](#yerel-geliştirme-dockersız)
- [Ortam değişkenleri](#ortam-değişkenleri)
- [Klasör yapısı](#klasör-yapısı)
- [Test](#test)
- [Dokümantasyon haritası](#dokümantasyon-haritası)
- [Ajan orkestrasyonu](#ajan-orkestrasyonu)

## Hızlı başlangıç (Docker)

Tam yığın (Postgres + backend + frontend) tek komutla ayağa kalkar:

```bash
cp backend/.env.example backend/.env        # gerekli alanları doldurun, bkz. aşağıdaki tablo
docker compose up --build
```

- Backend: http://localhost:4000/api/v1 (healthcheck: `GET /api/v1/healthz`)
- Frontend: http://localhost:3000 (healthcheck: `GET /api/health`)

**Önemli:** backend container'ı başlarken şemayı otomatik migrate ETMEZ. İlk kurulumda
(veya yeni bir migration eklendiğinde) migration'ları elle uygulamanız gerekir — bkz.
`INFRA.md` (devops-agent tarafından tutulur) "Tam `docker compose up` doğrulaması" bölümü.

Yalnızca veritabanına ihtiyaç duyan backend geliştirmesi (container'sız, `tsx watch` ile)
için `backend/docker-compose.yml` (db-only) kullanılabilir — kök `docker-compose.yml`'nin
yerini almaz, ek bir seçenektir.

## Yerel geliştirme (Docker'sız)

```bash
# 1) Veritabanı (yalnızca Postgres için Docker kullanılabilir)
cd backend
docker compose up -d          # db-only compose

# 2) Backend
cp .env.example .env          # DATABASE_URL vb. doldurun
npm install
npm run prisma:migrate        # şemayı uygula
npm run seed                  # başlangıç verisi (sistem e-posta şablonları, iletişim formu vb.)
npm run dev                   # http://localhost:4000

# 3) Frontend (ayrı terminal)
cd ../frontend
cp .env.local.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

Diğer yararlı komutlar (her iki paket için ortak desen — `npm run <script>`):

| Komut | backend | frontend |
|---|---|---|
| Lint | `npm run lint` | `npm run lint` |
| Tip kontrolü | `npm run typecheck` | `npm run typecheck` |
| Unit/entegrasyon test | `npm test` | `npm test` |
| E2E test | — | `npm run test:e2e` (Playwright) |
| Prisma Studio | `npm run prisma:studio` | — |
| Prod build | `npm run build` | `npm run build` |

## Ortam değişkenleri

Örnek dosyalar: `backend/.env.example`, `frontend/.env.local.example`. Her yeni config
eklendiğinde bu dosyalar devops-agent koordinasyonuyla güncel tutulur; aşağıdaki tablo
sık kullanılanların **özetidir**, tam liste + gerekçe yorumları için `.env.example`
dosyalarının kendisine bakın.

**backend/.env** (öne çıkanlar):

| Değişken | Açıklama |
|---|---|
| `DATABASE_URL` | Postgres bağlantı dizesi |
| `FRONTEND_URL` / `PUBLIC_URL` | CORS, e-posta linkleri, medya URL'leri için |
| `JWT_PRIVATE_KEY_BASE64` / `JWT_PUBLIC_KEY_BASE64` | RS256 anahtar çifti (dev'de boşsa geçici anahtar üretilir) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Faturalama |
| `SMTP_*` | E-posta gönderimi (boşsa dev'de otomatik Ethereal test hesabı — e-posta şablonu editörünün test gönderimi ve iletişim formu bildirimleri bunu kullanır) |
| `ENCRYPTION_KEY` | 2FA TOTP secret şifrelemesi (AES-256-GCM) |
| `STORAGE_DRIVER`, `S3_*` | Medya depolama (local veya S3-uyumlu) |
| `SENTRY_DSN` | Hata takibi (boşsa devre dışı) |
| `CUSTOM_CODE_ENABLED` | Özel CSS/JS kill switch |

**frontend/.env.local**:

| Değişken | Açıklama |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend adresi (`/api/v1` dahil) |
| `NEXT_PUBLIC_SITE_URL` | sitemap/robots için mutlak URL üretimi |
| `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_*` | Hata takibi (client + server) |

> E-posta şablonu editörü ve iletişim formu için **ayrı bir env değişkeni gerekmez** —
> mevcut `SMTP_*`/`FRONTEND_URL` yapılandırmasını yeniden kullanır.

## Klasör yapısı

```
.
├── backend/                    # Fastify + Prisma API
│   ├── prisma/                 # schema.prisma, migrations/, seed.ts
│   └── src/
│       ├── modules/            # her domain kendi klasöründe: *.routes.ts, *.schemas.ts, *.service.ts
│       │   ├── email-templates/    # §10.16 e-posta şablonu blok editörü
│       │   ├── contact/            # §10.16 iletişim formu
│       │   ├── products/           # §10.9.2 ürün varyasyonu (ProductVariant) + PDF döküman (ProductDocument) + kargo eşiği
│       │   ├── demo-templates/     # §10.22 1 tıkla hazır demo şablon içe aktarıcı (modern-architecture, ecommerce-pro)
│       │   └── pages/              # §10.17 sayfa Grid/Kolon düzeni burada (pages.schemas.ts, lib/sanitize-blocks.ts)
│       ├── lib/                 # paylaşılan yardımcılar (email-renderer.ts, html-sanitize.ts, rate-limit.ts, ...)
│       └── plugins/             # Fastify plugin'leri (prisma, auth, vb.)
├── frontend/                    # Next.js (App Router)
│   └── src/
│       ├── app/
│       │   ├── admin/            # yönetim paneli (notifications/templates, contact, pages, ...)
│       │   └── [lang]/(site)/    # public site (locale-prefixli)
│       ├── components/admin/     # email-editor/, page-builder/ dahil
│       └── lib/api/              # backend API istemcileri (tip güvenli fetch sarmalayıcıları)
├── docs/architecture/
│   ├── ARCHITECTURE.md          # mimari kararlar (architect sahipliğinde) — TEK doğruluk kaynağı
│   ├── openapi.yaml              # API kontratı (Swagger UI/Redoc ile render edilebilir)
│   └── shared-types.ts           # frontend/backend'in paylaştığı tip tanımları
├── docker-compose.yml            # tam yığın (db+backend+frontend)
├── INFRA.md                      # altyapı/deploy notları (devops-agent)
├── TEST_COVERAGE.md              # e2e/entegrasyon test kapsamı (qa-agent)
└── CHANGELOG.md
```

## Test

Katman haritası ve hangi akışların kapsandığı için bkz. `TEST_COVERAGE.md`
(qa-agent tarafından her yeni özellikten sonra güncellenir). Özetle:

| Katman | Araç | Konum |
|---|---|---|
| Backend unit | Vitest | `backend/tests/unit/` |
| Backend entegrasyon | Vitest + `app.inject` (gerçek Postgres) | `backend/tests/integration/` |
| Frontend unit | Vitest + Testing Library + jest-axe | `frontend/tests/unit/` |
| E2E | Playwright (gerçek tarayıcı + gerçek backend/frontend) | `frontend/tests/e2e/` |

```bash
cd frontend
npx playwright install chromium   # ilk kurulumda
npm run test:e2e
```

## API dokümantasyonu nasıl render edilir

`docs/architecture/openapi.yaml`, OpenAPI 3.0.3 formatındadır ve herhangi bir Swagger
UI/Redoc aracıyla doğrudan render edilebilir, örneğin:

```bash
npx @redocly/cli preview-docs docs/architecture/openapi.yaml
# veya
npx swagger-ui-watcher docs/architecture/openapi.yaml
```

Yeni bir endpoint eklendiğinde bu dosya backend-agent tarafından güncellenir; frontend
API istemcileri (`frontend/src/lib/api/*`) ve backend route şemaları bu kontrata uymalıdır
— uyumsuzluk durumunda kontrat kazanır.

## Dokümantasyon haritası

| Dosya | İçerik | Sahibi |
|---|---|---|
| `docs/architecture/ARCHITECTURE.md` | Mimari kararlar, veri modeli, kapsam/kapsam-dışı gerekçeleri | architect |
| `docs/architecture/openapi.yaml` | API kontratı (uçlar, şemalar, hata kodları) | backend-agent (architect onayıyla) |
| `docs/architecture/shared-types.ts` | Frontend/backend paylaşımlı TypeScript tipleri | backend-agent |
| `README.md` (bu dosya) | Kurulum, geliştirme akışı, klasör yapısı | documentation-agent |
| `CHANGELOG.md` | Sürüm/özellik geçmişi | documentation-agent |
| `INFRA.md` | Docker/CI-CD/deploy detayları | devops-agent |
| `TEST_COVERAGE.md` | E2E/entegrasyon test kapsamı, bilinen bug'lar | qa-agent |
| `.claude/design-notes-*.md` | Görsel/etkileşim tasarım kararları | ui-designer |

## Ajan orkestrasyonu

Bu proje, sorumluluk alanlarına ayrılmış ajanlarla geliştirilir (architect, backend-agent,
frontend-agent, db-agent, ui-designer, security-agent, compliance-agent, qa-agent,
documentation-agent, devops-agent, observability-agent, code-quality-agent,
performance-agent). Ortak protokol, görev akışı ve "Definition of Done" kriterleri için
bkz. `.claude/CLAUDE.md`.
