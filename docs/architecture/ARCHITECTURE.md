# Mimari Plan — SaaS / Kurumsal Uygulama

Durum: Taslak v1 · Sahibi: Mimar (Ekip Lideri) · Tüketiciler: `frontend-agent`, `backend-agent`

Bu doküman frontend ve backend ajanlarının bağımsız çalışıp birbiriyle uyumlu kod
üretebilmesi için sözleşme (contract) niteliğindedir. API şekli değişirse önce bu
dosya ve `openapi.yaml` / `shared-types.ts` güncellenir, sonra kod yazılır.

## 1. Kapsam ve varsayımlar

- Çok kiracılı (multi-tenant) bir SaaS: kullanıcılar bir veya birden fazla
  **Organizasyon**'a üye olur, her organizasyonun bir **Plan/Abonelik**i vardır.
- Standart özellik seti: kayıt/giriş, organizasyon yönetimi, üye davet/rol
  yönetimi, faturalandırma (Stripe), kullanıcı profili, dashboard.
- Somut bir ürün/domain (ör. proje yönetimi, CRM vb.) belirtilmediği için domain'e
  özel varlıklar (Project, Ticket, ...) bu plana **dahil edilmemiştir** — SaaS
  iskeletinin üstüne aynı desenle eklenmesi amaçlanmıştır.

## 2. Teknoloji yığını

| Katman | Seçim | Not |
|---|---|---|
| Frontend | Next.js 14+ (App Router), React, TypeScript, Tailwind CSS | `frontend-agent` standardı |
| Backend | Node.js + Fastify, TypeScript | `backend-agent` standardı (Node seçeneği) |
| ORM / DB | Prisma + PostgreSQL | İlişkisel, migration'lı şema |
| Cache / Oturum / Rate-limit | Redis | Refresh token deny-list, rate limit sayaçları |
| Doğrulama | Zod (ortak şema — hem FE form hem BE input validation aynı şemayı paylaşabilir) | |
| Auth | JWT (access, 15 dk, RS256) + rotasyonlu refresh token (httpOnly cookie, 30 gün) | |
| Ödeme | Stripe (Checkout + Billing Portal + Webhooks) | |
| Dosya depolama | S3 uyumlu object storage (avatar, vb.) | |
| E-posta | Resend/SES (doğrulama, davet, şifre sıfırlama) | |
| Dağıtım | Frontend: Vercel/Node edge; Backend: konteyner (Fly.io/Render/ECS) | |
| Gözlemlenebilirlik | OpenTelemetry + yapılandırılmış log (pino) | |
| Toplu içe aktarma | `saxes` (XML/WXR), `csv-parse` (CSV), `yauzl` (ZIP), `sanitize-html` (HTML) | Seçim gerekçeleri ve reddedilen alternatifler §10.8.3'te — backend-agent tek başına değiştiremez |

## 3. Sistem mimarisi

```mermaid
flowchart LR
  subgraph Client
    Web["Next.js Web App (SSR + CSR)"]
  end

  subgraph API["Backend API - Node.js/Fastify - /api/v1"]
    Auth[Auth Modülü]
    Org[Organizasyon ve Üyelik Modülü]
    Billing[Faturalandırma Modülü]
    Users[Kullanıcı Modülü]
    Webhooks[Webhook Handler]
  end

  subgraph Data
    PG[(PostgreSQL)]
    Redis[(Redis)]
    ObjStore[(S3 - dosyalar)]
  end

  subgraph External
    Stripe[Stripe]
    Email[Email Sağlayıcı]
  end

  Web -->|HTTPS/JSON, Bearer/Cookie| API
  Auth --> PG
  Auth --> Redis
  Org --> PG
  Users --> PG
  Users --> ObjStore
  Billing --> PG
  Billing <--> Stripe
  Auth --> Email
  Org --> Email
  Stripe -.webhook.-> Webhooks
  Webhooks --> PG
```

- Frontend backend'e **doğrudan DB erişimi olmadan**, yalnızca REST/JSON API
  üzerinden konuşur. Next.js Server Components/Route Handlers backend'e sunucu
  tarafında proxy yapabilir (secret tutmak için), ama iş mantığı backend'dedir.
- Backend stateless'tir; oturum durumu Redis'te (refresh token rotasyonu, rate
  limit) tutulur, yatay ölçeklenebilir.

## 4. Çok kiracılılık (multi-tenancy) modeli

- **Paylaşımlı veritabanı + `organization_id` sütunu** (row-level tenancy).
  Erken/orta ölçek SaaS için en düşük operasyonel maliyetli model; ileride
  büyük müşteriler için şema-başına-kiracıya geçiş kapıyı kapatmaz.
- Her istekte aktif organizasyon `X-Org-Id` header'ı (veya JWT içine gömülü
  `org_id` claim'i, kullanıcı org değiştirdiğinde token yenilenir) ile belirlenir.
- Backend'de her repository/sorgu katmanında zorunlu `organization_id` filtresi
  — tenant izolasyonu ORM seviyesinde (Prisma middleware) merkezi olarak uygulanır,
  her endpoint'te elle tekrarlanmaz.

## 5. Kimlik doğrulama ve yetkilendirme

- **Kayıt/giriş**: e-posta + şifre (argon2id hash). OAuth (Google) v2 kapsamında.
- **Access token**: JWT, RS256, 15 dk ömür, gövdede `sub` (userId), `org_id`,
  `role` claim'leri.
- **Refresh token**: opak, rastgele 256-bit, httpOnly + Secure + SameSite=Strict
  cookie, 30 gün, DB/Redis'te hash'lenerek saklanır, her refresh'te rotate edilir
  (tekrar kullanım tespiti = tüm oturumları iptal et).
- **CSRF**: cookie tabanlı refresh akışı için double-submit token veya
  `SameSite=Strict` + özel header kontrolü.
- **Yetkilendirme (RBAC)**: organizasyon bazlı roller — `OWNER`, `ADMIN`,
  `MEMBER`. Rol kontrolü backend'de merkezi bir guard/middleware ile yapılır;
  frontend yalnızca UI'ı role göre gizler/gösterir, gerçek yetki kontrolü asla
  istemciye güvenmez (bkz. mutfak konfigüratör projesindeki fiyat motoru
  deseni — istemci değeri her zaman sunucuda yeniden doğrulanır).
- **Site-geneli RBAC (`/admin/*` CMS uçları) — 5 KADEMELİ MODEL (§10.21)**: yukarıdaki
  organizasyon bazlı RBAC'tan tamamen AYRI bir eksen. `User.role` (`SiteRole`:
  `ADMIN`/`MANAGER`/`EDITOR`/`CUSTOMER`/`USER`) ve `User.status` (`SiteUserStatus`:
  `ACTIVE`/`SUSPENDED`/`DELETED`) kullanılır. Rol/durum kasıtlı olarak JWT'ye GÖMÜLMEZ — her
  istekte `authenticate` middleware'i DB'den taze okur, böylece bir rol değişikliği
  veya askıya alma bir sonraki istekte hemen etkili olur (access token süresinin
  dolmasını beklemeden). Guard'lar: `requirePanelAccess` (panel kapısı) +
  `requireSiteRole` (uç bazlı, bkz. `middleware/site-rbac.ts`).

  - **Panel kapısı (bağlayıcı):** `/admin/*` altındaki her uca yalnızca `ADMIN`,
    `MANAGER`, `EDITOR` erişebilir; `CUSTOMER` ve `USER` → **403**. Tek istisna,
    self-servis `/admin/settings/security/2fa` ve `/admin/settings/security/sessions`
    uçlarıdır (`authenticated`, 5 rolün hepsi). Bu, ön yüz kullanıcılarının kendi
    kendine kayıt olabilmesi nedeniyle **zorunludur** — "authenticated" artık panel
    için yeterli bir eşik DEĞİLDİR.
  - **`ADMIN`** (Süper Yönetici): her şey; **sayfa blok YAPISINI değiştirebilen TEK rol**.
  - **`MANAGER`** (Yönetici): ADMIN'in tüm yetkileri EKSİ beş kategori — (a) ayrıcalık
    yükseltme yüzeyi (`/admin/users`, `PATCH /admin/settings`, `/admin/settings/permissions`,
    `/admin/import/*`), (b) kimlik bilgisi yüzeyi (`api-keys`, `webhooks`), (c) keyfi kod
    yürütme (`/admin/appearance/custom-code/*`), (d) site-geneli kill switch
    (`PATCH /admin/modules/{key}`, `GET /admin/health`), (f) denetim izi (`/admin/logs`) —
    ve blok yapısı.
  - **`EDITOR`** (Editör): yalnızca `blog` (tam CRUD, kalıcı silme hariç) + `media`
    (kalıcı silme hariç) + `pages` (yalnızca içerik alanları). Diğer tüm modüllerde 403.
  - **`CUSTOMER`** / **`USER`**: panel yok. Aralarındaki fark API'de DEĞİL, ön yüz
    sunumundadır (`/siparislerim` bağlantısı). Yeni kayıtların varsayılanı `USER`'dır;
    `USER → CUSTOMER` terfisi, kimliği doğrulanmış bir siparişin ÖDENMESİYLE otomatik olur.

  Sistemde en az bir aktif `ADMIN` kalması zorunlu tutulur (son admin'i BAŞKA HERHANGİ bir
  role düşürmek/askıya almak/silmek 409 CONFLICT döner); bir kullanıcı kendi hesabını askıya
  alamaz veya silemez. Kullanıcı silme **yumuşak silmedir** (`status = DELETED` + `deletedAt`,
  geri alınabilir); `DELETED` kullanıcı `SUSPENDED` ile birebir aynı şekilde giriş
  yapamaz ve mevcut access token'ı kabul edilmez — bkz. §10.18.
  Tam modül × rol matrisi ve gerekçeler: **§10.21** +
  `.claude/architect-scope-rbac-5-tier.md` (bağlayıcı karar dokümanı).
- **Audit Log**: hassas/yetkilendirme aksiyonları (`auth.login` başarı/başarısızlık,
  `user.create`/`user.role_change`/`user.status_change`, `invitation.create`/
  `invitation.accept`, `settings.update`, ve `requireSiteRole` guard'ının
  engellediği her istek — `FORBIDDEN` durumuyla otomatik) değişmez şekilde
  `AuditLog` tablosuna yazılır (bkz. `lib/audit.ts`).
  `metadata` alanına asla token/URL/şifre yazılmaz. Sadece `ADMIN` rolü
  `GET /admin/logs` ile okuyabilir (en yeni kayıt önce, `status`/`action` öneki
  ile filtrelenebilir).

## 6. Veri modeli (özet ER)

```mermaid
erDiagram
  USER ||--o{ MEMBERSHIP : has
  ORGANIZATION ||--o{ MEMBERSHIP : has
  ORGANIZATION ||--o{ INVITATION : sends
  ORGANIZATION ||--o| SUBSCRIPTION : has
  PLAN ||--o{ SUBSCRIPTION : defines
  USER ||--o{ REFRESH_TOKEN : owns

  USER ||--o{ AUDIT_LOG : "acts (actorId, nullable)"

  USER ||--o{ BACKUP_CODE : "owns (§10.4)"
  USER ||--o{ CONTENT_REVISION : "edits (editedById, nullable, §10.1)"
  USER ||--o{ EMAIL_TEMPLATE : "updates (updatedById, nullable, §10.3)"

  USER {
    uuid id PK
    string email
    string passwordHash
    string name
    string avatarUrl
    datetime emailVerifiedAt
    enum role "SiteRole: ADMIN/MANAGER/EDITOR/CUSTOMER/USER — org-RBAC'tan ayrı, §10.21"
    enum status "SiteUserStatus: ACTIVE/SUSPENDED/DELETED — §10.18"
    datetime lastLoginAt
    datetime deletedAt "nullable, yumuşak silme damgası, §10.18"
    boolean twoFactorEnabled "§10.4"
    string twoFactorSecret "nullable, AES-256-GCM şifreli, §10.4"
    datetime twoFactorVerifiedAt "nullable, §10.4"
    datetime createdAt
  }
  CONTENT_REVISION {
    uuid id PK
    enum entityType "ContentEntityType: PAGE/BLOG_POST, §10.1"
    string entityId "polymorphic, FK yok"
    json snapshot
    uuid editedById FK "nullable, onDelete SetNull"
    string editedByName
    datetime createdAt
  }
  EMAIL_TEMPLATE {
    uuid id PK
    string key "unique, §10.3"
    string name
    string subject
    string bodyHtml
    json availableVariables
    uuid updatedById FK "nullable, onDelete SetNull"
    datetime updatedAt
    datetime createdAt
  }
  BACKUP_CODE {
    uuid id PK
    uuid userId FK "onDelete Cascade, §10.4"
    string codeHash
    datetime usedAt "nullable"
    datetime createdAt
  }
  AUDIT_LOG {
    uuid id PK
    uuid actorId FK "nullable, onDelete SetNull"
    string actorEmail
    string action
    enum status "AuditStatus: SUCCESS/FAILURE/FORBIDDEN"
    string targetType
    string targetId
    json metadata "asla token/URL/şifre içermez"
    string ipAddress
    datetime createdAt
  }
  ORGANIZATION {
    uuid id PK
    string name
    string slug
    uuid ownerId FK
    datetime createdAt
  }
  MEMBERSHIP {
    uuid id PK
    uuid userId FK
    uuid organizationId FK
    enum role
    enum status
    datetime createdAt
  }
  INVITATION {
    uuid id PK
    uuid organizationId FK
    string email
    enum role
    string tokenHash
    datetime expiresAt
    enum status
  }
  PLAN {
    uuid id PK
    string name
    string stripePriceIdMonthly
    string stripePriceIdYearly
    json limits
  }
  SUBSCRIPTION {
    uuid id PK
    uuid organizationId FK
    uuid planId FK
    enum status
    string stripeSubscriptionId
    datetime currentPeriodEnd
  }
  REFRESH_TOKEN {
    uuid id PK
    uuid userId FK
    string tokenHash
    datetime expiresAt
    boolean revoked
  }
```

## 7. API tasarım ilkeleri

- **Base path**: `/api/v1` — büyük kırıcı değişiklikler `v2` ile yapılır.
- **Zarf (envelope)**: başarı `{ "data": ... , "meta"?: ... }`; hata
  `{ "error": { "code": string, "message": string, "details"?: object } }`.
  HTTP status kodu her zaman doğru anlamı taşır (200/201/204/400/401/403/404/409/422/429/500).
- **Sayfalama**: cursor tabanlı — `?limit=20&cursor=<opaque>` →
  `meta: { nextCursor: string | null }`.
- **Kimlik doğrulama**: `Authorization: Bearer <accessToken>` (API istemcileri) veya
  httpOnly cookie (web app SSR). Public uçlar hariç tüm uçlarda zorunlu.
- **Doğrulama**: tüm request body/query Zod şemasıyla doğrulanır; başarısızsa `422`
  ve `details` içinde alan bazlı hatalar.
- **Idempotency**: ödeme/checkout gibi durum değiştiren kritik POST'larda
  `Idempotency-Key` header desteği.
- **Rate limiting**: kullanıcı/IP başına Redis token-bucket; aşımda `429` +
  `Retry-After`.
- Tam uç nokta sözleşmesi: **[`openapi.yaml`](./openapi.yaml)** (OpenAPI 3.0).
- Paylaşılan TypeScript arayüzleri (FE ve BE aynı tipleri kullanır):
  **[`shared-types.ts`](./shared-types.ts)**.

## 8. Uç nokta özeti

| Grup | Uç nokta | Yetki |
|---|---|---|
| Auth | `POST /auth/register` | public |
| Auth | `POST /auth/login` | public |
| Auth | `POST /auth/refresh` | refresh cookie |
| Auth | `POST /auth/logout` | authenticated |
| Auth | `POST /auth/forgot-password` / `POST /auth/reset-password` | public |
| Auth | `GET /auth/me` | authenticated |
| Users | `GET/PATCH /users/me` | authenticated |
| Users | `GET /users/me/orders` | authenticated (sahiplik filtresi `siteUserId = me`; rol guard'ı YOK — §10.21) |
| Orgs | `POST/GET /organizations`, `GET/PATCH/DELETE /organizations/{id}` | authenticated, rol bazlı |
| Members | `GET /organizations/{id}/members`, `PATCH/DELETE /organizations/{id}/members/{userId}` | ADMIN/OWNER |
| Invitations | `POST/GET /organizations/{id}/invitations`, `POST /invitations/{token}/accept` | ADMIN/OWNER (davet gönderme); token sahibi (kabul) |
| Plans | `GET /plans` | public |
| Billing | `GET /organizations/{id}/subscription`, `POST .../checkout-session`, `POST .../portal-session` | OWNER |
| Webhooks | `POST /webhooks/stripe` | Stripe imza doğrulaması |
| Health | `GET /healthz` | public |
| AdminUsers | `GET/POST /admin/users`, `PATCH /admin/users/{id}/role`, `PATCH /admin/users/{id}/status` | site-geneli `SiteRole=ADMIN` (okuma dahil — MANAGER'a da kapalı, §10.21) |
| AdminUsers | `GET /admin/settings/permissions` | site-geneli `SiteRole=ADMIN` |
| Logs | `GET /admin/logs` | site-geneli `SiteRole=ADMIN` |
| Navigation | `GET /navigation` | public |
| Navigation | `GET /admin/navigation` | `SiteRole=ADMIN/MANAGER/EDITOR` (panel kapısı) |
| Navigation | `PUT /admin/navigation` | site-geneli `SiteRole=ADMIN` veya `MANAGER` |
| Stats | `GET /admin/stats/*` | site-geneli `SiteRole=ADMIN` veya `MANAGER` (§10.21 — EDITOR çıkarıldı) |
| System | `GET /admin/health` | site-geneli `SiteRole=ADMIN` |
| ApiKeys | `GET/POST /admin/settings/api-keys`, `PATCH/DELETE /admin/settings/api-keys/{keyId}`, `POST .../revoke` | site-geneli `SiteRole=ADMIN` (okuma dahil, §10.13.10) |
| OutboundWebhooks | `GET/POST /admin/settings/webhooks`, `GET/PATCH/DELETE .../{webhookId}`, `POST .../rotate-secret`, `POST .../test`, `GET .../deliveries`, `POST .../deliveries/{id}/redeliver` | site-geneli `SiteRole=ADMIN` (okuma dahil, §10.13.10) |
| PublicApi | `GET /public/{me,pages,blog,products,portfolio}...` | `X-Api-Key` (API anahtarı, salt-okunur — §10.13.4/§10.13.5) |

> Not: `pages`/`blog`/`media`/`settings` CMS uçları (`/admin/pages`, `/admin/blog`,
> `/admin/media`, `/admin/settings`) bu tablonun ilk sürümünden sonra eklendi;
> tam sözleşmeleri için `openapi.yaml`'a bakın. Bu uçlardaki yazma işlemleri artık
> yukarıdaki site-geneli `SiteRole` guard'ına da tabidir (bkz. §5).

> **§10.21 UYARISI (bu tablo için bağlayıcı):** yukarıdaki ve aşağıdaki notlarda
> "authenticated" yazan HER `/admin/*` ucu, artık ayrıca **panel kapısından**
> (`ADMIN`/`MANAGER`/`EDITOR`) geçer — `CUSTOMER` ve `USER` 403 alır. Tek istisna
> `/admin/settings/security/2fa` ve `/admin/settings/security/sessions`'tır.
> Modül × rol matrisinin tamamı §10.21'dedir; çelişki durumunda §10.21 kazanır.

> Medya klasörleri: `GET /admin/media/folders` (`ADMIN`/`MANAGER`/`EDITOR`),
> `POST /admin/media/folders` + `PATCH /admin/media/folders/{folderId}` +
> `POST /admin/media/move` (`SiteRole=ADMIN`, `MANAGER` veya `EDITOR`),
> `DELETE /admin/media/folders/{folderId}` (`SiteRole=ADMIN` veya `MANAGER`). `Media.folderId`
> nullable (`null` = "Kategorisiz"), `GET /admin/media` `folderId` filtresi alır.
> Bağlayıcı kararlar için bkz. §10.11.

> Navigasyon/Header/Footer Yönetimi: `GET /navigation` (public — site
> header/nav/footer bunu okur), `GET /admin/navigation` (`ADMIN`/`MANAGER`/`EDITOR`),
> `PUT /admin/navigation` (`SiteRole=ADMIN` veya `MANAGER`, tam değiştirme/replace
> semantiği — `navigationItems`/`socialLinks`/`footerColumns` dizileri tek bir
> transaction içinde delete-then-recreate edilir). Modeller: `NavigationItem`,
> `SocialLink` (`SocialPlatform` enum), `FooterColumn` → `FooterLink` (1-n,
> `onDelete: Cascade`); ayrıca `SiteSettings`'e `headerCtaLabel`/`headerCtaHref`/
> `footerCopyrightText` eklendi. `NavigationItem` artık **hiyerarşiktir**
> (`parentId` self-relation, düz dizi + parentId; maksimum derinlik 2, kardeş-kapsamlı
> `order`, istemci tarafında üretilen `id`) — bağlayıcı kararlar ve self-FK insert
> sıralaması için bkz. §10.10. Tam sözleşme için `openapi.yaml`'daki
> `NavigationConfig`/`UpdateNavigationConfigRequest` şemalarına bakın.

> Site Özelleştirme (görünüm): `GET /appearance` (public — `(site)` layout'u SSR'de
> bunu okur, özel CSS/JS dahil), `GET /admin/appearance` +
> `GET /admin/appearance/presets` + `GET /admin/appearance/custom-code`
> (authenticated), `PATCH /admin/appearance` + `POST /admin/appearance/reset` +
> `PUT /admin/appearance/custom-code/css` + `PUT /admin/appearance/custom-code/js`
> (**yalnızca `SiteRole=ADMIN`, istisnasız**). İki yeni singleton model:
> `SiteAppearance` ve `SiteCustomCode`; **`SiteSettings` DEĞİŞMEZ**. Özel JS
> `CUSTOM_CODE_ENABLED` ortam değişkeniyle tümden kapatılabilir. Bağlayıcı kararlar
> (rota sınırı, `SiteModule` yerine tipli anahtarlar, `--site-*` token scope'u, özel
> kod tehdit modeli) için bkz. §10.12.

> Canlı Analytics (cihaz/ülke kırılımı + canlı ziyaretçi sayısı): `PageView`
> modeline `deviceType` (`DeviceType`: `MOBILE`/`DESKTOP`/`TABLET`/`UNKNOWN`,
> User-Agent'tan `lib/device.ts::detectDeviceType` ile) ve `country` (ISO 3166-1
> alpha-2, bilinmiyorsa `"UNKNOWN"` sentinel — NULL değil, aksi halde Postgres
> unique index'lerinde NULL'ların birbirinden farklı sayılması upsert'te çifte
> satır/race condition riski yaratır; IP'den `geoip-lite` ile — offline, harici
> API çağrısı/anahtar YOK — `lib/geo.ts::detectCountry` ile) eklendi. Bu ikisi ve
> `date` birlikte compound unique kısıtını oluşturur (`(pageId|postId, date,
> deviceType, country)`), böylece "aynı gün + aynı cihaz + aynı ülke" için
> upsert count'u artırır. `GET /admin/stats/breakdown?days=N` bu kırılımı
> `groupBy` ile özetler (ülkelerde ilk 10 + kalanı `"OTHER"` olarak toplanır).
> `GET /admin/stats/live-visitors` süreç-içi (in-memory, `lib/live-visitors.ts`)
> "son 60 saniyede view endpoint'i çağıran IP+User-Agent" sayacını döner — DAĞITIK
> DEĞİL (çoklu instance'ta her process kendi sayacını tutar, Redis gibi paylaşımlı
> bir store bu kapsamda yok), sunucu yeniden başlarsa sıfırlanır; gerçek istek
> sinyaline dayanır, uydurma/simüle veri ÜRETİLMEZ. Sistem sağlığı (`GET
> /admin/health`, yalnızca `SiteRole=ADMIN`): gerçek zamanlı DB ping (`SELECT 1`
> süresi), `pg_database_size` ile DB boyutu, `Media.sizeBytes` toplamı, Node
> `os`/`process` modüllerinden bellek/yük/uptime — hiçbir alan sabit/uydurma
> değildir. `DB_STORAGE_QUOTA_MB`/`MEDIA_STORAGE_QUOTA_MB` ortam değişkenleri
> tanımlıysa quota alanları doldurulur (frontend doluluk yüzdesi hesaplayabilir),
> tanımsızsa `null` döner (frontend yalnızca mutlak boyutu gösterir — asla
> varsayılan/sahte bir kota göstermez).

Ayrıntılı request/response şemaları için `openapi.yaml` esastır.

## 9. Frontend ↔ Backend entegrasyon kuralları (Mimar sorumluluğu)

1. **Kontrat önce yazılır**: `openapi.yaml` ve `shared-types.ts` bu dosyayla
   birlikte güncellenmeden hiçbir taraf endpoint şekli değiştirmez.
2. **Tip üretimi**: backend Zod şemalarından, frontend bunlardan türetilen
   TypeScript tiplerini kullanır (`shared-types.ts` tek doğruluk kaynağıdır);
   iki taraf da elle ikinci bir tip tanımı yazmaz.
3. **Hata sözleşmesi**: frontend her zaman `error.code` üzerinden dallanır
   (i18n mesajı FE'de tutulur), `error.message`'a UI mantığı bağlamaz.
4. **Sunucu asıl kaynak**: fiyat/limit/yetki gibi değerler her zaman backend'de
   yeniden hesaplanır/doğrulanır; frontend yalnızca gösterim/iyimser UI yapar.
5. **Çakışma çözümü**: FE ve BE farklı alan adı/şekli üretirse, bu doküman ve
   `shared-types.ts` bağlayıcıdır; farklılık tespit edilirse önce burada
   düzeltme yapılır, sonra ilgili ajan koduna yansıtılır.

## 10. "Olmazsa Olmaz" Modülleri v1 (Taslak — bağlayıcı sözleşme)

Durum: Taslak v1 · Sahibi: Mimar. Bu bölüm §5-§8'deki mevcut kurallara (site-geneli
`SiteRole` RBAC, `AuditLog`, zarf/hata sözleşmesi, cursor sayfalama) tabidir; burada
yalnızca 5 yeni modülün veri modeli ve uç noktaları tanımlanır. `db-agent`,
`backend-agent`, `security-agent`, `frontend-agent` bu bölümü tek doğruluk kaynağı
olarak kullanır — şekil değişirse önce burada güncellenir.

### 10.1 İçerik Sürüm Kontrolü (Revision History)

**Model** `ContentRevision`:
```
id            uuid PK
seq           int unique autoincrement
entityType    enum ContentEntityType { PAGE, BLOG_POST, PRODUCT, PORTFOLIO_ITEM }
entityId      string            // Page/BlogPost/Product/PortfolioItem.id (FK yok — silinen içerikle
                                  // birlikte revizyonların da silinmesi Cascade ile
                                  // sağlanır: entityId'ye göre elle temizlik gerekmez,
                                  // bkz. not aşağıda)
snapshot      Json              // güncellemeden HEMEN ÖNCEKİ tam alan seti
editedById    string? FK->User  onDelete: SetNull
editedByName  string            // silinen kullanıcı için okunabilir ad snapshot'ı
createdAt     datetime @default(now())

@@index([entityType, entityId, createdAt])
```
- Not: `entityId` polymorphic olduğu için gerçek bir FK/Cascade kurulamaz; Page/BlogPost
  silindiğinde ilişkili `ContentRevision` kayıtlarını service katmanında (aynı
  transaction içinde) elle silin.
- `snapshot` şekli: Page için `{ title, slug, blocks, seoTitle, seoDescription, ogTitle,
  ogImageUrl, canonicalUrl, noIndex, translations }`; BlogPost için `{ title, slug,
  excerpt, contentHtml, coverImageUrl, categoryId, seoTitle, seoDescription, ogTitle,
  ogImageUrl, canonicalUrl, noIndex, translations }`.
- **Yazma kuralı**: `PATCH /admin/pages/{id}` ve `PATCH /admin/blog/{id}` her
  güncellemeden önce mevcut (eski) satırın `snapshot`'ını `ContentRevision`'a yazar
  (aynı transaction). Entity başına en fazla **50** revizyon tutulur — 51. yazımda en
  eski kayıt silinir (`findMany` + `orderBy createdAt asc` + `take` fazlasını sil).
- **Uç noktalar** (yetki: ilgili entity'nin yazma eşiğiyle aynı — `ADMIN`+`EDITOR`):
  - `GET /admin/pages/{id}/revisions?limit&cursor` → `data: ContentRevision[]`
    (snapshot alanı hariç liste görünümü: id, editedByName, createdAt, seq — detay için
    ayrı çağrı), `GET /admin/pages/{id}/revisions/{revisionId}` → tam snapshot dahil.
  - `POST /admin/pages/{id}/revisions/{revisionId}/restore` → önce mevcut state'i yeni
    bir revizyon olarak kaydeder (geri dönüş de geri alınabilir olsun diye), sonra
    snapshot'ı uygular, güncel `Page` DTO'sunu döner.
  - Aynı üçlü `blog` için: `GET/POST /admin/blog/{id}/revisions[...]`.

**PRODUCT / PORTFOLIO_ITEM artık revizyon + autosave + toplu işlem KAPSAMINDADIR
(mimar kararı, faz sınırı KALDIRILDI).** `Product` ve `PortfolioItem` `PATCH`'leri
`ContentRevision` yazmayı zaten yapıyordu, ama listeleyen/geri yükleyen uç YOKTU —
kayıtlar sessizce birikiyordu (bkz. §10.9.2'deki eski "bilinen eksik" notu). Artık
dört entity de **tam paritededir**; `openapi.yaml` bağlayıcıdır:

| Entity | `entityType` | Revizyon uçları | Autosave | Toplu işlem |
|---|---|---|---|---|
| `Page` | `PAGE` | `/admin/pages/{pageId}/revisions[...]` | `/admin/pages/{pageId}/autosave` | `/admin/pages/bulk` |
| `BlogPost` | `BLOG_POST` | `/admin/blog/{postId}/revisions[...]` | `/admin/blog/{postId}/autosave` | `/admin/blog/bulk` |
| `Product` | `PRODUCT` | `/admin/products/{productId}/revisions[...]` | `/admin/products/{productId}/autosave` | `/admin/products/bulk` |
| `PortfolioItem` | `PORTFOLIO_ITEM` | `/admin/portfolio/{itemId}/revisions[...]` | `/admin/portfolio/{itemId}/autosave` | `/admin/portfolio/bulk` |

- **Şema/migration gerekmez** — `ContentEntityType` DB enum'ında `PRODUCT` ve
  `PORTFOLIO_ITEM` ZATEN VARDI. Bu tümüyle bir route/servis işidir (db-agent'a iş
  düşmez; düşerse yalnızca `@@index([entityType, entityId, createdAt])`'in yeni okuma
  hacmi altında yeterli olduğunun doğrulanması).
- **`snapshot` şekli:** `Product` → `{ title, slug, excerpt, descriptionHtml,
  priceCents, currency, taxRatePercent, discountPriceCents, sku, stockQuantity,
  categoryId, coverMediaId, seoTitle, seoDescription, ogTitle, ogImageUrl, canonicalUrl,
  noIndex, translations }`; `PortfolioItem` → `{ title, slug, summary, contentHtml,
  clientName, projectUrl, completedAt, order, categoryId, coverMediaId, seoTitle,
  seoDescription, ogTitle, ogImageUrl, canonicalUrl, noIndex, translations }`.
  **Galeri (`images[]`) snapshot'a GİRMEZ** — ayrı uçlardan yönetilir, `PATCH` ile
  değişmez, dolayısıyla geri yükleme galeriye DOKUNMAZ.
- **Geri yüklemede TEK asimetri — `Product`'ta 422 dalı:** snapshot uygulanmadan önce
  `PATCH` ile aynı çapraz-alan doğrulaması (`discountPriceCents < priceCents`,
  `assertDiscountBelowPrice`) çalıştırılır; düşerse hiçbir şey yazılmaz ve 422 döner.
  Ayrıca snapshot'taki `sku`/`slug` bu arada başka bir kayda geçmişse 409. `PortfolioItem`
  ve `Page`/`BlogPost`'ta çapraz-alan kuralı YOKTUR → 422 dalı da YOKTUR (yalnızca `slug`
  tekilliği için 409).
- **Autosave'in DAR gövdesi ticari alanları KAPSAMAZ:** `AutosaveProductRequest` yalnızca
  `{ title, excerpt, descriptionHtml }`; fiyat/indirim/SKU/stok/durum 3 saniyede bir
  doğrulanamayacağı (ve yarım taslakta anlamsız olduğu) için yalnızca bilinçli `PATCH`
  ile yazılır. `AutosavePortfolioItemRequest` → `{ title, summary, contentHtml }`.
  Autosave, `Page`/`BlogPost`'ta olduğu gibi **revizyon ÜRETMEZ ve `AuditLog` YAZMAZ**.
- **Toplu işlem ortak helper'a çıkarılır (karar 1A — backend-agent için bağlayıcı):**
  `pages.routes.ts`/`blog.routes.ts` içindeki bulk mantığı dört kez kopyalanMAYACAK;
  entity-agnostik tek bir helper'a (`lib/bulk-content-actions.ts`) taşınır ve dört route
  bunu Prisma delegate + `entityType` + audit öneki ile parametreleyerek çağırır.
  Gerekçe: atomiklik (tek transaction), `permanent-delete`'in ADMIN-only eşiği,
  `ContentRevision` elle temizliği ve `skippedIds` semantiği güvenlik açısından kritik
  ve **birebir aynı** kurallardır; dört kopya, dördünün zamanla ayrışması demektir.
  Audit önekleri: `page.` · `blog_post.` · `product.` · `portfolio_item.` +
  `bulk_<action>`.
- **Kapsam dışı (bilinçli):** revizyonlar arası görsel diff/karşılaştırma ekranı ve
  revizyona not/etiket ekleme bu fazda YOK.

### 10.2 Gelişmiş SEO & Social Card (Meta Management)

Yeni backend/DB işi minimal — mevcut `Page`/`BlogPost` alanlarına ekleme:
```
ogTitle        String?
ogImageUrl     String?
canonicalUrl   String?
noIndex        Boolean  @default(false)
```
(`seoTitle`/`seoDescription` `Page`'de zaten vardı; `BlogPost`'ta YOKTU — db-agent bunu da
aynı migration'a ekledi, bkz. §6 ER diyagramı.) Bu alanlar mevcut
`UpdatePageRequestSchema` / `UpdateBlogPostRequestSchema`'ya (Zod, tümü `.optional()`,
`canonicalUrl` boşsa `null`, geçerliyse `z.string().url()`) ve DTO'lara eklenir; **yeni
endpoint yok**. Public `GET /pages/{slug}` ve `GET /blog/{slug}` cevaplarına da bu
alanlar eklenir (frontend `<head>` meta/canonical/robots etiketlerini bunlardan üretir;
`noIndex=true` → `<meta name="robots" content="noindex">`).
Google SERP / Twitter / LinkedIn kart önizlemesi **saf frontend bileşeni** — form
state'inden türetilir, backend'e ihtiyaç duymaz.

### 10.3 E-posta & Bildirim Şablonu Yöneticisi

> **GÜNCEL DURUM İÇİN §10.16'YA BAKIN.** Bu bölüm temel modeli ve allow-list render
> ilkesini tanımlar (hâlâ geçerli), ancak §10.16 şunları DEĞİŞTİRİR/GENİŞLETİR:
> - `EmailTemplate` alanları (`purpose`, `editorMode`, `isSystem`, `isActive`,
>   `blocks`, `customVariables`) ve `key`'in nullable olması,
> - **uç adreslemesi `{key}` → `{templateId}` (BREAKING)**, yeni CRUD/activate/
>   duplicate/test-send uçları,
> - `sendTemplateEmail`'in anahtar yerine **amaca (purpose)** göre çözümlemesi.
>
> Aşağıdaki "Gerçek e-posta gönderimi kapsam dışı" cümlesi **ARTIK GEÇERSİZDİR** —
> gönderim `lib/mail.ts` (SMTP) + `email-templates.service.ts` üzerinden çalışmaktadır.

**Model** `EmailTemplate`:
```
id                  uuid PK
key                 string @unique   // "WELCOME" | "PASSWORD_RESET" | "SYSTEM_ANNOUNCEMENT"
name                string           // insan-okur ad, ör. "Hoş Geldin E-postası"
subject             string
bodyHtml            string
availableVariables  Json             // ör. ["user_name","reset_link"] — salt bilgi amaçlı
updatedById         string? FK->User onDelete: SetNull
updatedAt           datetime @updatedAt
createdAt           datetime @default(now())
```
- `prisma/seed.ts` üç varsayılan kaydı (`WELCOME`, `PASSWORD_RESET`,
  `SYSTEM_ANNOUNCEMENT`) `availableVariables` ile birlikte tohumlar.
- Değişken sözdizimi: `{{user_name}}`, `{{reset_link}}` vb. — render'da basit,
  allow-list'e dayalı string replace kullanılır (bir template engine/`eval` KULLANILMAZ
  — enjeksiyon riski).
- **Uç noktalar** (yetki: `ADMIN` — bu iletiler tüm kullanıcılara gidebildiği için
  `EDITOR` eşiği yetersiz):
  - `GET /admin/notifications/templates` → `data: EmailTemplate[]`
  - `GET /admin/notifications/templates/{key}` → `data: EmailTemplate`
  - `PATCH /admin/notifications/templates/{key}` body `{ subject?, bodyHtml? }` →
    audit log (`notifications.template_update`)
  - `POST /admin/notifications/templates/{key}/preview` body
    `{ sampleValues: Record<string,string> }` → `data: { renderedSubject, renderedHtml }`
- Gerçek e-posta gönderimi kapsam dışı (mevcut `TODO(email-provider)` — bkz.
  `auth.service.ts::forgotPassword` — geçerliliğini korur); bu modül yalnızca şablon
  CRUD + önizleme sağlar.

### 10.4 Güvenlik & 2FA (TOTP) + Aktif Oturumlar

**`User` model eklemeleri**:
```
twoFactorEnabled     Boolean   @default(false)
twoFactorSecret      String?   // AES-256-GCM ile şifrelenmiş base32 TOTP secret — DÜZ METİN SAKLANMAZ
twoFactorVerifiedAt  DateTime?
```
Şifreleme: yeni `lib/crypto.ts` (`encryptSecret`/`decryptSecret`, AES-256-GCM), anahtar
`env.ENCRYPTION_KEY` (32 byte, base64 — `.env.example`'a eklenir).

**Yeni model** `BackupCode`:
```
id        uuid PK
userId    string FK->User onDelete: Cascade
codeHash  string   // sha256(code) — argon2 gerekmez, tek kullanımlık kısa kod
usedAt    DateTime?
createdAt DateTime @default(now())

@@index([userId])
```
Etkinleştirmede 10 adet insan-okur kod (ör. `XXXX-XXXX`) üretilir, hash'lenip saklanır,
**düz metin yalnızca bir kez** response'ta döner.

**Login akışı değişikliği** (`auth.service.ts::login`): şifre doğrulandıktan sonra
`user.twoFactorEnabled === true` ise token çifti HEMEN verilmez; bunun yerine 5 dakika
ömürlü, `purpose: "2fa_challenge"` claim'li bir JWT (`challengeToken`) üretilip
`{ requiresTwoFactor: true, challengeToken }` (200) döner. Yeni:
`POST /auth/2fa/verify` body `{ challengeToken, code }` → `code` TOTP veya bir backup
kodu ile eşleşirse (backup kodu kullanılırsa `usedAt` işaretlenir, tek kullanımlık)
normal `login` ile aynı token çiftini üretir ve döner.

**Uç noktalar** (`/admin/settings/security/2fa/*`, hepsi `authenticate` gerektirir —
org/site-rol şartı yok, herkes KENDİ hesabı için yönetir):
- `POST .../setup` → yeni secret üretir (henüz DB'ye YAZILMAZ, JWT'ye gömülü kısa ömürlü
  `setupToken` içinde taşınır), `data: { otpauthUrl, qrCodeDataUrl, setupToken }`.
- `POST .../enable` body `{ setupToken, code }` → doğrularsa `twoFactorSecret`
  (şifreli) + `twoFactorEnabled=true` yazar, 10 backup kodu üretir, `data: { backupCodes: string[] }`
  döner (audit: `security.2fa_enable`).
- `POST .../disable` body `{ password }` → şifre doğrulaması ister, 2FA'yı kapatır,
  `BackupCode` kayıtlarını siler, **mevcut oturum hariç** tüm `RefreshToken`'ları iptal
  eder (audit: `security.2fa_disable`).
- `POST .../backup-codes/regenerate` body `{ password }` → eskileri geçersiz kılar, 10
  yeni kod döner (audit: `security.2fa_backup_codes_regenerate`).

**Aktif oturumlar** (`/admin/settings/security/sessions`, yeni tablo GEREKMEZ —
`RefreshToken.userAgent`/`ipAddress` zaten var):
- `GET .../sessions` → `data: Session[]` (`id, userAgent, ipAddress, createdAt,
  expiresAt, isCurrent`) — yalnızca `revoked=false && expiresAt > now()`.
- `DELETE .../sessions/{id}` → o oturumu iptal eder (audit: `security.session_revoke`).
- `POST .../sessions/revoke-others` → mevcut hariç tümünü iptal eder.
- "Mevcut oturum" tespiti: istek cookie'sindeki ham refresh token hash'i ile eşleşen
  kayıt `isCurrent: true`.

Yeni bağımlılıklar (backend): `otplib` (TOTP), `qrcode` (PNG data URI üretimi).

### 10.5 Çoklu Dil & Yerelleştirme (i18n)

**İçerik çevirisi** — yeni tablo yerine mevcut JSON-alan deseniyle tutarlı, tek ek
alan: `Page` ve `BlogPost`'a `translations Json @default("{}")`. Şekil:
```ts
type Translations = {
  EN?: {
    title?: string; seoTitle?: string; seoDescription?: string; ogTitle?: string;
    canonicalUrl?: string;
    blocks?: unknown[];       // yalnızca Page
    excerpt?: string; contentHtml?: string;  // yalnızca BlogPost
  };
};
```
TR = kanonik/varsayılan (mevcut kolonlar), `translations.EN` yalnızca override'ları
taşır (kısmi olabilir — eksik alan TR'ye düşer). `PATCH` endpoint'leri body'de
`translations?: Translations` alanını **shallow merge** ile kabul eder (tam replace
DEĞİL — `EN` objesi kendi içinde tam replace, ama TR kolonlarını etkilemez).
Public okuma: `GET /pages/{slug}?locale=EN` / `GET /blog/{slug}?locale=EN` — alan
bazlı fallback (EN'de olmayan alan TR'den gelir); `locale` verilmezse/`TR` ise
kolonlar direkt döner.

**Admin panel arayüz dili** (chrome/UI metinleri, içerikten bağımsız) — backend işi
YOK, saf frontend: `localStorage` (`adminLocale`, `"tr"|"en"`) + basit
`I18nProvider`/`useT()` context'i (iki küçük sözlük dosyası). Yeni bağımlılık (ör.
`next-intl`) eklenmez — kapsam admin chrome'u ile sınırlı, routing gerektirmez.
`AdminTopbar`'a dil seçici (bayrak/kısaltma) eklenir.

### 10.6 Hesap Ayarları ("Hesabım") + Global Bildirim (Toast) Standardı

**Şema değişikliği GEREKMEZ.** `User.name` ve `User.avatarUrl` zaten mevcut;
`AuditLog.action` serbest `String` (enum değil), yeni action ismi için migration
gerekmez. db-agent bu iş için devreye GİRMEZ.

**Uç noktalar** (`/users/*`, `authenticate` yeterli — herkes yalnızca KENDİ hesabını
yönetir, site-rol şartı YOK):
- `PATCH /users/me` (MEVCUT) → `{ name?, avatarUrl? }`. **Sözleşme düzeltmesi:**
  `avatarUrl` artık `string | null`; `null` avatarı kaldırır. Boş string `""`
  GEÇERSİZDİR (422) — istemci `""` yerine `null` göndermelidir.
- `POST /users/me/change-password` (YENİ) → body `{ currentPassword, newPassword }`,
  başarıda **204** (gövde yok).
  - `currentPassword` argon2 (`lib/password.ts::verifyPassword`) ile doğrulanır;
    hatalıysa `401 UNAUTHORIZED` ("Şifre hatalı.") + audit `status: FAILURE`.
  - `newPassword`: min 8 karakter (`RegisterRequest.password` ile aynı kural);
    `newPassword === currentPassword` ise `422` (`details.newPassword`).
  - Başarıda `passwordHash` güncellenir ve **mevcut oturum HARİÇ** tüm
    `RefreshToken` kayıtları `revoked=true` yapılır — `2fa/disable` ile birebir aynı
    politika (cookie'deki ham token'ın `hashToken()` karşılığı hariç tutulur).
    Gerekçe: şifre değişiminde diğer cihazlardaki oturumlar zorla kapanmalıdır;
    isteği yapan cihazın oturumu bilinçli olarak korunur (kullanıcı kendini atmaz).
  - Audit action: `security.password_change` (`targetType: "User"`, `targetId: <kendi
    id>`; `metadata` ASLA şifre/hash içermez).
  - Rate limit: route-level `config.rateLimit = { max: 5, timeWindow: "1 minute" }` —
    `security.routes.ts::SENSITIVE_ACTION_RATE_LIMIT` ile aynı desen. Aşılırsa
    `429 RATE_LIMITED`.

**Frontend yerleşimi**: `/admin/account` ROUTE'u (modal DEĞİL). Gerekçe: üç ayrı
bölüm (profil / avatar / şifre) + `MediaPicker` gibi kendi başına modal açan bir alt
bileşen içerir; modal-içinde-modal deseninden kaçınılır ve `/admin/settings/security`
ile aynı "kişisel hesap" bilgi mimarisi korunur. Şifre değiştirme formu bu sayfa
İÇİNDE bir `Card`'dır (2FA disable'daki gibi ayrı bir `Dialog` değil) — sayfanın
kendisi zaten kimliği doğrulanmış özel bir alandır.

**Toast standardı** (`sonner`, `providers.tsx`'te mount edilmiş — yeni altyapı YOK):
kullanıcı tarafından TETİKLENEN her mutasyon (create/update/delete/restore/bulk)
sonucunda tam olarak bir toast gösterilir.
- Başarı: `toast.success("<Varlık> <fiil geçmiş zaman>.")` — ör. "Yazı oluşturuldu."
- Hata: `toast.error(friendlyErrorMessage(err))`.
- Toast, mevcut inline `Alert`/`saveError` gösterimini KALDIRMAZ; kalıcı bağlam için
  inline hata korunur, toast anlık geri bildirimdir (mevcut `settings/page.tsx`
  deseni referanstır).
- İSTİSNA: kullanıcı tetiklemeyen arka plan yüklemeleri (`load()`, liste/polling
  hataları) toast ÜRETMEZ — bunlar inline `Alert` ile gösterilir.

### 10.7 İçerik Yönetim Listesi (WordPress-tarzı Sayfalar & Blog tablosu)

Sayfalar (`Page`) ve Blog Yazıları (`BlogPost`) admin liste ekranları ORTAK bir tablo
bileşeni kullanır. İki varlık için sözleşme **birebir simetriktir** — endpoint isimleri,
gövde şekilleri, hata kodları ve DTO alanları aynıdır; farklı olan tek şey yol öneki
(`/admin/pages` vs `/admin/blog`) ve SEO skorunun entity'ye özgü girdileridir.
Bağlayıcı kaynak: `openapi.yaml` (tag `Pages` / `Blog`).

**Şema (db-agent):**
- `Page`: `deletedAt DateTime?`, `authorId String?` + `author User? @relation(..., onDelete: SetNull)`;
  `User` tarafına karşı-ilişki `pages Page[]`. İndeksler: `@@index([deletedAt, status])`,
  `@@index([authorId])`.
- `BlogPost`: `deletedAt DateTime?` (author ilişkisi ZATEN VAR). Aynı iki indeks.
- `slug` tekilliği çöptekileri DE kapsar (unique constraint dokunulmaz). Çöpe taşırken
  slug yeniden adlandırılmaz; çakışan yeni kayıt `409 CONFLICT` alır ve mesaj kullanıcıyı
  çöpe yönlendirir. Otomatik çöp temizleme (retention cron) v1 KAPSAM DIŞI.

**Soft-delete (çöp kutusu):**
- `DELETE /admin/{pages|blog}/{id}` artık `deletedAt = now()` yapar (KALICI SİLMEZ) ve
  yetki eşiği ADMIN-only'den **ADMIN/EDITOR**'e genişler.
- `DELETE .../{id}/permanent` (ADMIN-only) kalıcı siler; kayıt ÖNCE çöpte olmalıdır,
  değilse 409. `ContentRevision` satırları polymorphic olduğu için FK cascade YOKTUR →
  aynı transaction içinde elle silinir.
- Çöpe taşınan sayfa `SiteSettings.homePageId` ise aynı transaction'da `homePageId = null`
  yapılır; geri yükleme bunu geri almaz.
- **Tüm public okuma yolları `deletedAt: null` filtresi eklemek ZORUNDADIR**
  (`publicPagesRoutes`, `publicBlogRoutes`, view sayacı upsert'leri,
  `settings.routes.ts` homePage sorgusu, sitemap/feed üreten her yer).
- Çöpteki içerik DÜZENLENEMEZ: `PATCH .../{id}` → 409.

**Sekme sayaçları — sunucu tarafı (karar):** `GET /admin/{pages|blog}` yanıtı
`meta.counts { all, published, draft, trashed }` döner; tek `groupBy` ile tablo genelinde
hesaplanır ve istek filtrelerinden etkilenmez. Gerekçe: `limit` tavanı 100'dür, client
tarafında sayım 100+ kayıtta yanlış sonuç verirdi. Satır filtreleme/arama/sayfalama ise
MEVCUT desende (`useFilteredList`, client-side) kalır — frontend `?trashed=include&limit=100`
çeker, gerekiyorsa `meta.nextCursor` boşalana dek döngüyle devam eder.

**Hızlı Düzenle (Quick Edit):** AYRI UÇ YOKTUR. Inline mini form mevcut
`PATCH .../{id}` ucunu `{ title?, slug?, status? }` kısmi gövdesiyle çağırır — slug
tekilliği, revizyon snapshot'ı (§10.1) ve `publishedAt` mantığı tek yerde kalsın diye.
Taslağa alma `publishedAt`'i temizlemez (ilk yayın tarihi kalıcıdır).

**Toplu işlem:** `POST /admin/{pages|blog|products|portfolio}/bulk` →
`{ ids[1..100], action }`, action ∈ `trash | restore | publish | draft |
permanent-delete`. Kısmi başarı hata değildir (200 + `skippedIds`). "Çöpü Boşalt" ayrı
uç değildir; frontend çöpteki id'leri `permanent-delete` ile gönderir. Dördü de TEK bir
ortak helper üzerinden çalışır (karar 1A, §10.1) — tek transaction, aynı atlama
kuralları, aynı ADMIN-only `permanent-delete` eşiği; farklı olan yalnızca Prisma
delegate'i, `ContentRevision.entityType` ve audit önekidir.

**PRODUCT / PORTFOLIO_ITEM bu bölümün TAMAMINI devralır (mimar kararı).** `Product`
(§10.9.2) ve `PortfolioItem` (§10.9.4) yalnızca çöp kutusu/yazar/SEO skoru/sekme
sayaçları paternini değil, artık **revizyon geçmişi, autosave ve toplu işlemi de**
`Page`/`BlogPost` ile birebir aynı sözleşmeyle uygular — tam uç listesi ve tek
asimetri (`Product` geri yüklemesindeki 422 çapraz-alan dalı) §10.1'deki parite
tablosundadır. Bu bölümdeki kurallardan bir sapma varsa, §10.1 ve `openapi.yaml`
bağlayıcıdır.

**Yazar:** `authorId` create/update gövdelerine eklenir. Verilmezse giriş yapmış
kullanıcı; BAŞKA kullanıcı atamak/değiştirmek yalnızca **ADMIN** (EDITOR → 403).
Dropdown mevcut `GET /admin/users` ile beslenir, YENİ UÇ YOKTUR (zaten ADMIN-only, bu da
"yalnızca ADMIN atayabilir" kuralıyla örtüşür). Eski kayıtlar için backfill yapılmaz →
`author: null`, UI "—" gösterir.

**SEO tamlık skoru:** BACKEND hesaplar (frontend yalnızca render eder), her okumada
saf/senkron olarak üretilir, persist EDİLMEZ. `seoScore: 0..100` + `seoScoreIssues:
{ code, label }[]`. `code` kararlı makine-okunur anahtardır (frontend mantığı ve testler
buna bağlanır), `label` gösterime yönelik Türkçe metindir. 5 kriter × 20 puan ve tam
eşikler `openapi.yaml#/components/schemas/SeoScoreIssue` açıklamasındadır (bağlayıcı).
Rozet renkleri: <50 kırmızı, 50–79 sarı, ≥80 yeşil (ui-designer token'ları).

**Tarih sütunu:** yeni alan gerekmez — `status=PUBLISHED && publishedAt != null` ise
"Yayınlandı — {publishedAt}", çöpteyse "Çöpe taşındı — {deletedAt}", aksi halde
"Son Düzenleme — {updatedAt}".

**Audit:** `page.trash|restore|permanent_delete|bulk_<action>` ve `blog_post.*`
karşılıkları yazılır; `Product`/`PortfolioItem` toplu işlemleri için `product.*` ve
`portfolio_item.*` önekleri kullanılır (`AuditLog.action` serbest string, migration
gerekmez).

#### 10.7.1 Sayfalama kontrollerinin görünürlük eşiği — `totalPages > 1` (DÜZELTME, bağlayıcı)

**Durum:** Bu bölüm, üretimde doğrulanmış KRİTİK bir kullanılabilirlik hatasını kapatır.
Kontrat seviyesine yazılmasının sebebi, hatanın kaynağının bir kodlama kazası değil,
**yanlış belgelenmiş bir kural** olmasıdır: `list-pagination.tsx` ve `use-filtered-list.ts`
doc yorumları "yalnızca `totalPages > 10` olduğunda render edilmelidir" diyordu ve beş
liste ekranı bu yanlış kuralı sadakatle uyguluyordu. Yorum düzeltilmeden kod düzeltilirse
hata bir sonraki dokunuşta geri gelir.

**Doğru kural (tek cümle):** *Sayfa boyutu seçici ve sayfalama kontrolleri
`totalPages > 1` olduğunda gösterilir; `totalPages <= 1` iken gizlenir.*

**Neden `> 10` bir hataydı — iki belirti, tek kök neden:**
`useFilteredList.totalPages`, listenin **kaç sayfaya bölündüğüdür** (`ceil(n / pageSize)`),
öğe sayısı DEĞİLDİR. Eşik büyük olasılıkla "10'dan fazla ÖĞE varsa göster" niyetiyle
yazıldı, ama `totalPages` üzerine kuruldu. Sonuç, `pageSize` büyüdükçe kontrollerin
kaybolduğu bir kısırdöngüdür:

| Öğe | pageSize | totalPages | `> 10` | Gerçekte olması gereken |
|---|---|---|---|---|
| 229 | 10 | 23 | görünür | görünür |
| 229 | 20 | 12 | görünür | görünür |
| 229 | 50 | 5 | **gizli** | **görünür (5 sayfa!)** |

Kullanıcı 50/sayfa'yı seçtiği anda `totalPages` 5'e düşer, koşul yanlışa döner ve **hem
sayfalama hem de sayfa boyutu seçicisi aynı anda DOM'dan kalkar**. Kullanıcı ne 2. sayfaya
geçebilir ne de 10/sayfa'ya geri dönebilir — durum yalnızca sayfa yenilenerek (state
sıfırlanarak) kırılır. Kullanıcının bildirdiği "50/sayfa seçilince diğer sayfalara
geçilemiyor" ve "sayfa boyutu dropdown'ı kayboluyor" şikâyetleri bu tek koşulun iki yüzüdür.

**Kapsam kararı — beş liste ekranının HEPSİ düzeltilir (yalnızca blog/pages değil).**
Kullanıcı yalnızca Blog ve Sayfa listelerinden şikâyet etti, ancak `grep -rn "totalPages > 10"`
aynı kusurlu koşulun `blog`, `pages`, `products`, `portfolio`, `users` ekranlarında birebir
kopyalandığını gösteriyor. Sadece ikisini düzeltmek (a) beş ekranı birbirinden ayrıştırır,
(b) kalan üçünü "henüz rapor edilmemiş aynı hata" olarak bırakır, (c) düzeltilen ikisinin
yanında yanlış örnek bırakır. Aynı kod, aynı hata, aynı düzeltme → tek turda kapatılır.

`/admin/media` sayfası **bilinçli olarak kapsam dışıdır**: kendi doc yorumunda bu eşiği
KOPYALAMADIĞINI zaten açıklıyor (`media/page.tsx` ~satır 844), yani orada hata yok.

**İkincil hata — `w-24` sabit genişliği (kullanıcının 2. maddesi).** Sayfa boyutu
`<Select>`'i `className="w-24"` ile sabitlenmiş; "10 / sayfa" metni + dropdown ok ikonu bu
genişliğe sığmıyor ve metin kırpılıyor. `w-24` → `w-auto` (gerekiyorsa `min-w-[7.5rem]`).
Sabit genişlik yeniden getirilmemelidir: seçenek metinleri yerelleştirmeyle (§10.5)
uzayabilir.

**Değiştirilecek dosyalar (frontend-agent):** `frontend/src/app/admin/{blog,pages,products,
portfolio,users}/page.tsx` (her birinde 2 koşul + 1 `className`), ayrıca
`frontend/src/components/admin/list-pagination.tsx` ve `frontend/src/hooks/use-filtered-list.ts`
doc yorumları. **Yorum düzeltmesi opsiyonel değildir** — hatanın asıl kaynağı odur.

> **Dikkat — `w-24`'ü toplu değiştir/yenile (replace-all) YAPMAYIN.**
> `users/page.tsx` içinde sayfa boyutu `<Select>`'i DIŞINDA iki `w-24` daha var
> (`<TableHead className="w-24 text-right">İşlemler</TableHead>` ve karşılık gelen
> `<TableCell>`). Bunlar İşlemler sütununun genişliğidir, doğrudur ve
> DEĞİŞTİRİLMEMELİDİR. Yalnızca sayfa boyutu `<Select>`'inin `className`'i düzeltilir
> (5 dosyada 5 tane).

**qa-agent regresyon testi (bağlayıcı):** "229 öğe → 50/sayfa seç → 2. sayfaya geç →
10/sayfa'ya dön" akışı e2e olarak korunmalıdır; ayrıca `totalPages === 1` iken kontrollerin
GÖRÜNMEDİĞİ de doğrulanmalıdır (eşiğin `> 0`'a kaydırılmadığından emin olmak için).

#### 10.7.2 Hızlı Düzenle'nin entity'ye özgü alanlarla genişletilmesi (generic, bağlayıcı)

Hızlı Düzenle'ye Blog'a özgü **Kategori + Etiket** alanları eklenir (kullanıcının 4.
maddesi). `Page`/`Product`/`PortfolioItem`'da kategori-etiket semantiği aynı olmadığı için
ortak tip **kirletilmez**.

**Reddedilen yaklaşım:** `QuickEditValues`'a `categoryId?: string | null; tagIds?: string[]`
gibi opsiyonel alanlar eklemek. Bu, `Page` tarafında hiçbir zaman dolmayacak alanları
tipte görünür kılar, `PATCH /admin/pages/{id}`'e asla gitmeyecek alanların yanlışlıkla
gönderilmesini tip sistemiyle engelleyemez ve "opsiyonel ama aslında zorunlu" belirsizliği
yaratır.

**Karar — ortak tip DEĞİŞMEZ, genişletme generic parametreyle yapılır:**

```ts
// content-list/types.ts — DEĞİŞMEDEN kalır
export interface QuickEditValues { title: string; slug: string; status: ContentStatus; }

// content-list/types.ts — YENİ, yalnızca blog listesi kullanır
export interface BlogQuickEditValues extends QuickEditValues {
  categoryId: string | null;   // "" DEĞİL null — PATCH gövdesiyle birebir
  tagIds: string[];            // TAM set (delta değil), bkz. §10.14.4
}
```

`useContentList` ve `ContentListTable` ikinci bir generic parametre alır:
`<T extends ContentListEntity, Q extends QuickEditValues = QuickEditValues>`. Varsayılan
`QuickEditValues` olduğu için **`pages`/`products`/`portfolio` çağrı yerleri hiç
değişmez**. Blog `useContentList<BlogPost, BlogQuickEditValues>` der.

İki yeni opsiyonel option/prop:
- `useContentList` → `quickEditExtras?: (item: T) => Omit<Q, keyof QuickEditValues>` —
  `startQuickEdit` çağrıldığında satırdan başlangıç değerlerini üretir. Verilmezse
  `startQuickEdit` bugünkü `{ title, slug, status }` davranışını korur.
- `ContentListTable` → `quickEditExtraFields?: (ctx: { values: Q; onChange: (v: Partial<Q>) => void; disabled: boolean }) => ReactNode` —
  masaüstü satır formunda VE mobil kart formunda (iki ayrı render yolu var, İKİSİNE de
  eklenmelidir) durum alanından sonra render edilir.

`updateItem` imzası `(id, input: Partial<Q>) => Promise<T>` olur; blog için bu
`PATCH /admin/blog/{postId}` gövdesine birebir oturur (§10.14.4).

**Sütun slotu genelleştirilir:** `ContentListTable`'ın `categoryColumn?: { header, render }`
prop'u `extraColumns?: { key: string; header: string; className?: string; render: (item: T) => ReactNode }[]`
ile değiştirilir. Gerekçe: Etiketler sütunu ikinci bir ad-hoc prop (`tagsColumn`) gerektirirdi
ve üçüncüsü kaçınılmazdı. `colSpan` hesabı `columnCountBase + extraColumns.length` olur.
`products`/`portfolio` çağrı yerleri tek satırlık mekanik bir değişiklikle dizi formuna
geçer; `pages` zaten bu prop'u kullanmıyor.

### 10.8 Toplu İçe Aktarma (Import) + Dışa Aktarma

Durum: v1 · Sahibi: Mimar. Bağlayıcı kaynak: `openapi.yaml` (tag `Import`). Bu bölüm
`db-agent`, `backend-agent`, `frontend-agent`, `security-agent`, `qa-agent` için tek
doğruluk kaynağıdır.

#### 10.8.1 Arka plan işleme kararı — kuyruk YOK, süreç-içi worker + DB durum tablosu

Projede BullMQ/Redis/kuyruk altyapısı **yoktur** ve v1'de **kurulmayacaktır**. Karar:
`ImportJob` satırı doğruluk kaynağı, işleme aynı Node sürecinde asenkron yürür.

- `POST .../start` `QUEUED` yazar, `202` döner ve worker'ı `setImmediate` ile tetikler —
  istek/yanıt döngüsünü BEKLETMEZ.
- **Eşzamanlılık 1**: modül-düzeyi FIFO; ikinci iş `QUEUED`'da bekler. Gerekçe: bellek ve
  DB yükünü sınırlamak; içe aktarma nadir, uzun ve I/O-yoğun bir işlemdir.
- **Parti (batch) boyutu 25**: her 25 kayıtta bir sayaçlar (`processedCount`,
  `successCount`, `errorCount`, `skippedCount`) DB'ye yazılır → poll eden UI ilerlemeyi
  görür. Aynı noktada `cancelRequestedAt` kontrol edilir (işbirlikçi iptal).
- **Çökme/restart kurtarma (ZORUNLU)**: `app.addHook("onReady")` içinde
  `status IN (QUEUED, PROCESSING)` olan tüm işler `FAILED` + `errorSummary: "Sunucu
  yeniden başlatıldığı için içe aktarma yarıda kaldı."` yapılır. Bu OLMADAN iş sonsuza
  dek `PROCESSING`'de asılı kalır ve UI sonsuz poll eder.
- **Bilinen sınır (kabul edildi)**: süreç-içi worker **tek instance** varsayar. Yatay
  ölçeklemede (birden fazla API replikası) `onReady` kurtarması komşu instance'ın canlı
  işini yanlışlıkla `FAILED` yapar. Ölçeklendiğimiz gün BullMQ'ya geçilir; **API kontratı
  ve `ImportJob` tablosu AYNEN KALIR**, yalnızca tetikleyici (`setImmediate` → `queue.add`)
  değişir. Bu, kararı geri alınabilir kılar — kuyruğu şimdi kurmamanın gerekçesi budur.
- Realtime bildirim (SSE/WebSocket) YOK: frontend `GET /admin/import/jobs/{jobId}` ucunu
  **2 sn**'de bir poll eder, iş sonlanınca §10.6 toast standardıyla bildirim gösterir.

#### 10.8.2 Şema (db-agent — TEK SAHİP)

```prisma
enum ImportJobType         { PAGES  BLOG  WORDPRESS  PRODUCTS  USERS  MEDIA }
enum ImportSourceFormat    { CSV  JSON  XML  ZIP }
enum ImportJobStatus       { PENDING  QUEUED  PROCESSING  COMPLETED  FAILED  CANCELLED }
enum ImportDuplicateStrategy { SKIP  OVERWRITE  CREATE_NEW }
enum ImportErrorSeverity   { ERROR  SKIPPED }

model ImportJob {
  id                String     @id @default(uuid())
  seq               Int        @unique @default(autoincrement())   // cursor sayfalama
  type              ImportJobType
  format            ImportSourceFormat
  status            ImportJobStatus @default(PENDING)
  duplicateStrategy ImportDuplicateStrategy?                        // PENDING iken null
  // Kullanıcının yüklediği ORİJİNAL ad — yalnızca gösterim.
  filename          String
  // Gizli depodaki dosya referansı (rastgele UUID adı / S3 key). API'de ASLA DÖNMEZ.
  storagePath       String?
  sizeBytes         Int
  // Onay ekranını besleyen önizleme (openapi #/components/schemas/ImportJobPreview).
  preview           Json?
  // Başlatırken seçilen alan eşleştirmesi + defaultStatus/defaultAuthorId/defaultCategoryId.
  options           Json       @default("{}")
  totalCount        Int        @default(0)
  processedCount    Int        @default(0)
  successCount      Int        @default(0)
  errorCount        Int        @default(0)
  skippedCount      Int        @default(0)
  // Yalnızca işin TAMAMINI başarısız kılan hata; satır hataları ImportJobError'dadır.
  errorSummary      String?
  createdById       String?
  cancelRequestedAt DateTime?
  startedAt         DateTime?
  finishedAt        DateTime?
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt

  createdBy User?             @relation("ImportJobCreator", fields: [createdById], references: [id], onDelete: SetNull)
  errors    ImportJobError[]

  @@index([status])
  @@index([type])
  @@index([createdById])
  @@map("import_jobs")
}

model ImportJobError {
  id          String   @id @default(uuid())
  seq         Int      @unique @default(autoincrement())
  jobId       String
  // Kaynak dosyadaki 1-tabanlı sıra (CSV'de başlık satırı HARİÇ).
  rowNumber   Int
  // openapi #/components/schemas/ImportJobErrorCode ile BİREBİR — serbest string DEĞİL.
  code        String
  message     String
  severity    ImportErrorSeverity @default(ERROR)
  field       String?
  // WXR'da wp:post_id, ZIP'te arşiv içi dosya adı, CSV/JSON'da slug/email.
  sourceRef   String?
  // Satırın ham hâli, 8 KB'a KIRPILIR. KİŞİSEL VERİ İÇEREBİLİR (bkz. 10.8.8).
  rawData     Json?
  createdAt   DateTime @default(now())

  job ImportJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@index([jobId, seq])
  @@map("import_job_errors")
}
```
`User` tarafına karşı-ilişki alanı: `importJobs ImportJob[] @relation("ImportJobCreator")`.

- **Hata satırı tavanı 1.000/iş** — aşıldığında YAZMA DURUR (`errorCount` saymaya devam
  eder), `GET .../errors` `meta.truncated: true` döner. Bozuk bir 5.000 satırlık CSV'nin
  DB'yi doldurması böylece engellenir.
- **`code` neden String, enum değil?** Kod listesi (`ImportJobErrorCode`) uygulama
  geliştikçe sık büyür; her yeni kod için migration gerekmesin diye `AuditLog.action` ile
  aynı desen kullanılır. Bağlayıcı liste `openapi.yaml`'dadır ve Zod ile doğrulanır.
- **`PRODUCTS` için db-agent'a düşen TEK iş (§10.8.9):** `ImportJobType` enum'ına
  `PRODUCTS` değerini ekleyen migration (`ALTER TYPE ... ADD VALUE`). Bunun dışında yeni
  tablo/kolon/indeks GEREKMEZ — `options` (Json) `defaultCurrency`'yi taşır, ürünler
  mevcut `Product`/`ProductCategory` tablolarına yazılır. Enum değeri eklemek geri
  alınamaz bir işlemdir; migration ayrı ve tek başına gönderilmelidir.
- **Önizleme uyarı kodları (`ImportJobPreview.warnings[].code`) migration GEREKTİRMEZ** —
  `preview` bir `Json` kolondur; §10.8.9'un getirdiği 6 yeni kod (`WP_PRODUCTS_SKIPPED`,
  `WC_TAX_NOT_IMPORTED`, `WC_STOCK_NOT_MANAGED`, `WC_VARIATIONS_UNSUPPORTED`,
  `WC_GALLERY_NOT_IMPORTED`, `WC_ORDERS_IGNORED`) yalnızca `openapi.yaml` + Zod
  seviyesinde tanımlıdır.

#### 10.8.3 Kütüphane seçimleri (bağlayıcı — backend-agent kendi başına değiştiremez)

| İş | Seçim | Gerekçe / reddedilenler |
|---|---|---|
| XML/WXR | **`saxes@^6`** | Streaming SAX → bellek dosya boyutundan BAĞIMSIZ (aynı anda tek `<item>` RAM'de). Saf ayrıştırıcı, hiç I/O yapmaz → dış varlık (XXE) çözümlemesi yapısal olarak İMKÂNSIZ. CJS + gömülü tipler, tek bağımlılık (`xmlchars`). **Ret:** `fast-xml-parser` (DOM tabanlı, tüm dosya bellekte; iç DTD varlıklarını genişletir → billion-laughs yüzeyi), `xml2js` (DOM kurar, bakımsız), `libxmljs`/`node-expat` (native binding, GERÇEK XXE yüzeyi). |
| ZIP | **`yauzl@^3`** | Merkezi dizini okur, girişleri tembel/streaming açar, kendiliğinden diske YAZMAZ → zip-slip ancak biz arşivdeki adı yola koyarsak mümkün olur (koymuyoruz, kendi UUID adımızı üretiyoruz). **Ret:** `adm-zip` (arşivi tümüyle belleğe alır, geçmiş zip-slip CVE'leri), `unzipper` (daha ağır, daha çok bağımlılık). |
| CSV | **`csv-parse@^7`** | BOM (`bom: true`), tırnaklı alan, gömülü `,`/`\n`/`\r\n`, `relax_column_count`, hem sync (önizleme) hem stream (çalıştırma) API'si, bağımlılıksız. **Ret:** elle `split(",")` — kendi dışa aktarıcımız (`export-csv.ts`) tırnaklı alan üretiyor, elle bölme kendi çıktımızı bile okuyamazdı. |
| JSON | Kütüphane YOK | Boyut-kapalı buffer üzerinde `JSON.parse` + Zod. |
| HTML temizleme | **`sanitize-html@^2`** | Aşağıya bakınız — v1'in en kritik güvenlik gereksinimi. |

#### 10.8.4 HTML sanitizasyonu (ZORUNLU — yeni bir güvenlik gereksinimi)

Bugün projede **hiçbir HTML sanitizasyonu yoktur** (`grep`: 0 sonuç) ve
`BlogPost.contentHtml` ile `Block{type:"text"}.data.html` public sitede
`dangerouslySetInnerHTML` ile render edilir
(`frontend/src/app/(site)/blog/[slug]/page.tsx`, `components/site/blocks/text-block.tsx`).
Bu bugüne kadar kabul edilebilirdi çünkü tek yazar GÜVENİLEN ADMIN/EDITOR'dü.

**İçe aktarma bu güven modelini bozar**: WXR/CSV/JSON içeriği yabancı (belki ele
geçirilmiş) bir siteden gelir. Bu yüzden:

- İçe aktarılan HER HTML alanı (`content:encoded`, `excerpt:encoded`, CSV/JSON'daki
  `contentHtml`) DB'ye yazılmadan ÖNCE **sunucu tarafında** `sanitize-html` ile
  temizlenir. Yalnızca sunucu tarafı geçerlidir — istemci temizliği güvenlik değildir.
- İzin listesi (allow-list) yaklaşımı: `<script>`, `<style>`, `<iframe>`, `<object>`,
  `<embed>`, `<form>`, tüm `on*` öznitelikleri ve `javascript:`/`data:` URL şemaları
  REDDEDİLİR.
- WordPress kısa kodları (`[gallery ...]`, `[caption ...]`) düz metin olarak KALIR (v1'de
  yorumlanmaz); zararsızdır, ayrı uyarı gerekmez.
- **security-agent'a ayrı görev (bu işten BAĞIMSIZ bulgu):**
  `media.routes.ts::ALLOWED_MIME_TYPES` bugün `image/svg+xml`'e izin veriyor ve
  `/uploads/*` aynı origin'den servis ediliyor → mevcut doğrudan yükleme yolunda
  depolanmış XSS riski. İçe aktarma tarafında SVG kesin olarak REDDEDİLİR
  (`MEDIA_SVG_REJECTED`).

#### 10.8.5 Yükleme, boyut limitleri ve dosyanın nerede durduğu

- **Global multipart limiti route-level override edilir.** `plugins/uploads.ts`
  `@fastify/multipart`'ı `{ fileSize: 5MB, files: 1 }` ile GLOBAL kaydediyor.
  `@fastify/multipart` v10, `request.file(opts)` / `request.parts(opts)` ile verilen
  seçenekleri plugin seçeneklerinin ÜZERİNE deep-merge eder
  (`node_modules/@fastify/multipart/index.js::handleMultipart`) → route içinde
  `request.file({ limits: { fileSize: N, files: 1, fields: 5 } })` yeterlidir; plugin'i
  değiştirmeye GEREK YOKTUR (ve değiştirilMEmelidir — medya yükleme 5 MB'da kalmalı).
- **`app.ts`'teki global `bodyLimit` de aşılmalıdır**: `bodyLimit: MAX_UPLOAD_BYTES + 64KB`
  Fastify core seviyesinde uygulanır ve büyük istekleri multipart'a ULAŞMADAN 413 ile
  keser (bkz. `app.ts` içindeki mevcut yorum). Bu yüzden içe aktarma route'ları
  **route-level `bodyLimit`** de tanımlar. İkisi birlikte yapılmadan 5 MB'ın üstü çalışmaz.
- Tip başına dosya limiti: `PAGES`/`BLOG`/`USERS` **10 MB** · `WORDPRESS` **50 MB** ·
  `PRODUCTS` **50 MB** · `MEDIA` **100 MB**. Kayıt tavanı: `USERS` 500 ·
  `PAGES`/`BLOG` 5.000 · `WORDPRESS` 10.000 item · `PRODUCTS` **5.000 kayıt** ·
  `MEDIA` 500 dosya.
- `PRODUCTS` boyut limiti `WORDPRESS` ile aynıdır (aynı WXR dosyası yüklenir), ama kayıt
  tavanı daha DÜŞÜKTÜR (5.000): ürün satırı başına düşen doğrulama (fiyat ayrıştırma,
  SKU tekilliği, kategori upsert) yazı/sayfa satırından pahalıdır. Tavan **işlenecek
  `product` item'ı** üzerinden sayılır — aynı dosyadaki `post`/`page`/`attachment`
  item'ları bu sayıya GİRMEZ (bkz. §10.8.9).

**413/422 kararı (mimar hakemliği — proje geneli kural):** Boyut aşımı **HER ZAMAN 413
`PAYLOAD_TOO_LARGE`**'dır, 422 değil. RFC 9110 §15.5.14 gereği 413 tam olarak bu durum
içindir; 422 ise iyi biçimlendirilmiş ama anlamsal olarak geçersiz bir GÖVDE içindir —
çok büyük bir dosya bir alan doğrulama hatası değil, taşıma seviyesinde bir limit
ihlalidir.

Bu, `plugins/error-handler.ts`'te **var olan bir tutarsızlığı da düzeltir**: aynı dosyada
`FST_ERR_CTP_BODY_TOO_LARGE` → 413 iken hemen üstündeki `FST_REQ_FILE_TOO_LARGE` → 422
map ediliyor. İkisi de aynı sınıf hatadır ve aynı statüyü dönmelidir.

Route-local kontrol tek başına YETERSİZDİR ve bu bir varsayım değil, doğrulanmış bir
davranıştır: `@fastify/multipart`'ta `throwFileSizeLimit` varsayılanı `true`'dur
(`index.js:172-174`), bu yüzden 100 MB'lık sert tavan aşıldığında `file.on("limit")` →
`onError(RequestFileTooLargeError)` tetiklenir ve hata `cleanup()` → `ch(lastError)`
yoluyla `for await (const part of parts)` döngüsünden **fırlar** — yani route içindeki
tip-bazlı boyut kontrolüne HİÇ ULAŞILMAZ. Sonuç bugün: 100 MB üstü bir yükleme
`422` + `"En fazla 5MB yükleyebilirsiniz."` döner (hem yanlış statü hem yanlış mesaj).

Bu yüzden **her iki katman da gereklidir**:
1. **Global handler** (`error-handler.ts`): `FST_REQ_FILE_TOO_LARGE` → **413
   `PAYLOAD_TOO_LARGE`**, limitten bağımsız/genel bir mesajla (sabit "5MB" metni
   KALDIRILIR — import route'larında yanlıştır). Bu emniyet ağıdır ve ileride eklenecek
   her multipart route'u otomatik kapsar; "type-aware" bir dallanmaya GEREK YOKTUR.
2. **Route-local kontrol** (mevcut `import.routes.ts` yaklaşımı — **ONAYLANDI**):
   tip-bazlı gerçek limiti ve kullanıcıya gösterilecek spesifik mesajı üretir
   (`PayloadTooLargeError`).

Etki alanı denetlendi ve dar: `/admin/media` `openapi.yaml`'da HİÇ tanımlı değil (ayrı
bir kontrat boşluğu — documentation-agent'a not), hiçbir test 422 beklemiyor ve frontend
`friendly-error.ts` yalnızca `error.message`/`details` gösteriyor, statüye göre
dallanmıyor (`PAYLOAD_TOO_LARGE` zaten `frontend/src/lib/api/types.ts`'te tanımlı).
- **Kaynak dosya `uploads/` altına YAZILAMAZ.** `UPLOAD_DIR`, `@fastify/static` ile
  **auth'suz, herkese açık** servis ediliyor; bir WXR/CSV e-posta adresleri ve
  yayınlanmamış taslaklar içerir. İçe aktarma dosyaları ayrı, public OLMAYAN bir yere
  yazılır: `IMPORT_DIR = <cwd>/storage/imports` (local) veya S3'te `imports/` ön eki
  (private ACL, URL üretilmez). Dosya adı `randomUUID()`'dir; kullanıcının verdiği ad
  ASLA yola konmaz. `lib/storage/*` (MediaStorage) bilinçli olarak **kullanılmaz** — o
  soyutlama public bir `url` döndürmek üzere tasarlanmıştır.
  → **devops-agent**: `storage/imports` için `uploads/` ile aynı şekilde volume mount +
  `.gitignore` girdisi + Dockerfile'da klasör oluşturma gerekir.
- **Yaşam süresi**: kaynak dosya iş `COMPLETED|FAILED|CANCELLED` olur olmaz silinir.
  Onaylanmamış `PENDING` işler 24 saat sonra süpürülür — **cron YOK**, süpürme her yeni
  yüklemede tembel (lazy) olarak tetiklenir.

#### 10.8.6 WordPress WXR eşleştirmesi (backend-agent tahmin YÜRÜTMEZ)

WXR, RSS 2.0'ın WordPress ad alanlarıyla genişletilmiş hâlidir. Ad alanı **URI**'leriyle
eşleştirilir, `wp:`/`content:` **ön ekleriyle DEĞİL** (ön ek dosyadan dosyaya değişebilir)
→ `saxes` `{ xmlns: true }` ile kurulur. 1.0/1.1/1.2 URI'lerinin üçü de kabul edilir.

| Ön ek | Ad alanı URI |
|---|---|
| `wp` | `http://wordpress.org/export/1.2/` (ve `.../1.0/`, `.../1.1/`) |
| `excerpt` | `http://wordpress.org/export/1.2/excerpt/` |
| `content` | `http://purl.org/rss/1.0/modules/content/` |
| `dc` | `http://purl.org/dc/elements/1.1/` |
| `wfw` | `http://wellformedweb.org/CommentAPI/` (yok sayılır) |

**Kanal (channel) düzeyi** — `<item>`'lardan önce toplanır:
- `wp:author` → `{ wp:author_login → wp:author_email, wp:author_display_name }` sözlüğü.
  Yalnızca yazar çözümlemesi için kullanılır; **kullanıcı OLUŞTURMAZ**.
- `wp:category` → `{ wp:cat_name (görünen ad), wp:category_nicename (slug) }` →
  `BlogCategory` upsert (`slug` üzerinden). `wp:category_parent` YOK SAYILIR (şemamızda
  kategori hiyerarşisi yok).
- `wp:tag` / `wp:term` → YOK SAYILIR (etiket modelimiz yok) → `WP_TAGS_UNSUPPORTED` uyarısı.

**`wp:post_type` yönlendirmesi:** `post` → `BlogPost` · `page` → `Page` ·
`attachment` → yalnızca URL sözlüğüne (aşağıya bkz.) · `nav_menu_item`, `revision`,
`custom_css`, `wp_global_styles`, `wp_block`, `wp_navigation` ve diğer her şey → ATLANIR
(`UNSUPPORTED_POST_TYPE`, `skippedCount`).

> **`product` item'ları (WooCommerce):** `WORDPRESS` tipinde bunlar da ATLANIR, ancak
> sessizce değil — önizlemede `WP_PRODUCTS_SKIPPED` uyarısı kullanıcıyı aynı dosyayı
> `PRODUCTS` tipiyle yeniden yüklemeye yönlendirir. Eşleme kuralları **§10.8.9**'dadır
> (ayrı tip olma gerekçesi dahil).

**`wp:status` → `PageStatus`:** `publish` → `PUBLISHED` · `draft`/`pending`/`auto-draft`
→ `DRAFT` · `private` → `DRAFT` + `WP_PRIVATE_AS_DRAFT` uyarısı (özel/private durumumuz
yok) · `future` → `DRAFT` + `WP_SCHEDULED_AS_DRAFT` (zamanlanmış yayın desteklenmiyor) ·
`trash`/`inherit` → ATLANIR.

**`<item>` alan eşleştirmesi:**

| WXR alanı | Hedef (BlogPost) | Hedef (Page) | Kural |
|---|---|---|---|
| `title` | `title` | `title` | ZORUNLU; boşsa satır hatası `REQUIRED_FIELD_MISSING` |
| `wp:post_name` | `slug` | `slug` | URL-decode edilir; boşsa `slugify(title)`; çakışma → `duplicateStrategy` |
| `content:encoded` | `contentHtml` | `blocks` | Page'de tek blok: `[{ id: uuid(), type: "text", data: { html } }]`. **Her iki durumda da sanitize edilir (10.8.4).** |
| `excerpt:encoded` | `excerpt` | — | Boşsa `null`. Page'de karşılığı YOK, yok sayılır |
| `wp:status` | `status` | `status` | Yukarıdaki eşleme |
| `wp:post_date_gmt` (yoksa `wp:post_date`) | `publishedAt` | `publishedAt` | Yalnızca `status = PUBLISHED` ise. **`"0000-00-00 00:00:00"` WordPress'in NULL sentinel'idir → `null` sayılır.** Geçersiz tarih → `INVALID_DATE`, satır yine yazılır (`publishedAt: null`) |
| `dc:creator` (author_login) | `authorId` | `authorId` | `wp:author` sözlüğünden e-posta bulunur → `User.email` (case-insensitive) araması. Eşleşme yoksa `options.defaultAuthorId`, o da yoksa `null` + `WP_AUTHOR_UNMATCHED` uyarısı. **ASLA kullanıcı oluşturmaz.** |
| `<category domain="category" nicename="...">` | `categoryId` | — | İLK eşleşen kullanılır (şemada tek kategori). `nicename` → `BlogCategory.slug` upsert, CDATA metni → `name` |
| `<category domain="post_tag">` | — | — | Yok sayılır (`WP_TAGS_UNSUPPORTED`) |
| `wp:postmeta[_thumbnail_id]` | `coverImageUrl` | `ogImageUrl` | Değer = attachment'ın `wp:post_id`'si → o attachment item'ının `wp:attachment_url`'ü. **İki geçişli**: attachment'lar yazılardan SONRA gelebilir, bu yüzden `post_id → attachment_url` sözlüğü önizleme (1. geçiş) sırasında kurulur |
| `wp:postmeta[_yoast_wpseo_title]` \| `[rank_math_title]` | `seoTitle` | `seoTitle` | |
| `[_yoast_wpseo_metadesc]` \| `[rank_math_description]` | `seoDescription` | `seoDescription` | |
| `[_yoast_wpseo_canonical]` \| `[rank_math_canonical_url]` | `canonicalUrl` | `canonicalUrl` | Geçersiz URL → `null` (satır hatası değil) |
| `[_yoast_wpseo_meta-robots-noindex] == "1"` \| `[rank_math_robots]` içinde `noindex` | `noIndex` | `noIndex` | Aksi hâlde `false` |
| `[_yoast_wpseo_opengraph-title]` \| `[rank_math_facebook_title]` | `ogTitle` | `ogTitle` | |
| `[_yoast_wpseo_opengraph-image]` \| `[rank_math_facebook_image]` | `ogImageUrl` | `ogImageUrl` | |
| `wp:post_id`, `guid`, `link` | — | — | Kolon olarak SAKLANMAZ; hata satırlarında `sourceRef` olarak izlenebilirlik sağlar |
| `wp:comment*`, `wp:is_sticky`, `wp:menu_order`, `wp:ping_status`, `wp:comment_status`, `wp:post_password`, `wp:post_parent` | — | — | Yok sayılır |

**Medya (attachment) kararı — v1'de dosya İNDİRİLMEZ.** `wp:attachment_url` kaynak siteyi
gösterir. Sunucudan uzak URL indirmek **SSRF** (iç ağ / cloud metadata servisi taraması)
ve sınırsız süre/bant genişliği demektir. v1: `coverImageUrl` ve `content:encoded`
içindeki `<img src>` **orijinal uzak URL olarak kalır**; `Media` kaydı OLUŞTURULMAZ.
Önizleme `WP_MEDIA_NOT_DOWNLOADED` uyarısıyla bunu açıkça söyler ("N medya bağlantısı
kaynak siteye işaret ediyor, görseller taşınmaz"). Görselleri taşımak isteyen kullanıcı,
WordPress medya klasörünü ZIP'leyip `MEDIA` içe aktarımını kullanır. İleride
`downloadMedia` bayrağı eklenirse allow-list + DNS rebinding koruması + boyut/süre limiti
ZORUNLU olur.

**Güvenlik — XXE / billion-laughs (security-agent denetler):**
1. Ayrıştırıcı seçimi (`saxes`) dış varlık çözümlemesini yapısal olarak imkânsız kılar.
2. Buna EK OLARAK, ayrıştırmadan önce dosyanın ilk 64 KB'ı (prolog ve DOCTYPE ancak orada
   bulunabilir) taranır; `<!DOCTYPE` veya `<!ENTITY` görülürse dosya **422 ile reddedilir**
   (mesaj: "XML DTD/varlık tanımı içeren dosyalar güvenlik nedeniyle kabul edilmez.").
   Bu, ayrıştırıcıdan bağımsız ikinci savunma katmanıdır (defense-in-depth).
3. Derinlik/eleman sayacı: 100 seviyeden derin iç içe geçme veya 10.000'den fazla item
   → **yükleme anında 422, iş OLUŞTURULMAZ** (mimar kararı; bu madde önceden "iş `FAILED`"
   diyordu, §10.8.5'teki genel kayıt-tavanı kuralıyla çelişiyordu — genel kural geçerlidir).

**Genel ilke (tüm tipler için bağlayıcı):** Kaynak dosyadan **statik olarak** tespit
edilebilen her kusur — boyut, format uyuşmazlığı, kayıt tavanı, DTD/derinlik, ZIP bombası,
zip-slip — önizleme geçişi sırasında yakalanır ve **422 ile reddedilir, iş oluşturulmaz**
(boyut aşımı hariç: o 413'tür, bkz. §10.8.5). `FAILED` durumu YALNIZCA çalışma anında
ortaya çıkan hatalara ayrılmıştır (DB hatası, sunucu yeniden başlatma). Gerekçe: kullanıcı
hatayı anında ve düzeltilebilir biçimde görür; "iş oluştur → başlat → poll et → başarısız
olduğunu öğren" döngüsü, önizleme adımının varlık sebebini ortadan kaldırırdı. Ayrıca
`FAILED` işlerin listesi böylece gerçek operasyonel arızaların sinyali olarak kalır,
kullanıcı girdi hatalarıyla gürültülenmez.

#### 10.8.7 Tip bazlı özel kurallar

**`USERS` (CSV):** sütunlar `name,email,role` (başlıklar Türkçe olabilir, eşleştirme
`fieldMapping` ile). `role` ∈ `ADMIN|MANAGER|EDITOR|CUSTOMER|USER` (büyük/küçük harf duyarsız, §10.21); boşsa
`EDITOR` (`POST /admin/users` varsayılanıyla aynı). Kayıt akışı mevcut uçla BİREBİR
AYNIDIR: rastgele kullanılamaz şifre + şifre belirleme token'ı + e-posta. E-posta
gönderimi **satır bazında best-effort**'tur; başarısızlık kullanıcıyı SİLMEZ, satır
`EMAIL_DELIVERY_FAILED` (`severity: error`) olarak raporlanır ama kullanıcı oluşmuş kalır.
Var olan e-posta → `DUPLICATE_SKIPPED`. **`overwrite`/`createNew` YASAK (422)** — CSV ile
rol değiştirmek yetki yükseltme vektörüdür; rol değişikliği tek yolla,
`PATCH /admin/users/{userId}/role` ile yapılır. Her oluşturulan kullanıcı için `AuditLog`
`user.create` yazılır (metadata'ya `importJobId` eklenir). E-posta gönderimi 10/sn ile
kısılır (SMTP sağlayıcısı korunur).

**`MEDIA` (ZIP):**
- MIME tipi **magic bytes**'tan belirlenir, uzantıdan DEĞİL (arşiv içi ad saldırgan
  kontrolündedir). İzin verilenler `media.routes.ts::ALLOWED_MIME_TYPES` ile aynı, ANCAK
  `image/svg+xml` **hariç** → `MEDIA_SVG_REJECTED`.
- Zip bombası koruması (herhangi biri ihlal → 422, iş oluşturulmaz): giriş sayısı > 500;
  tek girişin açılmış boyutu > 5 MB; toplam açılmış boyut > 200 MB; herhangi bir girişte
  sıkıştırma oranı (açılmış/sıkıştırılmış) > 100.
- **Zip-slip koruması — TÜM ARŞİV reddedilir (mimar kararı, "fail closed").** `..`,
  mutlak yol veya sürücü harfi içeren TEK BİR giriş adı, arşivin tamamını **422** ile
  reddettirir; kalan girişler işlenmez. Bu, `yauzl@3`'ün fiili davranışıdır (giriş adını
  kendi içinde valide eder ve ilk güvensiz isimde okumayı tümüyle abort eder, `entry`
  event'i hiç emit edilmez) ve bilinçli olarak BENİMSENMİŞTİR — bypass edilip elle
  giriş-bazlı okumaya geçilMEYECEKTİR. Gerekçe: zip-slip yolu içeren bir arşiv "biraz
  kirli" bir arşiv değildir; bizi hedef alan bir araçla üretilmiştir. Böyle bir girdiye
  kısmi güven göstermek yanlış varsayılandır. Ek fayda: davranışı akıl yürütmesi ve test
  etmesi tekildir ("ya tamamı ya hiçbiri").
  → backend-agent'ın eklediği **giriş-bazlı yedek kontrol KORUNUR** (defense-in-depth):
  yauzl ileride değişir/değiştirilirse veya `strictFileNames` semantiği kayarsa koruma
  ayakta kalır.
- Bunun **istisnası zararsız girişlerdir**: dizin girişleri, `__MACOSX/`, nokta ile
  başlayan dosyalar ve desteklenmeyen MIME'ler tek tek ATLANIR (arşivin geri kalanı
  işlenir). Yani kural şudur: **kötü niyetli yol → tüm arşiv reddedilir; zararsız/ilgisiz
  giriş → yalnızca o giriş atlanır.**
- Diskteki ad zaten `storage.save()` tarafından üretilir; arşivdeki ad ASLA yola konmaz.
- Yazma yolu mevcut `lib/storage` (public `/uploads/`) üzerindendir — bu DOĞRUDUR, medya
  zaten publictir. Rapor `filename → url` eşlerini listeler ("dosya adı eşleştirme").

**`PAGES`/`BLOG` (CSV/JSON):** `title` zorunlu. `slug` boşsa `slugify(title)`. `status`
boşsa `options.defaultStatus` (varsayılan **`DRAFT`** — gözden geçirilmemiş içerik public
siteye düşmesin). `categoryName` verilirse `BlogCategory` slug üzerinden upsert edilir,
yoksa `options.defaultCategoryId`. `authorEmail` verilirse `User` araması yapılır,
bulunamazsa `options.defaultAuthorId` → `null` (**kullanıcı oluşturulmaz**). JSON girdisi
bir kayıt **dizisi** ya da `{ items: [...] }` olabilir.

**Yazar/kategori çözümlenememesi satır hatası DEĞİLDİR (mimar kararı).** Kayıt başarıyla
yazılır, yalnızca ilgili alan default'a/`null`'a düşer. Bu yüzden `ImportJobErrorCode`
listesinden `AUTHOR_UNRESOLVED` ve `CATEGORY_UNRESOLVED` **KALDIRILMIŞTIR** — spec'te
tanımlıydılar ama hiçbir yerde tetiklenmiyorlardı. Gerekçe: `ImportJobError.severity`
yalnızca `ERROR|SKIPPED` olabilir ve ikisi de sayaçları besler; başarıyla yazılmış bir
satırı "hata" ya da "atlandı" diye raporlamak "150 kayıttan 147 başarılı, 3 hata"
özetini doğrudan yanıltıcı kılardı. Hata modelinde bilinçli olarak `WARNING` severity
YOKTUR; ileride gerçekten gerekirse severity + kodlar TEK BİR kararla birlikte eklenir.
Operatörün kontrol mekanizması `StartImportJobRequest.defaultAuthorId` /
`defaultCategoryId` alanlarıdır; WXR'da ayrıca onay ÖNCESİ agregat uyarı gösterilir
(`WP_AUTHOR_UNMATCHED`), ki asıl faydalı yer de orasıdır — kullanıcı henüz onaylamamıştır.

**`PRODUCTS` (WooCommerce XML):** kuralları hacimli olduğu için AYRI bir bölümdedir —
bkz. **§10.8.9** (fiyat/SKU/stok/KDV/kategori/görsel eşlemesi, `defaultCurrency`,
`defaultStatus`'un genişlemiş anlamı, sipariş PII düşürme kuralı).

**`overwrite` ile Page/BlogPost/Product güncellemesi**, normal `PATCH` gibi önce bir
`ContentRevision` snapshot'ı yazar (§10.1) — içe aktarma da geri alınabilir olsun diye.
**Çöpteki (`deletedAt != null`) kayıt ASLA overwrite EDİLMEZ** → `TARGET_TRASHED`
(§10.7'deki "çöpteki içerik düzenlenemez" kuralıyla tutarlı).

**Geri alma (rollback) v1 KAPSAM DIŞI.** Yanlış içe aktarım
`POST /admin/{pages|blog}/bulk` + `action: trash` ile temizlenir; UI rapor ekranında bu
yolu gösterir.

#### 10.8.8 Saklama & KVKK (compliance-agent değerlendirir)

- `ImportJob` kayıtları **90 gün** saklanır; `ImportJobError.rawData` KİŞİSEL VERİ
  içerebilir (`USERS` içe aktarımında ad/e-posta). ADMIN-only erişim tek başına yeterli
  değildir — saklama süresi ve gerekiyorsa maskeleme compliance-agent kararıdır.
- Kaynak dosya iş biter bitmez silinir (10.8.5) — bu, en büyük PII yığınını en kısa sürede
  ortadan kaldırır.
- `AuditLog`: `import.upload`, `import.start`, `import.cancel`, `import.delete` +
  `USERS` içe aktarımında satır başına mevcut `user.create`.
- **AÇIK BLOKER (tüm tipleri etkiler, bkz. §10.8.9.1):** `recoverStuckImportJobs` ve
  `runImportRetentionSweep` işin `storagePath`'ini temizlemiyor → çökme/restart sonrası
  PII taşıyan ham kaynak dosya öksüz kalabiliyor. Her iki fonksiyona `importStorage.remove`
  + `storagePath: null` eklenmelidir (backend-agent).

##### 10.8.8.1 compliance-agent kararı (2026-08-05) — ÜRETİME ÇIKIŞ İÇİN KOŞULLU ONAY

**Sonuç: ONAY — ŞARTLA. Aşağıdaki 1(a)/1(b) maddeleri yapılmadan üretime çıkış
BLOCKER'dır.** Kod incelendi: `ImportJob`/`ImportJobError` şeması (`schema.prisma`),
`import.worker.ts` (rawData'nın nasıl doldurulduğu, tüm çağrı yerleri), `import.routes.ts`
(RBAC, `GET .../errors`), `lib/audit.ts`. Bulgular ve gerekçeli kararlar aşağıdadır. Bu bir
hukuki görüş DEĞİLDİR; nihai saklama süreleri için gerçek bir KVKK/GDPR hukuk danışmanına
onaylatılmalıdır (bkz. madde 3, sonda).

**Bulgu — dokümante edilen politika ile kod arasında boşluk:** §10.8.8 "90 gün saklanır"
diyor ama kodda (`import.constants.ts`, `import.routes.ts`, `grep -r "cron|setInterval|
scheduled" backend/src`) bunu uygulayan HİÇBİR mekanizma yok. Tek var olan süpürme
`sweepStalePendingJobs` (§10.8.5) — o yalnızca 24 saatten eski `PENDING` (hiç
başlatılmamış) işleri temizler; `COMPLETED`/`FAILED`/`CANCELLED` işler ve bunların
`ImportJobError.rawData`'sı bugün İTİBARİYLE SÜRESİZ saklanıyor. Yazılı bir "90 gün"
kararının uygulanmadan durması, KVKK m.4/2-d ve GDPR Art. 5(1)(e) "saklama sınırlaması"
ilkesi açısından kabul edilemez — bu yüzden BLOCKER.

**1. Saklama süresi kararı (ikiye ayrılmış — job zarfı vs. PII taşıyan hata satırı):**

- `ImportJob` zarfı (status, sayaçlar, `filename`, `options`, `createdById` referansı —
  başlı başına PII değil, dolaylı biçimde "kim ne zaman ne yükledi" bilgisi taşır):
  mimarın belirlediği **90 gün** AYNEN KORUNUR, kısaltmaya gerek yok.
- `ImportJobError.rawData` (ad/e-posta/ham satır barındırabilir — asıl PII yükü):
  **90 gün fazla uzun.** Amaç yalnızca ADMIN'in hatalı satırı görüp düzeltmesidir; bu
  operasyonel ihtiyaç gün/hafta mertebesindedir, ay mertebesinde değil. Karar:
  **`rawData` (ve `USERS` tipinde e-posta içeren `sourceRef`) job'un geri kalanından
  BAĞIMSIZ olarak 30 gün sonra REDAKTE edilir** (satır silinmez — `code`/`message`/
  `severity`/`rowNumber`/`field`/`jobId` istatistik ve denetim amaçlı kalır; yalnızca
  PII içeren alanlar `null`/`{ _redacted: true }` yapılır). Bu, "veri minimizasyonu
  zaman içinde ilerler" (progressive redaction) yaklaşımıdır — job seviyesinde
  operasyonel geçmiş korunurken PII erken temizlenir.
- **1(a) — backend-agent'a somut gereksinim (BLOCKER, üretim öncesi ZORUNLU):**
  Gerçek zaman-tetiklemeli bir zamanlanmış iş (cron / uygulama içi periyodik
  `setInterval` / devops-agent'ın yöneteceği bir scheduler — seçim backend-agent +
  devops-agent'ın kararı, tek instance varsayımı §10.8.1'deki gibi kabul edilebilir):
  - Her çalıştığında `ImportJobError` için `createdAt < now() - 30 gün` olan satırlarda
    `rawData = null` yapar; `job.type === "USERS"` ise aynı satırların `sourceRef`'ini de
    (e-posta içerebilir) redakte eder — diğer tiplerde `sourceRef` (post_id/guid/dosya
    adı) PII DEĞİLDİR, dokunulmaz.
  - Her çalıştığında `status IN (COMPLETED, FAILED, CANCELLED)` VE
    `(finishedAt ?? createdAt) < now() - 90 gün` olan `ImportJob` satırlarını SİLER —
    `ImportJobError` `onDelete: Cascade` olduğundan (şemada zaten var) çocuk satırlar
    otomatik gider.
  - **NEDEN "tembel/lazy" (yeni yüklemede tetiklenen) DEĞİL, gerçek zaman-bazlı olmalı:**
    §10.8.1 kendi ifadesiyle içe aktarma "nadir" bir işlemdir — bu, `sweepStalePendingJobs`
    gibi bir sonraki yüklemeye bağlı tetikleme ile saklama SLA'sının haftalarca/aylarca
    gecikebileceği, dolayısıyla ihlal edilebileceği anlamına gelir. Retention bir
    uyumluluk taahhüdüdür, "biri bir şey yüklerse çalışır" YETERSİZDİR.
  - İdempotent ve tekrar çalıştırılabilir olmalı (zaten redakte/silinmiş satırlarda no-op).
- **1(b) — backend-agent'a somut gereksinim (BLOCKER, üretim öncesi ZORUNLU, küçük
  değişiklik):** `import.worker.ts` `runUsersJob` içinde `DUPLICATE_SKIPPED` satırı
  (`~L767`, bugün `rawData: record`) **`rawData` YAZMAMALI** (`undefined`/atlanmalı).
  Gerekçe: bu satır, importu YÜKLEYEN kişinin değil, sistemde ZATEN var olan BAŞKA bir
  kullanıcının PII'sini — o kullanıcının rızası/bilgisi/import işlemiyle bir ilgisi
  olmaksızın — gereksiz yere ikinci bir tabloya kopyalar. Teşhis değeri sıfırdır:
  "hangi e-posta çakıştı" bilgisi zaten `sourceRef: email` alanında var, tam satırın
  (ad + rol dahil) ayrıca `rawData`'da durmasının hiçbir operasyonel faydası yoktur —
  veri minimizasyonu ilkesi (KVKK m.4/2-c, GDPR Art. 5(1)(c)) ihlali. Diğer tiplerin
  `DUPLICATE_SKIPPED` çağrıları (örn. `MEDIA`: `rawData: { name: entry.name }`) zaten
  minimal, değişiklik gerekmez.

**2. Maskeleme kararı: gerekli DEĞİL (yukarıdaki 1a/1b şartıyla).** `rawData` içindeki
e-posta/ad için yazım anında kısmi maskeleme (`a***@example.com`) İSTENMİYOR. Gerekçe:
(i) erişim zaten ADMIN-only'e sıkı biçimde kısıtlı (`import.routes.ts`
`requireSiteRole("ADMIN")` router-seviyesinde) — `User` tablosunun kendisiyle AYNI güven
seviyesi, maskeleme burada ek bir koruma katmanı eklemez; (ii) ADMIN'in hatayı teşhis
edebilmesi için TAM değeri görmesi gerekir (örn. `INVALID_EMAIL` — hangi karakterin
hatalı olduğunu görmek için maskelenmemiş değer şart); (iii) `rawData` serbest-form
`Json` olduğundan (fieldMapping'e göre değişen sütunlar) tutarlı/genel bir maskeleme
fonksiyonu yazmak, kazanılan gizlilik faydasına kıyasla orantısız mühendislik karmaşıklığı
getirir. **Bu kabul TAMAMEN 1(a)'nın (30 günlük otomatik redaksiyon) fiilen üretime
çıkmış olması ŞARTINA bağlıdır** — 1(a) yoksa "kısa saklama + ADMIN-only" savunması
geçersiz kalır ve maskeleme yeniden gündeme gelir.

**3. `AuditLog` tutarlılığı — BLOCKER DEĞİL ama proje-geneli acil bulgu:** `AuditLog`
şemasında (`schema.prisma` L480-499) VE kodda hiçbir saklama politikası/temizleme
mekanizması yok — bu Import'tan ÖNCE de var olan bir boşluktur, Import'un YARATTIĞI bir
sorun değildir, bu yüzden Import'un üretime çıkışını BLOKE ETMİYORUM. Ancak Import bu
boşluğun PII yoğunluğunu somut biçimde artırıyor: `USERS` tipi bir iş başına en fazla 500
satır (`IMPORT_RECORD_CAPS.USERS`), her biri `metadata: { email, role, importJobId }`
içeren `user.create` audit kaydı yazabiliyor (`import.worker.ts:778-785`) — hepsi
SÜRESİZ duruyor. **Öneri (architect'e ayrı, bağımsız bir backlog maddesi olarak
devredilir):** `AuditLog` için proje-geneli bir saklama süresi tanımlanmalı (güvenlik/
denetim logları için tipik başlangıç noktası 1-2 yıl — KESİN rakam hukuki onay gerektirir,
bkz. madde 4) + eşleşen bir temizleme işi. Bu, Import'un DoD'sinin bir parçası değildir.

**4. Unutulma hakkı (KVKK m.11 / GDPR Art. 17) — bugün ürünün HİÇBİR YERİNDE bir "kullanıcı
silme" ucu yok (`grep -ri "deleteUser\|right to erasure\|unutulma" backend/src` → 0
sonuç).** Bu Import modülünün eksiği DEĞİL, ürün genelinde henüz hiç inşa edilmemiş bir
akış — bu yüzden Import'u BLOKE ETMİYORUM. Ancak ileride bu akış inşa edildiğinde
(backend-agent, ayrı görev) şunlar ZORUNLU olarak kapsanmalı:
- Hedef kullanıcının e-postasını içeren `ImportJobError.rawData`/`sourceRef` satırları da
  redakte edilmeli (1(a)'daki 30 günlük otomatik redaksiyon bu pencereyi büyük ölçüde
  daraltır, ama 0-30 gün arası için hâlâ manuel bir eşleştirme/redaksiyon adımı gerekir —
  `sourceRef = email` OR `rawData` JSON içinde e-posta araması ile).
  Not: bir `USERS` importunda kullanıcı BAŞARIYLA oluşturulmuş ama e-posta gönderimi
  başarısız olmuşsa (`EMAIL_DELIVERY_FAILED`, `import.worker.ts:795-802`) `rawData` o
  kullanıcının `User` satırıyla ZATEN aynı bilgiyi tekrarlar; erişim seviyesi aynı
  olduğundan bu, silme talebinde ayrıca risk artırmaz ama tutarlılık için yine de
  redakte edilmelidir.
- `AuditLog` satırları silme talebiyle OTOMATİK silinMEMELİDİR — denetim/kötüye kullanım
  önleme amacı, KENDİ SINIRLI ve TANIMLI saklama süresi dahilinde erişim hakkını meşru
  biçimde geçersiz kılabilir (GDPR Art. 17(3)(b) benzeri gerekçe) — ANCAK bu istisnanın
  geçerli olabilmesi tam olarak madde 3'teki tanımlı/sonlu saklama süresinin var
  OLMASINA bağlıdır; "sınırsız süre" bir istisna gerekçesi olamaz. Bu da madde 3'ü
  Import'tan bağımsız ama ACİL kılan ikinci sebeptir.

> **Architect güncellemesi (2026-08-18) — bu maddenin DURUM TESPİTİ kısmen eskidir,
> KARARI ve yukarıdaki gereksinimleri AYNEN geçerlidir:** `DELETE /admin/users/{userId}`
> eklendi, ancak bu bir **yumuşak silmedir**, erasure DEĞİLDİR (kişisel veri satırda
> kalmaya devam eder) — bkz. **§10.18**. Gerçek anonimleştirme akışı hâlâ AÇIKTIR ve
> compliance-agent + db-agent'a devredilmiştir; konsolide backlog maddesi **§10.18.1**'dedir.

**5. Onaylanan / değişiklik gerektirmeyen maddeler:**
- Kaynak dosyanın iş biter bitmez silinmesi (§10.8.5) — en büyük PII yığınının en kısa
  sürede yok edilmesi, doğru uygulama.
- `/admin/import/*` router-seviyesi `requireSiteRole("ADMIN")` — uygun erişim katmanı.
- `ImportJob` zarfı için 90 günlük süre (madde 1'deki ayrıma bakınız).
- `WORDPRESS`/`PAGES`/`BLOG` tipi `rawData`'daki daha düşük hassasiyetli PII
  (`authorEmail` sütunu, WXR `creatorLogin`) — 1(a)'daki 30 günlük redaksiyon TÜM
  `ImportJobError` satırlarına tip ayrımı yapılmadan uygulanacağından ayrıca bir kod
  yolu gerekmez.

**Hukuki not:** Bu bölüm KVKK/GDPR ilkelerinin (veri minimizasyonu, saklama sınırlaması,
unutulma hakkı) teknik bir gereksinime çevrilmesidir; hukuki tavsiye YERİNE GEÇMEZ.
Özellikle madde 1'deki 30/90 günlük rakamlar ve madde 3'teki `AuditLog` süresi, nihai
onay için şirketin KVKK/GDPR hukuk danışmanına sunulmalıdır.

#### 10.8.9 WooCommerce (`PRODUCTS`) eşleştirmesi (backend-agent tahmin YÜRÜTMEZ)

Durum: v1 · Sahibi: Mimar. Bağlayıcı kaynak: `openapi.yaml` (`ImportJobType: PRODUCTS`).
**§10.8.6 (WordPress WXR) bu bölümün ÖN KOŞULUDUR** — ad alanı çözümlemesi, `saxes`
kurulumu, XXE/DTD savunması, iki geçişli attachment sözlüğü, `dc:creator` yazar
çözümlemesi ve Yoast/RankMath SEO postmeta eşlemesi BİREBİR AYNIDIR ve burada tekrar
edilmez. Bu bölüm yalnızca **farkları** tanımlar.

**Neden ayrı tip (`PRODUCTS`), `WORDPRESS`'e eklenti değil — karar 2A:** İkisi de aynı
WXR dosyasını okur; fark yalnızca `wp:post_type` filtresidir. `WORDPRESS` akışına ürün
yazmak **sessiz bir yan etki** olurdu: bugün o tipi seçen kullanıcı sayfa/yazı bekler,
`Products` modülü kapalı olsa bile kayıt üretilirdi ve önizlemedeki sayaçlar ne
gösterdiğinden bağımsız olarak mağazaya veri düşerdi. Ayrı tip → ayrı önizleme, ayrı
onay, ayrı sayaç, ayrı audit. `WORDPRESS` tipinde karşılaşılan `product` item'ları
ATLANIR (`UNSUPPORTED_POST_TYPE`, `skippedCount`) ve önizlemede `WP_PRODUCTS_SKIPPED`
uyarısı kullanıcıyı doğru tipe yönlendirir. Tersi de geçerlidir: `PRODUCTS` tipinde
`post`/`page` item'ları atlanır.

**Portföy içe aktarımı KAPSAM DIŞI (karar 2B).** WordPress tarafında portföyün standart
bir post-type'ı YOKTUR (her tema kendi CPT'sini uydurur: `jetpack-portfolio`,
`avada_portfolio`, `project`…). Tahmine dayalı bir eşleme, yanlış içeriği yanlış modüle
yazma riskini taşır; ihtiyaç doğarsa ayrı bir karar ve ayrı bir `PORTFOLIO` tipiyle
ele alınır.

**Kapsanan `wp:post_type` değerleri:**
- `product` → `Product` (TEK yazılan tür).
- `product_variation` → ATLANIR (`UNSUPPORTED_POST_TYPE`) + `WC_VARIATIONS_UNSUPPORTED`.
  Şemamızda varyant/öznitelik modeli YOKTUR; `variable` tipli ürünün yalnızca ANA kaydı
  yazılır (fiyatı `_price`/`_regular_price`'tan, yoksa varyasyonların en düşüğünden
  DEĞİL — türetme yapılmaz, fiyat yoksa satır hatası).
- `shop_order`, `shop_order_refund`, `shop_coupon`, `shop_subscription`, `customer`
  → **ASLA içe aktarılmaz**, `skippedCount` + `WC_ORDERS_IGNORED` (aşağıda PII kuralı).
- Diğer her şey (`nav_menu_item`, `revision`, `wp_block`, `attachment` …) → §10.8.6'daki
  kuralla atlanır (`attachment`, yalnızca 1. geçişte `post_id → attachment_url`
  sözlüğüne girer).

**`<item>` alan eşleştirmesi (WooCommerce → `Product`):**

| WXR / postmeta alanı | Hedef (`Product`) | Kural |
|---|---|---|
| `title` | `title` | ZORUNLU; boşsa `REQUIRED_FIELD_MISSING` |
| `wp:post_name` | `slug` | URL-decode; boşsa `slugify(title)`; çakışma → `duplicateStrategy` |
| `content:encoded` | `descriptionHtml` | **Sanitize edilir (§10.8.4).** WooCommerce shortcode'ları (`[product_page]`, `[woocommerce_...]`) düz metin olarak KALIR — yorumlanmaz, ayrıştırılmaz |
| `excerpt:encoded` | `excerpt` | WooCommerce "kısa açıklama"sıdır; boşsa `null` |
| `_sku` | `sku` | Trim edilir; boş string → `null`. **Tekillik anahtarıdır** (aşağıya bkz.) |
| `_regular_price` | `priceCents` | ZORUNLU (aşağıdaki fiyat kuralı). Yoksa `_price`'a düşülür; ikisi de yoksa `REQUIRED_FIELD_MISSING` |
| `_sale_price` | `discountPriceCents` | Boş/0 → `null`. **`>= priceCents` ise `null`'a düşürülür** (satır hatası DEĞİL — bkz. fiyat kuralı) |
| `_price` | — | Yalnızca `_regular_price` yoksa yedek kaynak; kolon olarak SAKLANMAZ (WooCommerce'in "etkin fiyat" önbelleğidir) |
| (dosyada yok) | `currency` | `StartImportJobRequest.defaultCurrency` (varsayılan `TRY`) — WXR para birimi TAŞIMAZ |
| `_tax_status`, `_tax_class` | `taxRatePercent` | **`null` bırakılır** + `WC_TAX_NOT_IMPORTED` (bkz. KDV kuralı) |
| `_manage_stock`, `_stock`, `_stock_status` | `stockQuantity` | Bkz. stok kuralı + `WC_STOCK_NOT_MANAGED` |
| `<category domain="product_cat" nicename="...">` | `categoryId` | İLK eşleşen kullanılır (şemada tek kategori). `nicename` → `ProductCategory.slug` upsert, CDATA metni → `name`. Hiç yoksa `defaultCategoryId`, o da yoksa `null` |
| `<category domain="product_tag">` | — | Yok sayılır (`WP_TAGS_UNSUPPORTED`, §10.8.6 ile aynı) |
| `_thumbnail_id`, `_product_image_gallery` | — | **`coverMediaId` = `null`, `ProductImage` YAZILMAZ** + `WC_GALLERY_NOT_IMPORTED` (bkz. görsel kuralı) |
| `wp:status` | `status` | §10.8.6 eşlemesi UYGULANIR, sonra **§2C tavanı**: sonuç `defaultStatus`'u AŞAMAZ (varsayılan `DRAFT`). `trash`/`inherit` → ATLANIR |
| `wp:post_date_gmt` (yoksa `wp:post_date`) | `publishedAt` | Yalnızca nihai `status = PUBLISHED` ise. `"0000-00-00 00:00:00"` → `null` |
| `dc:creator` | `authorId` | §10.8.6 ile AYNI (`wp:author` sözlüğü → `User.email`; yoksa `defaultAuthorId` → `null` + `WP_AUTHOR_UNMATCHED`). **ASLA kullanıcı oluşturmaz** |
| Yoast / RankMath postmeta | `seoTitle`, `seoDescription`, `canonicalUrl`, `noIndex`, `ogTitle`, `ogImageUrl` | §10.8.6 tablosuyla BİREBİR AYNI |
| `_weight`, `_length`, `_width`, `_height`, `_virtual`, `_downloadable`, `_download_*`, `_backorders`, `_sold_individually`, `_purchase_note`, `_upsell_ids`, `_crosssell_ids`, `_product_url`, `_button_text`, `_children`, `_wc_review_count`, `_wc_average_rating` | — | Şemamızda karşılığı YOK → yok sayılır (önizlemede `status: ignored`, satır hatası DEĞİL) |
| `wp:post_id`, `guid`, `link` | — | Saklanmaz; hata satırlarında `sourceRef` olarak izlenebilirlik sağlar |
| `wp:comment*` (ürün yorumları/puanları) | — | Yok sayılır — yorum/derecelendirme modelimiz yok |

**Fiyat kuralı (en kritik madde — `Product.priceCents` HER ZAMAN kuruş cinsinden `Int`):**
1. WooCommerce fiyatı ondalıklı bir METİNDİR (`"199.90"`, bazı export'larda `"199,90"`).
   Ayrıştırma: binlik ayraçları temizle, virgülü noktaya çevir, `Number` ile oku.
2. **Kuruşa çevirme `Math.round(value * 100)` ile YAPILMAZ** — float hassasiyeti
   (`19.99 * 100 = 1998.9999…`) para biriminde kabul edilemez. Ondalık kısım METİN
   üzerinden ayrılır (`"199.9"` → tam kısım `199`, kesir `90`'a pad'lenir) ve tam sayı
   aritmetiğiyle birleştirilir. İkiden fazla ondalık basamak → **banker's rounding DEĞİL**,
   yarım yukarı yuvarlanır ve satır BAŞARILI sayılır.
3. Sonuç `<= 0` veya sayı değilse → `INVALID_VALUE` (satır hatası, ürün yazılmaz).
   `CreateProductRequest.priceCents` zaten `minimum: 1`'dir; ücretsiz ürün v1'de YOK.
4. `_sale_price >= _regular_price` (WooCommerce bunu ENGELLEMEZ, geçmiş kampanya artığı
   sık görülür) → `discountPriceCents = null` ve satır **BAŞARILI** yazılır. Gerekçe:
   `assertDiscountBelowPrice` çapraz-alan kuralı bizim iş kuralımızdır; kaynak veriyi
   bu yüzden reddetmek, yüzlerce ürünlük bir mağaza aktarımını anlamsızca bölerdi —
   indirimi düşürmek bilgi kaybı olmayan güvenli yoldur (operatör sonradan girer).

**SKU / tekillik kuralı (karar 2E):** Eşleştirme anahtarı `sku`'dur (varsa), `sku` boşsa
`slug`. `Product.sku` DB'de uniquedir.
- `skip` (varsayılan) → mevcut ürün korunur, satır `DUPLICATE_SKIPPED` (`skipped`).
- `overwrite` → mevcut ürün güncellenir; normal `PATCH` gibi ÖNCE `ContentRevision`
  snapshot'ı yazılır (§10.1, `entityType: PRODUCT`). Çöpteki kayıt ASLA overwrite
  edilmez → `TARGET_TRASHED`.
- `createNew` → slug çakışması `-2`/`-3` ile çözülür, **ama SKU çakışmasında satır
  ATLANIR** (`DUPLICATE_SKIPPED`, `severity: skipped`). "SKU'ya `-2` ekleyip yeni ürün
  aç" davranışı YASAKTIR: `ABC-1` ile `ABC-1-2` iki ayrı stok kalemi demektir ve
  mağazanın envanterini sessizce bozar. SKU'suz ürünler (`sku: null`) `createNew` ile
  sorunsuz çoğaltılır (unique kısıt `null`'ları çakıştırmaz).
- **Dosya İÇİNDE tekrarlanan SKU** (aynı WXR'da iki `product` aynı `_sku` ile): ilk satır
  yazılır, sonrakiler `DUPLICATE_SKIPPED`. Bu kontrol DB'ye gitmeden, iş boyunca tutulan
  bir `Set` ile yapılır — aksi halde aynı transaction içinde unique ihlali alınırdı.

**Stok kuralı:** `Product.stockQuantity` `Int` (nullable DEĞİL, `minimum: 0`).
- `_manage_stock: yes` → `stockQuantity = parseInt(_stock)`; negatif değer (WooCommerce
  backorder'da negatife düşebilir) → `0`'a sıkıştırılır; ayrıştırılamıyorsa `0`.
- `_manage_stock: no` (veya yok) → `_stock` GÜVENİLİR DEĞİLDİR. `_stock_status`'a
  düşülür: `instock` → `1`, `outofstock` → `0`, `onbackorder` → `0`. Bu ürünler için
  önizlemede **`WC_STOCK_NOT_MANAGED`** uyarısı üretilir (agregat, satır hatası değil):
  "N üründe stok takibi kapalı; miktar 0/1 olarak varsayıldı, içe aktarımdan sonra
  gözden geçirin." Gerekçe: `1` yazmak "stokta var" bilgisini korur; `0` yazmak
  mağazayı sessizce satışa kapatırdı, büyük bir sayı yazmak ise olmayan stok satardı.

**KDV kuralı:** WooCommerce WXR'ı vergi ORANI TAŞIMAZ — item düzeyinde yalnızca vergi
SINIFI (`_tax_class`: boş/`reduced-rate`/`zero-rate`) ve `_tax_status` bulunur; gerçek
yüzdeler mağazanın vergi tablosundadır ve export'a GİRMEZ. Sınıf adından yüzde tahmin
etmek (`reduced-rate` → %10?) ülkeye/yıla göre değişen bir varsayımdır ve **yanlış
faturaya** yol açar. Karar: `taxRatePercent = null` bırakılır + önizlemede
`WC_TAX_NOT_IMPORTED` uyarısı. Not: bizim modelimizde KDV fiyata DAHİLDİR (§10.9.2),
yani `null` KDV `priceCents`'i etkilemez — yalnızca fatura ayrıştırması yapılamaz.

**Görsel kuralı:** `_thumbnail_id` ve `_product_image_gallery` (virgülle ayrılmış
attachment id listesi) kaynak sitedeki dosyalara işaret eder. §10.8.6'daki
**SSRF gerekçesi burada da aynen geçerlidir** (uzak URL indirmek iç ağ/cloud metadata
taraması ve sınırsız bant genişliği demektir). ANCAK `Page`/`BlogPost`'tan bir FARK
vardır: orada `coverImageUrl` SERBEST METİN olduğu için uzak URL öylece saklanabiliyordu;
`Product.coverMediaId` ise **`Media` tablosuna gerçek bir FK'dir** (§10.9.2) —
uydurulmuş bir `Media` satırı OLUŞTURULAMAZ. Bu yüzden:
- `coverMediaId = null`, `ProductImage` satırı YAZILMAZ.
- `descriptionHtml` içindeki `<img src>` uzak URL olarak KALIR (sanitize'dan geçerek).
- Önizlemede `WC_GALLERY_NOT_IMPORTED`: "N ürün görseli kaynak siteye işaret ediyor;
  görseller taşınmaz. Medya klasörünü ZIP'leyip `MEDIA` içe aktarımıyla yükledikten
  sonra kapak görsellerini elle atayın."

**Sipariş/müşteri PII düşürme kuralı (compliance-agent için bağlayıcı):**
WooCommerce export'u sıklıkla `shop_order` item'ları içerir; bunlar ad, e-posta,
telefon, fatura/teslimat ADRESİ ve ödeme meta'sı (`_billing_*`, `_shipping_*`,
`_payment_method`, `_transaction_id`) taşır — yani projedeki **en yoğun PII yığını**.
1. Bu item'lar hiçbir tipte içe AKTARILMAZ (`Order` kayıtları yalnızca gerçek
   Stripe checkout akışından doğar, §10.9.3).
2. Atlanırken **`ImportJobError.rawData` ve `sourceRef` YAZILMAZ** (`undefined`).
   §10.8.8.1 madde 1(b) ile AYNI gerekçe: içe aktarmayı yapan kişinin değil, ÜÇÜNCÜ
   kişilerin PII'sini hata tablosuna kopyalamak veri minimizasyonu ihlalidir. Satır
   yalnızca `rowNumber` + `code` + Türkçe `message` ile raporlanır.
3. Sayaç: `skippedCount`. Önizlemede tek bir agregat `WC_ORDERS_IGNORED` uyarısı
   gösterilir ("N sipariş/müşteri kaydı bulundu; bunlar güvenlik ve kişisel veri
   nedeniyle içe aktarılmaz").
4. `AuditLog` metadata'sına da sipariş içeriği YAZILMAZ — yalnızca adet.

**Audit:** `import.upload` / `import.start` metadata'sında `type: PRODUCTS` +
`defaultCurrency` + `defaultStatus` taşınır. Yazılan her ürün için ayrıca ürün-bazlı
`product.create` audit'i YAZILMAZ (`USERS`'ın aksine) — 5.000 ürünlük bir aktarım
`AuditLog`'u işe yaramaz biçimde şişirirdi; iş kaydının kendisi (sayaçlar + hata
listesi) izlenebilirlik için yeterlidir.

**`Products` modülü KAPALIYSA:** `POST /admin/import/jobs` `type: PRODUCTS` ile
**422** döner (`error.details.type`, mesaj kullanıcıyı Modüller ekranına yönlendirir).
İş oluşturulmaz. Gerekçe: kapalı bir modüle veri yazmak, modül anahtarının anlamını
(§10.9.1) boşa çıkarırdı.

##### 10.8.9.1 Compliance onayı (compliance-agent, 2026-08-10 — KOŞULLU)

**Karar 2F — sipariş/müşteri PII'sinin parser'da hiç materyalize edilmeden düşürülmesi:
ONAYLANDI.** Veri minimizasyonu ilkesi açısından yeterlidir; **mevcut `wxr.parser.ts`
allow-list postmeta deseni korunduğu sürece**. Genel bir `postmeta key → value` Map'ine
REFAKTÖR EDİLMEMELİDİR (backend-agent için bağlayıcı kısıt: böyle bir refaktör, `shop_order`
item'larının `_billing_*`/`_shipping_*` meta'sını belleğe alıp PII'yi materyalize ederdi —
allow-list, PII'nin hiç okunmamasını yapısal olarak garanti eder). Ham WXR dosyasının
normal akışta (`finally` bloğunda) işlem biter bitmez silinmesi yeterlidir.

**BLOKER (implementasyon başlamadan önce giderilmeli — PRODUCTS'ın Definition of Done'a
girmesi buna bağlıdır):** `recoverStuckImportJobs` (çökme/restart kurtarma) ve
`runImportRetentionSweep` (90 günlük iş silme), asılı kalan/süresi dolan işlerin
`storagePath`'ini temizlemiyor — sunucu çökmesi durumunda sipariş PII'si taşıyan ham dosya
süresiz öksüz kalabilir. **Bu, TÜM import tiplerini etkileyen genel bir hatadır**
(`PRODUCTS`'a özgü değildir); her iki fonksiyonda `importStorage.remove` çağrısı +
`storagePath: null` yazımı eklenmelidir. Sahibi: backend-agent (§10.8.8.1'deki retention
maddeleriyle aynı iş paketi).

**Ek notlar (bağlayıcı):**
- Hata loglarına ham XML metni ASLA yazılmaz — yalnızca `{ jobId, code, rowNumber }`.
  (Bu, yukarıdaki "sipariş satırlarında `rawData`/`sourceRef` yazılmaz" kuralının
  observability tarafındaki karşılığıdır; observability-agent da bu kurala tabidir.)
- `WC_ORDERS_IGNORED` önizleme metni kullanıcıya net gösterilir: **"N sipariş/müşteri
  kaydı bulundu; güvenlik ve kişisel veri nedeniyle içe aktarılmadı."**

**Kayıt tavanı — architect hakemliği (çözülmüş çelişki).** compliance-agent, maruz kalma
süresini sınırlamak gerekçesiyle tavanın `WORDPRESS` ile aynı mertebede (10.000 kayıt /
50 MB) tutulmasını önerdi. **Karar: boyut limiti 50 MB olarak KABUL EDİLDİ (zaten öyleydi),
kayıt tavanı ise 5.000'de KALIYOR.** Gerekçe: (1) daha DÜŞÜK tavan, önerinin kendi
gerekçesiyle aynı yöne çalışır — daha az kayıt, daha kısa işleme süresi, ham dosyanın
`finally` bloğunda daha erken silinmesi, yani daha KISA maruz kalma; (2) 5.000 tavanı
kullanıcı tarafından açıkça onaylanmış bir karardır; (3) tavan yalnızca **işlenecek
`product` item'ı** üzerinden sayılır, dosyadaki toplam item sayısı üzerinden değil — yani
`WORDPRESS`'in 10.000'iyle doğrudan kıyaslanabilir bir sayı değildir. Bu madde bir BLOKER
değil "ek not" olarak iletildiğinden implementasyon bu kararla ilerleyebilir;
compliance-agent itiraz ederse konu architect'e yeniden eskale edilir.

#### 10.8.10 Analitik Rapor Dışa Aktarma (Export) — Şema (db-agent — TEK SAHİP)

Durum: v1 · `feature/admin-analytics-v2`'nin ilk (db-agent) adımı. **10.8.11 ile
KARIŞTIRILMAMALI** (o madde bu belgede önceden 10.8.9 numarasını taşıyordu): 10.8.11
admin liste sayfalarının (Kullanıcılar/Blog/Sayfalar) TAMAMEN
istemci taraflı CSV dışa aktarımıyla ilgiliydi ve "YENİ UÇ YOK" sonucuna varmıştı. Bu
madde ise **admin analitik/raporlama** (`/admin/stats/*`) verilerinin CSV/PDF olarak
ASENKRON dışa aktarılmasıyla ilgilidir — veri hacmi (tüm `PageView` satırları, kullanıcı/
gelir raporları) ve PDF üretimi istemci tarafında yapılamayacak kadar ağır olabileceği için
sunucu tarafı bir iş kaydına ihtiyaç var. Endpoint/worker tasarımı backend-agent'ın işi;
burada yalnızca şema tanımlanır.

```prisma
enum ExportJobType    { VIEWS  BREAKDOWN  SUMMARY  TOP_CONTENT  USERS  REVENUE }
enum ExportFileFormat { CSV  PDF }
enum ExportJobStatus  { PENDING  PROCESSING  COMPLETED  FAILED }

model ExportJob {
  id           String            @id @default(uuid())
  seq          Int               @unique @default(autoincrement())   // cursor sayfalama
  type         ExportJobType
  format       ExportFileFormat
  status       ExportJobStatus   @default(PENDING)
  filters      Json              @default("{}")   // tarih aralığı, rol/segment, maskeleme tercihi vb.
  // Gizli depodaki dosya referansı. API'de ASLA DÖNMEZ.
  storagePath  String?
  // Export TÜRÜ (USERS/REVENUE) kişisel veri içeriyorsa true — MASKELENMİŞ olsa dahi. Maskeleme
  // durumu `filters.unmaskPii` + `reports.export.unmasked_pii` audit kaydında izlenir.
  containsPii  Boolean           @default(false)
  createdById  String?
  errorSummary String?
  expiresAt    DateTime?         // indirme linkinin/dosyanın süre sonu (saklama politikası)
  startedAt    DateTime?
  finishedAt   DateTime?
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt

  createdBy User? @relation("ExportJobCreator", fields: [createdById], references: [id], onDelete: SetNull)

  @@index([status])
  @@index([type])
  @@index([createdById])
  @@map("export_jobs")
}
```
`User` tarafına karşı-ilişki alanı: `exportJobs ExportJob[] @relation("ExportJobCreator")`.

- **İşleme deseni** — §10.8.1'deki "Kuyruk YOK, süreç-içi worker + DB durum tablosu"
  kararıyla AYNI (tek instance varsayımı, `onReady` kurtarması vb.); worker
  implementasyonu backend-agent'ındır.
- **`ImportJobError` paterni burada yok**: export satır-satır işlenen bir toplu içe
  aktarma değil, tek seferlik rapor üretimidir (ya bütünüyle biter ya da `errorSummary`
  ile başarısız olur) — bu yüzden ayrı bir `ExportJobError` tablosu eklenmedi.
  `ExportJobStatus` da bu yüzden `ImportJobStatus`'tan daha sade (`QUEUED`/`CANCELLED` yok).
- **`containsPii`**: `USERS`/`REVENUE` gibi türler kişisel veri (e-posta/isim/ödeme
  bağlamı) içerebilir; bu alan compliance-agent'ın §10.8.8 ile aynı desende saklama/erişim
  kararı almasını sağlar — backend-agent worker'da rapor türüne göre bu alanı set eder.
  DİKKAT: bu alan MASKELEME DURUMUNU yansıtmaz (maskeli export'larda da `true`'dur) —
  ham/maskelenmemiş erişim `filters.unmaskPii` + ayrı `reports.export.unmasked_pii`
  audit kaydıyla izlenir (bkz. aşağıdaki compliance-agent kararı).
- **`expiresAt`**: indirilebilir dosyanın/linkin süre sonu; saklama süresi politikası
  aşağıda compliance-agent tarafından karara bağlanmıştır.

##### compliance-agent kararı (2026-08-06, BLOCKER) — Export saklama süresi, PII maskeleme ve audit

`import.retention.ts` üstündeki §10.8.8.1 emsaliyle (30 gün PII redaksiyonu / 90 gün job
saklama) KARŞILAŞTIRILARAK değerlendirildi. Export, import job zarfından FARKLI bir risk
profiline sahiptir: DB satırı değil, doğrudan indirilebilir/kopyalanabilir bir dosya
ARTEFAKTIDIR ve talep üzerine kaynak veriden her an yeniden üretilebilir — bu yüzden import'un
90 günlük "zarf saklama" emsalinden ÇOK daha kısa bir süre uygundur, DAHA UZUN değil.

1. **Kapsam/maskeleme doğrulandı**: `USERS` export'u yalnızca `id/name/email/role/status/
   createdAt/lastLoginAt` döner (gereksiz alan YOK); `email`, `unmaskPii=false` (varsayılan)
   iken worker'da satır satır `maskEmail`'den geçirilir, atlayan bir code path YOK. `REVENUE`
   export'u `Subscription.stripeCustomerId` DÖNMÜYOR (veri minimizasyonuna zaten uygun).
   `AuditLog`/`RefreshToken.ipAddress` HİÇBİR export türüne dahil DEĞİL — `maskIp` şu an
   kullanılmıyor, ileride IP taşıyan bir rapor eklenirse hazır tutuluyor (bkz. pii-mask.ts).
2. **Saklama süresi — FARKLILAŞTIRILDI**: varsayılan (maskeli) export dosyaları **7 gün**
   sonra silinir (`EXPORT_JOB_RETENTION_MS`) — import'un 90 günlük emsalinden kasıtlı olarak
   çok daha kısa, çünkü export bir türev/yeniden-üretilebilir çıktıdır. `unmaskPii: true` ile
   üretilen (ham e-posta içeren) dosyalar İÇİN AYRI ve DAHA KISA bir süre eklendi: **48 saat**
   (`EXPORT_JOB_RETENTION_UNMASKED_MS`) — "progressive redaction" ilkesiyle (§10.8.8.1) TUTARLI:
   ham PII'nin erişilebilir kaldığı pencere minimize edilir.
3. **Audit iz sürülebilirliği — güçlendirildi**: `reports.export.unmasked_pii` audit kaydı
   artık KENDİ İÇİNDE yeterli (`actorId`/`actorEmail`/`ipAddress` + `metadata: {type, format,
   from, to}`) — bir soruşturma senaryosunda `reports.export.create` ile AYRICA join
   gerektirmeden "kim, ne zaman, hangi rapor türü, hangi tarih aralığı için ham PII talep
   etti" sorusuna tek kayıttan cevap verir. `reports.export.download` audit kaydı da
   `containsPii` metadata'sını taşır (indirilen dosyanın PII-bearing türde olduğu ayrıca
   görülebilir).
4. **Scheduler doğrulandı**: `registerExportRetentionScheduler` `app.ts`'e bağlı, `onClose`
   ile temizleniyor, `import.retention.ts` ile AYNI desen — ek bir eylem gerekmedi.

Bu karar hukuki tavsiye DEĞİLDİR — KVKK/GDPR ilkelerinin teknik gereksinime çevrilmiş
hâlidir; nihai hukuki onay için gerçek bir hukuk danışmanına başvurulmalıdır.

##### PageView performans indeksi (bu adımın ikinci parçası)

`/admin/stats/*` uçlarının tamamı `WHERE date >= :since` ile başlayıp `deviceType`/
`country`'ye yalnızca `GROUP BY`'da (WHERE'de değil) dokunuyor (bkz.
`stats.routes.ts`). Mevcut `@@unique([pageId, date, deviceType, country])` /
`@@unique([postId, date, deviceType, country])` indekslerinin leading kolonu
`pageId`/`postId` olduğu için bu sorgu paterninde kullanılamıyor (seq scan). Eklenen
`@@index([date])` bunu çözüyor; `deviceType` WHERE'de filtrelenmediği için composite
`[date, deviceType]` indeksi gereksiz ek yazma maliyeti getirirdi, eklenmedi.

#### 10.8.11 Dışa aktarma (bonus madde) — YENİ UÇ YOK

> **Numara notu (mimar):** Bu bölüm önceden §10.8.9 idi; §10.8.9 numarası WooCommerce
> (`PRODUCTS`) eşleştirmesine verildi ve bu madde 10.8.11'e taşındı. §10.8.10 (Analitik
> Rapor Export) numarası **bilinçli olarak DEĞİŞTİRİLMEDİ** — kod tabanında ~35 yerde
> (`reports.*`, `stats.*`, `export-storage.ts`, testler) referans veriliyor ve
> yeniden numaralandırmak bu izleri kırardı.

Mevcut `frontend/src/lib/export-csv.ts::exportToCsv` **doğru çalışıyor** (BOM'lu UTF-8,
tırnak kaçışı, gömülü `,`/`"`/`\n` işleniyor) ve sunucu ucuna gerek yok: admin listeleri
zaten tüm kayıtları belleğe çekiyor.

**ANCAK doğrulamada gerçek bir hata bulundu (frontend-agent düzeltir):**
`frontend/src/app/admin/users/page.tsx:84` `listAdminUsers()` fonksiyonunu **cursor
döngüsü olmadan bir kez** çağırıyor (`limit: 100`). Yani "Dışa Aktar", 100'den fazla
kullanıcı olduğunda **sessizce ilk 100'ü** dışa aktarıyor ve kullanıcı eksik veri aldığını
fark etmiyor. `components/admin/content-list/use-content-list.ts:87-106` bu döngüyü DOĞRU
yapıyor; kullanıcılar sayfası aynı deseni uygulamalıdır.

Sayfalar/Blog dışa aktarma durumu: Blog'da yalnızca "seçilenleri dışa aktar" var
(`admin/blog/page.tsx:46`), Sayfalar'da **hiç yok**. İkisi de ortak `content-list`
bileşenini kullandığı için dışa aktarma ORTAK bileşene taşınır (kopyalanmaz) ve her
ikisinde "Tümünü" + "Seçilenleri" olarak sunulur. Sütunlar: Başlık, Slug, Durum, Yazar,
Kategori (yalnızca blog), Görüntülenme, Yayın Tarihi, Son Güncelleme.

### 10.9 Eklenti/Modül Yönetimi + Site Şablonu (Products/Portfolio/Cart/Checkout/Orders)

Durum: v1 · Sahibi: Mimar. Bağlayıcı kaynak: `openapi.yaml` (tag `Modules`/`Products`/
`Portfolio`/`Cart`/`Checkout`/`Orders`/`Settings`). `feature/modules-system` dalında
Faz 1–4 olarak uygulandı: (1) modül registry/toggle mekanizması, (2) Ürünler modülü,
(2b) Sepet + Stripe Checkout + Siparişler, (3) Portföy modülü, (4) Site Şablonu +
page-builder genişletmesi.

#### 10.9.1 Modül sistemi tasarımı — statik kod-registry + DB-only durum

**İki katman kasıtlı olarak ayrılmıştır:**

- **Tanım (kod, salt-okunur):** `backend/src/lib/module-registry.ts::MODULE_REGISTRY`
  — hangi modüllerin sistemde VAR olduğu, `label`/`description`/`defaultEnabled`/
  `adminPath`/`recommendedFor`. `lib/permissions-matrix.ts` ile AYNI paternde: kod
  değişmeden yeni bir modül "keşfedilemez", yeni modül eklemek her zaman bir kod
  değişikliğidir (migration DEĞİL).
- **Durum (DB, tek gerçek):** `SiteModule` tablosu yalnızca `enabled` + kim/ne zaman
  değiştirdiğini tutar. Satır YOKSA (hiç toggle edilmemiş) `defaultEnabled` fallback
  olur — `settings.routes.ts::DEFAULTS` ile AYNI lazy-upsert paterni (`lib/
  module-state.ts::isModuleEnabled`). Seed ZORUNLU değildir.

`GET /admin/modules` bu iki katmanı LEFT JOIN mantığıyla birleştirir
(`toSiteModuleDto`); `PATCH /admin/modules/{key}` yalnızca DURUM'u değiştirir, TANIMI
DEĞİL.

**Neden 404, neden 403 değil:** `middleware/module-guard.ts::requireModuleEnabled(key)`
public route'larda bir modül kapalıyken (veya hiç tanımlı değilken) `NotFoundError`
(404) fırlatır — `ForbiddenError` (403) BİLİNÇLİ olarak kullanılmaz. 403, "bu kaynak
var ama erişimin engellendi" der; bu da bir dış gözlemciye (ör. rakip, otomatik
tarayıcı) sitenin hangi modülleri kurulu-ama-kapalı tuttuğunu sızdırır. 404 ile kapalı
bir modülün var olup olmadığı ayırt edilemez — açık bir güvenlik/bilgi sızıntısı
kararıdır.

**Neden admin route'lar hiç guard'lanmıyor:** `/admin/products*`, `/admin/portfolio*`,
`/admin/orders*` `requireModuleEnabled` HİÇ kullanmaz — modül kapatılsa dahi admin
tam CRUD'a erişebilir. Gerekçe veri korunumudur: bir modülü geçici kapatmak (ör.
stok tükendi, kampanya bitti) mevcut ürün/sipariş verisini "kilitleyip" adminin
düzenleme/görüntüleme yeteneğini kaybetmesine YOL AÇMAMALIDIR. Yalnızca *public*
görünürlük kapanır. Bu, `app.ts`'teki `§10.9.2`/`§10.9.3`/`§10.9.4` yorumlarında
açıkça işaretlenmiştir.

`GET /modules` (public, dar DTO — yalnızca `key`/`enabled`) site header/nav'ının
hangi menü öğelerini göstereceğine karar vermesi içindir; `label`/`description`/
`updatedBy` TAŞIMAZ (yönetim ekranına özgü bilgi).

#### 10.9.2 Ürünler Modülü — content model pattern'i

`Product`/`ProductCategory`, `Page`/`BlogPost` (§10.7) ile **BİREBİR AYNI** içerik
modeli paternini izler:

- Çöp kutusu (`deletedAt`), yazar (`authorId`/`author`, §10.7 kuralı: verilmezse
  giriş yapan kullanıcı, başkasını atamak yalnızca ADMIN), SEO skoru (`seoScore`/
  `seoScoreIssues`, aynı 5-kriter algoritması), çoklu dil (`translations`, §10.5),
  zamanlanmış yayın (`scheduledAt`, Faz 4 sweeper'ı BlogPost/Page ile PAYLAŞILIR),
  sekme sayaçları (`meta.counts`) ve içerik revizyonu (`ContentRevision`,
  `entityType: PRODUCT`) BİREBİR aynı kod yollarını (`snapshotBeforeUpdate`,
  `resolveAuthorId`, `sanitizeRichHtml`, `getProductContentCounts`) kullanır.
- Üstüne yalnızca e-ticarete özgü alanlar eklenir: `priceCents`/`currency` (HER ZAMAN
  kuruş cinsinden `Int`, float KESİNLİKLE yok), `taxRatePercent` (fiyata DAHİL, salt
  fatura ayrıştırması için), `discountPriceCents` (nullable, doluysa `priceCents`'ten
  küçük olmalı — hem Zod `refine` hem route-handler çapraz kontrolü, bkz.
  `products.routes.ts::assertDiscountBelowPrice`), `sku` (unique), `stockQuantity`.
- **~~Bilinen eksik~~ → GİDERİLDİ (mimar kararı):** `snapshotBeforeUpdate` her
  `PATCH`'te `Product`/`PortfolioItem` için de `ContentRevision` yazıyordu ama bunları
  LİSTELEYEN/GERİ YÜKLEYEN uç YOKTU — kayıtlar sessizce birikiyordu. Artık
  `ContentRevisions` tag'i dört entity'yi de kapsar; ayrıca autosave ve toplu işlem
  uçları da eklenmiştir. **Bağlayıcı tanım §10.1'deki parite tablosudur** (uç listesi,
  `snapshot` alan setleri, `Product` geri yüklemesindeki 422 çapraz-alan dalı, toplu
  işlemin ortak helper'a çıkarılması). Revizyon tavanı (`MAX_REVISIONS_PER_ENTITY`)
  değişmez.

**Media ilişki paterni — neden gerçek FK, neden Page/BlogPost'tan FARKLI:**
`Page`/`BlogPost` kapak görselini eski bir `coverImageUrl: String?` (serbest metin
URL) alanıyla tutar — herhangi bir string kabul eder, `Media` tablosuyla ilişkisi
YOKTUR. `Product`/`PortfolioItem` bunun yerine gerçek bir FK kullanır:
`coverMediaId String?` + `coverMedia Media? @relation(..., onDelete: SetNull)`, ve
ayrıca sıralı bir galeri join tablosu (`ProductImage`/`PortfolioImage`,
`@@unique([productId, mediaId])`, `onDelete: Cascade`). Gerekçe:

1. **Bütünlük:** e-ticaret ürün kartı/detayında kapak görseli ÇOK daha kritik bir
   UI elemanıdır (dönüşüm oranını doğrudan etkiler) — serbest metin URL'de yazım
   hatası/kırık link riski, gerçek FK ile İMKANSIZDIR (referans bütünlüğü DB
   seviyesinde garanti edilir).
2. **Galeri ihtiyacı:** ürün/portföy detay sayfaları çoklu görsel (galeri/karusel)
   gösterir — `BlogPost`'ta bu ihtiyaç hiç yoktu (`contentHtml` içine gömülü `<img>`
   yeterliydi), `Product`/`PortfolioItem`'da ayrı, SIRALANABİLİR bir koleksiyon
   gerekiyordu.
3. **`Media` silme davranışı korunur:** `coverMediaId` `onDelete: SetNull` — bir
   görsel `/admin/media`'dan silinirse ürün KIRILMAZ, yalnızca kapaksız kalır (`Page`/
   `BlogPost`'un serbest URL'i zaten bu sorunu YAŞAMAZDI ama referans bütünlüğü de
   HİÇ SAĞLAMAZDI).
- **Galeri yönetimi — ayrı yazma uçları:** `coverMediaId`, `POST`/`PATCH
  /admin/{products,portfolio}` gövdelerinde set edilirken, galeri (`images[]`)
  KENDİ ayrı uçlarından yönetilir — `admin/media` ile AYNI RBAC eşiği (`ADMIN`/
  `EDITOR`): `POST /admin/products/{productId}/images` (`{ mediaId }` body)
  `ProductImage` satırı ekler, mevcut en yüksek `order`'ın bir fazlasına
  (galerinin SONUNA) yazılır; aynı `mediaId` zaten galerideyse (`@@unique([productId,
  mediaId])`) `409 CONFLICT`. `DELETE /admin/products/{productId}/images/{imageId}`
  satırı kaldırır — `imageId`'nin GERÇEKTEN o `productId`'ye ait olduğu route
  handler'da doğrulanır (**IDOR koruması**: başka bir ürünün galeri satırı id'si
  verilse `404 NOT_FOUND`, `Media`'nın kendisi silinmez, yalnızca ilişki satırı
  silinir). `PortfolioItem` için (§10.9.4) birebir eşdeğer uçlar (`/admin/portfolio/
  {itemId}/images`, `@@unique([portfolioItemId, mediaId])`) vardır. Sıralama
  (drag-drop reorder) ucu bu fazda hâlâ YOKTUR — yalnızca ekleme/kaldırma
  desteklenir, mevcut sıra korunur.

#### 10.9.3 Sepet + Stripe Checkout + Siparişler

**Guest cart — opak token + `sameSite: lax`:** Sepet, kimlik doğrulaması
GEREKTİRMEZ. `POST /cart/items` sepeti "lazy" oluşturur: 32 baytlık rastgele bir
token üretilir (`lib/tokens.ts::generateOpaqueToken`), SHA-256 hash'i `Cart.tokenHash`
alanına yazılır (ham değer DB'ye ASLA gitmez — refresh token'larla AYNI desen), ham
token `httpOnly`/`secure` (yalnızca prod)/`sameSite: lax`/`path: /`/30 gün bir çerezle
(`cart_token`) istemciye döner. `sameSite`, `REFRESH_COOKIE`'nin (`strict`) AKSİNE
BİLİNÇLİ olarak `lax` seçilmiştir: kullanıcı ödeme için Stripe'ın domain'ine
yönlendirilir ve ödeme sonrası `success_url`/`cancel_url` ile bizim domain'imize GERİ
DÖNER — bu bir **cross-site top-level navigasyondur** (Stripe → bizim site). `strict`
bu durumda çerezi taşımaz (tarayıcı farklı origin'den gelen navigasyonda strict
çerezi göndermez), sepet token'ı kaybolur ve kullanıcı "sipariş onaylandı" ekranında
sepetini/siparişini göremez. `lax`, GET tabanlı top-level navigasyonlarda çerezi
taşırken CSRF açısından hâlâ makul bir varsayılan sağlar (bkz. MDN `SameSite=Lax`).
Terk edilmiş sepetler `lib/cart-retention.ts::registerCartRetentionSweeper` ile
dakikalık, süreç-içi bir sweeper tarafından SESSİZCE silinir (`expiresAt < now()`,
bildirim YOK — e-ticaret sitelerinde standart davranış, `import.retention.ts`/
`scheduled-publish.ts` ile AYNI "gerçek zaman-tetiklemeli, kuyruk YOK" deseni).

**Stripe entegrasyonu — neden `price_data`, mevcut abonelik akışından FARKI:**
Mevcut org abonelik akışı (`billing.service.ts::createCheckoutSession`) Stripe
Dashboard'da ÖNCEDEN TANIMLI bir `Price` ID'si kullanır (`stripePriceIdMonthly`/
`stripePriceIdYearly`, `line_items: [{ price: priceId, quantity }]`) — planlar
sabit/az sayıda olduğu için bu pratiktir. `checkout.routes.ts` bunun YERİNE HER ZAMAN
`price_data` ile DİNAMİK fiyat gönderir (`line_items: [{ price_data: { currency,
unit_amount, product_data: { name } }, quantity }]`) ve önceden tanımlı bir `Price`
ID'si ASLA kullanmaz. Gerekçe: ürün kataloğu/fiyatları TAMAMEN bizim DB'mizde
(`Product.priceCents`) yönetilir, admin bir ürünü saniyeler içinde ekleyip
fiyatlandırabilir — bunun için Stripe Dashboard'da karşılık gelen bir `Price` nesnesi
ÖNCEDEN/EŞ ZAMANLI oluşturmak (ve senkron tutmak) gereksiz bir entegrasyon yüküdür.
`price_data` Stripe'a "bu oturuma özel, tek seferlik" bir fiyat tanımlar — kalıcı bir
Stripe nesnesi YARATMAZ.

**Sipariş oluşturma — fiyat/stok istemciden ASLA kabul edilmez:** `POST
/checkout/session` sepetteki DONDURULMUŞ fiyatlara (`CartItem.unitPriceCents`)
GÜVENMEZ — her satır, `Order`/`OrderItem` oluşturulmadan hemen önce `Product`
tablosundan TAZE okunur (yayında mı, çöpte mi, stok yeterli mi). Doğrulama geçerse
`status: PENDING` bir `Order` + SNAPSHOT `OrderItem`ler (`productTitle`/`productSku`/
`unitPriceCents` — ürün sonradan silinse/değişse bile sipariş geçmişi BOZULMAZ)
yazılır, ardından Stripe Checkout Session açılır.

**Webhook idempotency — çift savunma:** `POST /webhooks/stripe` ham (parse edilmemiş)
body üzerinde imza doğrular (`stripe.webhooks.constructEvent`). Stripe AYNI event'i
birden fazla kez gönderebileceği için (ağ hatası/retry) `handleOrderPaid`
(`modules/webhooks/stripe.routes.ts`) İKİ katmanlı savunma uygular:

1. **Durum kontrolü:** `order.status !== "PENDING"` ise sessizce döner — stok TEKRAR
   düşürülmez, e-posta TEKRAR gönderilmez.
2. **Unique constraint:** `Order.stripeCheckoutSessionId @unique` — aynı Checkout
   Session'ın farklı bir `Order`'a ikinci kez bağlanması DB seviyesinde engellenir.

Bu iki savunma birbirinin YEDEĞİDİR, tek başına HİÇBİRİ yeterli kabul edilmez
(uygulama mantığı hatası + DB constraint'i çakışan senaryoları BAĞIMSIZ olarak
kapatır).

**Stok concurrency — `runSerializable<T>()`:** `backend/src/lib/serializable-tx.ts`
Postgres **Serializable** izolasyon seviyesinde `$transaction` çalıştırıp, çakışan
eşzamanlı transaction'lardan biri Postgres tarafından `P2034` (write conflict) ile
reddedilirse otomatik olarak (en fazla 3 kez) retry eden genel bir yardımcıdır.
Aslen `admin-users.routes.ts::assertNotLastActiveAdmin`in "check-then-act" (TOCTOU)
race'ini kapatmak için yazıldı; `handleOrderPaid` bunu şu ATOMIK bloğu tek
transaction'da yürütmek için KULLANIR: (a) `Order` + stok kontrolü OKU, (b) yetersizse
`status: FAILED, errorSummary: "insufficient_stock"` yaz ve BAŞARIYLA bitir (throw
ETME — para zaten Stripe üzerinden alınmış, bu bir hata değil bir iş sonucudur), (c)
yeterliyse HER `OrderItem` için `Product.stockQuantity` düş + `Order.status = PAID`.
Serializable izolasyon, aynı ürünün SON adedine yarışan iki eşzamanlı webhook
çağrısında bir siparişin `PAID`, diğerinin (retry sonrası taze stok okumasıyla)
`FAILED` olmasını GARANTİ eder — `tests/integration/webhook-order.test.ts` bunu bir
eşzamanlılık testiyle doğrular. Adminin `PATCH /admin/products/{id}/stock` ile ELLE
stok düzeltmesi bu mekanizmayı KULLANMAZ (basit doğrudan `UPDATE`) — kasıtlı olarak
ayrı tutulur, tek kullanıcılı bir admin işlemidir, race riski yoktur.

**Sipariş durumu — kısıtlı geçiş kümesi:** `PATCH /admin/orders/{orderId}/status`
yalnızca `PAID -> FULFILLED` ve `PENDING -> CANCELLED` geçişlerine izin verir; başka
HER kombinasyon `409 CONFLICT`. `-> REFUNDED` bu uçtan HEDEF DURUM OLARAK KABUL
EDİLMEZ — iade AYRI bir uçtan yapılır (aşağıda). `customerEmail` liste ucunda
maskelenir (`lib/pii-mask.ts::maskEmail`), detay ucunda maskesiz döner — gerekçe uç
açıklamalarında ve `openapi.yaml`'da detaylıdır.

**Manuel iade — `POST /admin/orders/{orderId}/refund`:** yalnızca ADMIN, yalnızca
`PAID`/`FULFILLED` durumundaki siparişlerde çalışır (`REFUNDABLE_STATUSES`, bkz.
`orders.routes.ts`) — başka bir durumdaysa VEYA `Order.stripePaymentIntentId` yoksa
`409 CONFLICT`. Stripe Dashboard üzerinden elle iade edip `Order.status`'u DB'de
senkronsuz bırakan eski yaklaşımın YERİNE geçti: `stripe.refunds.create`
(`stripePaymentIntentId` üzerinden) ile **gerçek parayı Stripe üzerinden geri öder**
— yalnızca DB durumunu değiştiren "sahte" bir iade DEĞİLDİR.

- **Çifte iade / race koruması — atomik "claim" deseni:** iki eşzamanlı `POST
  /refund` isteğinin İKİSİNİN DE Stripe'a gerçek iade göndermesini önlemek için,
  durum geçişi ÖNCE `updateMany({ where: { id, status: { in: [PAID, FULFILLED] } },
  data: { status: "REFUNDED" } })` ile ATOMİK olarak "claim" edilir — standart satır
  kilidi semantiği sayesinde aynı satıra eşzamanlı gelen ikinci `UPDATE`, birincinin
  commit'ini bekler ve `WHERE`'i YENİDEN değerlendirir. `claim.count === 0` ise
  sipariş durumu zaten değişmiş demektir → `409 CONFLICT`, Stripe'a HİÇ gidilmez.
  Yalnızca claim'i KAZANAN istek Stripe çağrısını yapar. (Faz 2b'deki
  `runSerializable` — bkz. §10.9.3 "stok concurrency" — burada GEREKLİ DEĞİLDİR: o,
  çok tabloyu/satırı kapsayan çok adımlı okuma+yazmalar içindir; burada tek satırlık
  koşullu `UPDATE` yeterlidir ve dış bir ağ çağrısını [Stripe] bir DB transaction'ı
  içinde tutmaktan bilinçli olarak kaçınılır.)
- **Idempotency key:** `stripe.refunds.create`'e siparişe göre DETERMİNİSTİK bir
  `idempotencyKey` (`order-refund-{orderId}`) verilir — ağ hatası/timeout sonrası bir
  retry (istemci veya Stripe SDK'sının kendi iç retry mekanizması) AYNI Stripe iade
  kaydını döner, ikinci bir gerçek para hareketi TETİKLEMEZ.
- **Başarısız Stripe çağrısı — claim geri alınır:** `stripe.refunds.create` hata
  fırlatırsa (`Stripe.errors.StripeError`), az önce kazanılan claim GERİ ALINIR
  (`Order.status` eski değerine `UPDATE` edilir) ve `409 CONFLICT` (Stripe'ın hata
  mesajıyla) döner — sipariş yeniden iade edilebilir kalır, "hayalet" bir
  `REFUNDED` durumunda TAKILI KALMAZ.
- **Başarı:** `Order.status = REFUNDED`, audit log `order.refund` (`metadata: {
  from, to, reason, stripeRefundId }`) yazılır. `reason` (opsiyonel, max 500 karakter,
  `RefundOrderRequestSchema`) yalnızca audit/Stripe kaydı için bilgi amaçlıdır.

`OrderStatus` enum'ındaki `REFUNDED` değeri artık bu uçtan FİİLEN ulaşılabilir bir
hedef durumdur (önceki fazda yalnızca Stripe Dashboard'un elle üretebileceği,
uçlardan erişilemeyen bir değer olarak AYRILMIŞTI).

#### 10.9.4 Portföy Modülü

`PortfolioItem`/`PortfolioCategory`, `Product`/`ProductCategory`'nin (§10.9.2)
**BİREBİR aynı paternidir** — aynı çöp kutusu/yazar/SEO skoru/çoklu dil/zamanlanmış
yayın alan seti, aynı `ContentRevision` (`entityType: PORTFOLIO_ITEM`, yine yalnızca
YAZILIR — listeleme/geri yükleme ucu YOK, bkz. §10.9.2 "bilinen eksik") ve aynı
`coverMediaId`/galeri (`PortfolioImage`, kendi `POST`/`DELETE .../images` uçları ile
yönetilir — `ProductImage` ile BİREBİR AYNI ekleme/duplicate/IDOR davranışı, bkz.
§10.9.2 "galeri yönetimi") media ilişki paterni. Tek fark
ticari alanlar (`priceCents`/`currency`/`discountPriceCents`/`sku`/`stockQuantity`)
yerine portföye özgü alanlardır: `clientName` (nullable), `projectUrl` (nullable,
URL doğrulamalı), `completedAt` (nullable tarih) ve **manuel `order`** (kullanıcının
sürükle-bırak ile belirlediği sıralama — `seq`/`viewCount` ile KARIŞTIRILMAMALIDIR;
`Product`'ın public listesi `seq asc` sıralanırken, `PortfolioItem`'ın public listesi
BİLİNÇLİ olarak `order asc` sıralanır, çünkü bir portföyde "en son eklenen" değil
"kullanıcının seçtiği vitrin sırası" önemlidir).

#### 10.9.5 Site Şablonu — SADECE öneri, otomatik davranış YOK

`SiteSettings.siteTemplate` (`SHOWCASE` | `COMMERCE` | `PORTFOLIO`, varsayılan
`SHOWCASE`) ve `SiteModule.recommendedFor` (`ModuleDefinition.recommendedFor`, kod içi
statik) **HİÇBİR modülü otomatik açmaz/kapatmaz ve HİÇBİR veriyi değiştirmez.**
Backend bu alanları yalnızca DEPOLAR/TAŞIR — okuma/yazma dışında hiçbir iş mantığı
UYGULAMAZ. Tek tüketicisi frontend'in kurulum sihirbazıdır: `siteTemplate: COMMERCE`
seçildiğinde sihirbaz "Ürünler modülünü etkinleştirmek ister misiniz?" gibi bir ÖNERİ
gösterebilir, ama nihai `PATCH /admin/modules/{key}` çağrısı HER ZAMAN ayrı, admin'in
bilinçli onayıyla yapılan bir işlemdir. Bu ayrım kasıtlıdır: bir ayar alanını
değiştirmenin sessizce başka bir alt sistemi (modül durumu) tetiklemesi şaşırtıcı
(surprising) bir yan etkidir — iki kavram API sözleşmesinde de (`PATCH
/admin/settings` vs `PATCH /admin/modules/{key}`) fiziksel olarak AYRI uçlardır.

#### 10.9.6 Page-builder blok genişletmesi — yeni tema sistemi İCAT EDİLMEDİ

Ürün/portföy öne çıkarma ihtiyacı (ör. anasayfada "Öne Çıkan Ürünler" bölümü), Faz 1–3
İçerik Editörü'nde (§10.7 öncesi) kurulmuş MEVCUT page-builder blok altyapısına iki
yeni blok TÜRÜ eklenerek karşılandı: `featured-products` ve `featured-portfolio`
(`frontend/src/lib/page-builder/registry.ts::blockRegistry`,
`frontend/src/components/site/blocks/index.tsx`). **Backend'de bu blok türleri için
HİÇBİR şema değişikliği YOKTUR** — `Page.blocks` zaten serbest biçimli bir
`Json`/`z.array(z.record(z.unknown()))` alanıdır (bkz. `openapi.yaml#/components/
schemas/Page.blocks`); yeni blok türü eklemek, mevcut `hero`/`text`/`image`/`gallery`/
`cta` bloklarıyla AYNI mekanizmayı (frontend registry + render bileşeni) kullanır,
YENİ bir "tema"/"layout sistemi" kavramı İCAT EDİLMEDİ. Blok verisi (`{ heading,
limit }`) render anında ilgili public listeleme ucundan (`GET /products` veya `GET
/portfolio`, `limit` parametresiyle) beslenir — blok içine ürün/portföy KOPYALANMAZ,
her render'da GÜNCEL veri çekilir.

### 10.10 Navigasyon Menü Düzenleyicisi (WordPress-tarzı, hiyerarşik)

Admin `/admin/navigation` sayfası iki sekmeye ayrılır — **"Menüleri Düzenle"** (menü
öğeleri + içerikten ekleme panelleri) ve **"Konumları Yönet"** (Logo/Marka, Header CTA,
Footer alanları). Menü öğeleri sürükle-bırakla **iç içe geçirilebilir** hale gelir.
Aşağıdaki kararlar bağlayıcıdır; backend-agent/frontend-agent tahmin YÜRÜTMEZ.

#### 10.10.1 Veri modeli — düz dizi + `parentId` (nested JSON DEĞİL)

`NavigationItem`'a nullable `parentId` + self-relation (`NavigationItemHierarchy`,
`onDelete: Cascade`) ve `@@index([parentId])` eklendi (bkz. `schema.prisma`). Hem API
payload'ı hem DB **düz (flat) bir liste**tir; ağaç `parentId` ile kurulur. İç içe JSON
ağacı REDDEDİLDİ çünkü: (1) DB'ye zaten satır bazında yazılıyor, ağaç yazma anında
düzleştirilmek zorunda; (2) dnd-kit'in "nested sortable" paterni de düz liste + `depth`
üzerinden çalışır, ağaç↔düz dönüşümü her sürüklemede gereksiz maliyet ve hata kaynağı;
(3) kısmi güncelleme/validasyon (per-item hata mesajı) düz dizide çok daha basit.

**Maksimum derinlik = 2 (kök + bir alt seviye).** Kural şu tek cümleye indirgenmiştir:
*`parentId` dolu olan bir öğe, YALNIZCA `parentId`'si null olan bir öğeyi işaret edebilir.*
Bunun üç faydası var: (a) doğrulama özyineleme/graf gezintisi gerektirmez, O(n) tek geçiş;
(b) döngü (cycle) ve kendine referans **yapısal olarak imkânsız** — çünkü bir öğe kendini
işaret ederse `parentId`'si dolu olur ve artık kök olmadığı için hedef geçersizleşir;
(c) site header'ı zaten tam olarak iki seviye (kök + dropdown) render ediyor — daha derin
veri kullanıcının oluşturup ASLA göremeyeceği "hayalet" öğeler üretirdi. Derinliği 3'e
çıkarmak istenirse önce kontrat (openapi.yaml), sonra header renderer güncellenir; DB
şemasında bir değişiklik gerekmez. Derinlik **DB'de zorlanmaz** (Postgres CHECK başka
satıra bakamaz), API validasyon katmanında zorlanır — tek yazma yolu `PUT /admin/navigation`
olduğu için bu yeterlidir.

`order` alanı artık **kardeş-kapsamlıdır**: aynı `parentId` grubu içinde 0'dan artar,
global bir indeks DEĞİLDİR. Global pre-order indeksi reddedildi çünkü "çocukların
indeksleri ebeveynin indeksi ile bir sonraki kardeşin indeksi arasında olmalı" gibi
DB'nin zorlayamayacağı gizli bir değişmez (invariant) yaratırdı; herhangi bir istemci
hatası ağacı sessizce bozardı. Okuma tarafında sunucu `(parentId NULLS FIRST, order)`
sıralaması döner — böylece kök öğeler her zaman alt öğelerden önce gelir ve tüketici
tek geçişte ağacı kurabilir. Okuma tarafında bağlayıcı sorgu (backend-agent tahmin
yürütmesin; `nulls` sıralaması Prisma 4.16'dan beri GA, projede Prisma 5.19 — preview
flag GEREKMEZ):

```ts
app.prisma.navigationItem.findMany({
  orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { order: "asc" }],
});
```

**Toplam öğe limiti 20'de KALIYOR** (`.max(20)`). Bu limit tüm seviyelerin toplamıdır;
nesting öğe sayısını değil yalnızca hiyerarşik dağılımını değiştirir, dolayısıyla
limiti artırmak için bir gerekçe yok.

#### 10.10.2 İstemci tarafında ID üretimi — ONAYLANDI

Frontend'in `crypto.randomUUID()` ile ürettiği id, `NavigationItem.id` olarak **aynen
yazılır** (Prisma `createMany` açık `id` kabul eder). Böylece bir alt öğenin `parentId`'si
aynı payload içindeki gerçek id'yi işaret eder ve "geçici id → kalıcı id" eşleme tablosu
kurma ihtiyacı ortadan kalkar. Sözleşmede `id` **opsiyoneldir** (geriye dönük uyumluluk:
verilmezse sunucu üretir), ancak **bir `parentId` tarafından işaret edilen öğede
zorunludur**. `id` UUID formatında olmalı ve payload içinde benzersiz olmalıdır (aksi
halde 422). `socialLinks`/`footerColumns` bu istisnanın DIŞINDADIR — onlarda id istemciden
gelmez, çünkü orada çözülecek bir iç-referans yok.

**Hakemlik — ui-designer'ın `parentIndex` önerisi (design-notes "Karar 0") REDDEDİLDİ.**
ui-designer, mevcut kontratın istemciden `id` almadığını doğru tespit edip ebeveyni "aynı
dizideki index" ile göstermeyi önerdi. Gerekçeli ret: (1) index **konumsaldır** — diziye
bir öğe eklendiğinde/silindiğinde/yeniden sıralandığında TÜM referansların yeniden
haritalanması gerekir; tek bir off-by-one hatası bir öğeyi sessizce yanlış ebeveyne
bağlar ve bu hata validasyondan geçer (index hâlâ "geçerli"dir). (2) DB zaten `parentId`
tutmak zorunda olduğu için sunucunun yazma anında index→id çevirisi yapması gerekir —
gereksiz bir dönüşüm katmanı. (3) GET yanıtı `parentIndex` ifade edemez (index yalnızca
o isteğe özgüdür), bu da request ve response şekillerini asimetrik yapar — sözleşmenin
tek doğruluk kaynağı olma niteliğini zayıflatır. İstemcide zaten kararlı UUID (`localId`)
var; onu doğrudan `id` yapmak hem daha basit hem daha güvenli. ui-designer'ın diğer tüm
kararları (özellikle maksimum derinlik 2 — bağımsız olarak aynı sonuca varmış) geçerlidir.

#### 10.10.3 Self-referencing bulk insert sırası — KARAR: topolojik sıralama (seçenek c)

`PUT /admin/navigation` tam-replace deseni (`deleteMany({})` + `createMany(...)`, tek
transaction) **KORUNUR**. `parentId` eklenince ortaya çıkan risk, `createMany` içindeki
bir alt öğe satırının kendi üst öğesinden önce yazılması hâlinde FK ihlali almaktır.
Karar: **istemciden gelen düz liste, insert'ten önce sunucuda kök-öğeler-önce olacak
şekilde sıralanır.** Derinlik 2 olduğu için bu genel bir topolojik sıralamaya değil,
**kararlı (stable) iki-parçalı bölmeye** indirgenir:

```
const roots    = items.filter((i) => i.parentId == null);
const children = items.filter((i) => i.parentId != null);
await tx.navigationItem.createMany({ data: [...roots, ...children] });
```

Gerekçe ve diğer seçeneklerin reddi:

- **(a) `DEFERRABLE INITIALLY DEFERRED` FK — REDDEDİLDİ.** Prisma bu niteliği şema
  dilinde ifade edemez; yalnızca migration'a elle raw SQL (`ALTER TABLE ... DROP
  CONSTRAINT ... ADD CONSTRAINT ... DEFERRABLE INITIALLY DEFERRED`) yazılarak eklenebilir.
  Sonraki `prisma migrate dev` çalıştırmalarında Prisma bu niteliği introspection'da
  görmediği için **şema kayması (drift)** üretir ve kısıt sessizce eski hâline dönebilir.
  Tek bir endpoint'in yazma sırasını düzeltmek için tüm migration hattına kalıcı bir
  kırılganlık eklemeye değmez.
- **(b) İki geçişli insert (`parentId: null` ile yaz → sonra update) — REDDEDİLDİ.**
  Doğru çalışır ama her kayıtta N adet ek UPDATE (veya `updateMany` döngüsü) demektir;
  ayrıca DB'de kısa süreliğine **anlamsız bir ara durum** (tüm öğeler kök) oluşturur.
  Transaction içinde bu dışarıdan görünmez, fakat gereksiz karmaşıklıktır.
- **(c) Sıralama — SEÇİLDİ.** Ek sorgu yok, migration'a dokunmuyor, DB-agnostik, tek
  transaction korunuyor ve okunduğunda niyeti kendi kendini açıklıyor.

**Not (backend-agent bunu güvenlik ağı sayabilir ama BUNA GÜVENMEMELİDİR):** PostgreSQL'de
FK doğrulaması bir AFTER ROW trigger'ıdır ve `NOT DEFERRABLE INITIALLY IMMEDIATE` bile
olsa kuyruğa alınıp **ifade (statement) sonunda** çalışır. Prisma `createMany`'yi tek bir
çok-satırlı `INSERT ... VALUES (...), (...)` ifadesine çevirdiği sürece satır sırası
teknik olarak önemsizdir. Ancak Prisma, parametre sayısı sürücü limitine yaklaştığında
`createMany`'yi **birden çok ifadeye bölebilir**; bölünme gerçekleşirse sıra yeniden
kritik hâle gelir. Yukarıdaki sıralama bu senaryoda da doğru kalır — bu yüzden davranış
"muhtemelen çalışır"a bırakılmaz, açıkça garanti edilir.

Ek olarak `createMany` ÖNCESİ, `deleteMany` ile aynı transaction içinde şu doğrulamalar
yapılır (hepsi 422 `VALIDATION_ERROR`): payload içi `id` benzersizliği; her `parentId`'nin
aynı payload'da bir `id` ile eşleşmesi (DB'deki eski bir id'ye referans GEÇERSİZ — kayıt
tam-replace'tir); işaret edilen öğenin `parentId`'sinin null olması (derinlik 2); bir
öğenin kendi `id`'sini `parentId` olarak verememesi. Zod `superRefine` bunun doğru yeridir
— dizi bütününe bakan çapraz-alan kuralları olduğu için tekil öğe şemasında ifade edilemez.

#### 10.10.4 İçerikten menü öğesi ekleme — snapshot, kalıcı referans YOK

Sayfalar/Blog/Ürünler/Portföy panellerinden checkbox ile seçilen içerik, menüye **o anki
`label`/`href` değerlerinin kopyası** olarak eklenir. `contentType`/`contentId` gibi
polimorfik bir kaynak referansı **TUTULMAZ**; bu paneller yalnızca "Özel Bağlantı"
formunu otomatik dolduran bir kısayoldur ve veri modeli açısından ikisi arasında hiçbir
fark yoktur. Gerekçe: polimorfik FK Prisma'da doğal olarak ifade edilemez (dört ayrı
nullable FK veya kısıtsız `String` id demek); içerik silindiğinde/yayından kaldırıldığında
menü öğesine ne olacağı (sessizce sil / gizle / 404'e bırak) her tip için ayrı bir ürün
kararı gerektirir; ve WordPress'in "Özel Bağlantı" davranışı da tam olarak budur.
**Kabul edilen ödünç:** bir sayfanın slug'ı değişirse menü bağlantısı sessizce kırılır.
Bu bilinçli bir tercihtir; ileride gerekirse çözüm menüye kaynak referansı eklemek DEĞİL,
"kırık bağlantı denetçisi" (admin'de uyarı rozeti) eklemektir — menü modeli basit kalır.

#### 10.10.5 "Konumları Yönet" sekmesi — veri modeli değişikliği YOK

Bu sekme mevcut Logo/Marka, Header CTA (`SiteSettings.headerCtaLabel/headerCtaHref`),
Footer (`footerCopyrightText`, `SocialLink`, `FooterColumn`/`FooterLink`) alanlarını
barındırır. **Şema, uç nokta ve payload'da hiçbir değişiklik yoktur** — iş tamamen
frontend'de yeniden gruplamadır (`page.tsx`'in iki sekmeli bileşenlere bölünmesi).
frontend-agent bu sekme için backend'den bir şey beklememelidir.

### 10.11 Medya Kütüphanesi — Klasör Sistemi + Gelişmiş Çoklu Seçim

Medya kütüphanesine iki geliştirme ekleniyor: (A) **klasör sistemi** (kontrat değişikliği
gerektirir) ve (B) **gelişmiş çoklu seçim kısayolları** (frontend-only). Aşağıdaki
kararlar bağlayıcıdır; ajanlar tahmin YÜRÜTMEZ. Uçların tam şekli `openapi.yaml`
(`Media` tag'i) içindedir — çelişki hâlinde kontrat kazanır.

#### 10.11.1 Veri modeli — `MediaFolder` düz dizi + `parentId`, maksimum derinlik 2

`MediaFolder` (id, seq, name, `parentId` self-relation, createdAt) + `Media.folderId`
nullable FK. **"Kategorisiz" bir klasör KAYDI DEĞİLDİR** — `folderId IS NULL`'ın ta
kendisidir. Sentetik bir "Kategorisiz" satırı reddedildi: silinemez/yeniden
adlandırılamaz özel bir kayıt, her yazma ucuna "bu id özel mi?" kontrolü eklerdi ve
seed/migration'da tekilliğini garanti etmek gerekirdi.

**Maksimum derinlik 2 (kök + bir alt seviye)**, §10.10.1'deki navigasyon kuralının
birebir aynısı: *`parentId` dolu olan bir klasör YALNIZCA `parentId`'si null olan bir
klasörü işaret edebilir.* Faydaları aynı: doğrulama O(n) tek geçiş, döngü **yapısal
olarak imkânsız** (ata gezintisi/recursive CTE gerekmez), ve UI zaten tek girintili bir
ağaç paneli çiziyor. Derinliği artırmak istenirse önce kontrat, sonra doğrulama katmanı
güncellenir; **DB şeması değişmez**. Derinlik DB'de zorlanmaz (Postgres CHECK başka
satıra bakamaz), API validasyon katmanında zorlanır.

API payload'ı **düz dizidir**, iç içe JSON ağacı değildir — gerekçeler §10.10.1 ile aynı,
ek olarak: özyinelemeli şema `fastify-type-provider-zod` tarafında `z.lazy` + tip çıkarımı
sorunları doğurur. Sunucu `(parentId NULLS FIRST, name ASC)` döner; tüketici tek geçişte
ağacı kurar. Bağlayıcı okuma sorgusu:

```ts
app.prisma.mediaFolder.findMany({
  orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { name: "asc" }],
  include: { _count: { select: { media: true } } },
});
```

`mediaCount` **doğrudan** içerikteki medya sayısıdır (alt klasörler hariç) ve yukarıdaki
TEK sorguda gelir — klasör başına ayrı `count()` (N+1) yasaktır. Kümülatif (rollup) sayaç
bilinçli olarak yoktur: `GET /admin/media?folderId=` de özyinelemeli olmadığı için sayı,
klasöre tıklandığında görülecek liste uzunluğuyla birebir eşleşir; rollup gösterilseydi
"12 yazıyor ama 3 görsel var" tutarsızlığı doğardı.

**İsim benzersizliği — dikkat, DB tek başına yetmez.** Kural: aynı `parentId` altında
case-insensitive benzersiz isim, ihlalde `409 CONFLICT`. Bu kural **servis katmanında**
zorlanır. `@@unique([parentId, name])` savunma derinliği olarak eklenebilir ama
**kök seviyeyi KORUMAZ**: PostgreSQL'de NULL'lar birbirinden farklı sayılır, dolayısıyla
`parentId IS NULL` olan iki satır aynı `name` ile bu kısıttan geçer. db-agent bu kısıtı
"iş bitti" sanmamalıdır; ayrıca kısıt case-sensitive'dir, kontrattaki kural değildir.

#### 10.11.2 Uç noktalar ve yetki eşikleri

| Uç | Yetki | Not |
|---|---|---|
| `GET /admin/media/folders` | authenticated | Admin medya sayfası VE `MediaPicker` AYNI ucu paylaşır |
| `POST /admin/media/folders` | ADMIN, EDITOR | `POST /admin/media` (upload) ile aynı eşik |
| `PATCH /admin/media/folders/{folderId}` | ADMIN, EDITOR | yeniden adlandır ve/veya taşı |
| `DELETE /admin/media/folders/{folderId}` | **yalnızca ADMIN** | `DELETE /admin/media/{mediaId}` ile aynı eşik |
| `POST /admin/media/move` | ADMIN, EDITOR | tekil + toplu TEK uç |
| `GET /admin/media?folderId=` | authenticated | sunucu tarafı filtre |

Eşikler mevcut medya desenini aynen izler: **yıkıcı olmayan yazma → ADMIN+EDITOR, kalıcı
kayıp riski taşıyan silme → yalnızca ADMIN**. Klasör silmek görselleri yok etmese de
organizasyon bilgisini geri alınamaz biçimde kaybettirdiği için ADMIN eşiğindedir.

`GET /admin/media/folders` **sayfalanmaz** ve **arama parametresi almaz**: ağaç panelinin
doğru çizilmesi tüm düğümleri gerektirir, v1 varsayımı klasör sayısının ~200 altında
olmasıdır ve liste zaten bellekte olduğu için **klasör adı araması frontend-only'dir**.

#### 10.11.3 Silme semantiği — hiçbir şey kaskad silinmez

- **İçindeki medya:** `Media.folderId` `onDelete: SetNull` → görseller "Kategorisiz"e
  düşer. Görsel kaydı ve disk dosyası ASLA silinmez.
- **Alt klasörler:** **CASCADE DEĞİL** — self-relation da `onDelete: SetNull`, alt
  klasörler `parentId = null` alarak KÖKE çıkar. Cascade reddedildi: tek tıkla görünmeyen
  bir alt ağacın organizasyonunu silmek, "medyayı silmiyoruz" güvencesiyle çelişen
  sürpriz bir kayıp olurdu; ayrıca derinlik-2 sınırında alt klasörün köke çıkması her
  zaman geçerli bir durumdur, ek doğrulama gerekmez.

Her iki etki de FK davranışıyla DB seviyesinde ifade edilir — servis katmanında elle
`updateMany` döngüsü YAZILMAZ. Frontend onay diyaloğunda etkiyi sayısal olarak yazar
("N görsel Kategorisiz'e taşınacak, M alt klasör en üst seviyeye çıkacak").

#### 10.11.4 Taşıma — tek uç, tekil = tek elemanlı dizi

Ayrı bir `/move-bulk` ucu **YOKTUR**. `POST /admin/media/move` her zaman `mediaIds`
dizisi + `folderId` (nullable ama ZORUNLU alan) alır; tekil taşıma tek elemanlı dizidir.
İki ayrı uç, iki ayrı kısmi-başarı semantiği ve zamanla birbirinden sapan iki kod yolu
demek olurdu. Kısmi başarı hata değildir (`skippedIds` + `200`, `POST /admin/pages/bulk`
ailesiyle aynı felsefe); hedef klasör yoksa istek tamamen reddedilir (`404`), kısmi
uygulama yapılmaz. Yazma **tek `updateMany`** ile yapılır.

**`PATCH /admin/media/{mediaId}` `folderId` KABUL ETMEZ** — hakemlik kararı: "tek alan
güncellenebilir" kuralı korunur ve taşımanın tek doğru yolu olur. Frontend `folderId`'yi
PATCH ile göndermeye çalışırsa 422 alır; kontrat tarafı haklıdır.

`POST /admin/media` (upload) ise opsiyonel `folderId` **kabul eder** — kullanıcı bir
klasörün içindeyken yüklediğinde görselin oraya düşmesi beklenen davranıştır ve
"yükle sonra taşı" iki isteklik bir yarış durumu yaratırdı. Klasör varlık kontrolü
**dosya diske yazılmadan ÖNCE** yapılır, aksi hâlde DB kaydı olmayan yetim dosya kalır.

#### 10.11.5 Gelişmiş çoklu seçim — frontend-only, kontrat etkisi YOK

Shift+tık aralık seçimi, Ctrl/Cmd+tık toggle, Ctrl/Cmd+A ile *o an görünen* (aktif
klasör + tür/tarih/arama filtreleri sonrası) tüm öğeleri seçme, seçim çubuğunda
Toplu Sil / Klasöre Taşı. **Backend'de hiçbir değişiklik gerektirmez** — mevcut checkbox
seçimi zaten var, eklenen tamamen etkileşim katmanıdır. Bağlayıcı davranış kuralları:

- Aralık (shift) seçimi **görünen sıralamaya göre** hesaplanır (grid ve listede aynı
  dizi kullanılır) — "son tıklanan öğe" (anchor) state'te tutulur.
- Ctrl+A **yalnızca medya ızgarası odaktayken** çalışır ve tarayıcının "tümünü seç"
  davranışını `preventDefault` ile bastırır; bir input odaktayken ASLA yakalanmaz.
- Klasör değiştirildiğinde seçim **temizlenir** (görünmeyen öğeler üzerinde toplu işlem
  yapılmasını önlemek için).
- Toplu silme hâlâ id başına `DELETE /admin/media/{mediaId}` ile yapılır (v1'de toplu
  silme ucu YOKTUR, mevcut davranış korunur). Bir toplu-silme ucu istenirse önce kontrat
  güncellenir.

### 10.12 Site Özelleştirme (WordPress Customizer benzeri görünüm paneli)

Admin paneline, ziyaretçi sitesinin **görünümünü** yöneten yeni bir bölüm ekleniyor:
`/admin/appearance` ("Site Özelleştirme"). Aşağıdaki kararlar bağlayıcıdır; ajanlar
tahmin YÜRÜTMEZ. Uçların tam şekli `openapi.yaml` (`Appearance` tag'i) içindedir —
çelişki hâlinde kontrat kazanır.

**Bu bölümün TEK cümlelik ilkesi:** buradaki hiçbir ayar admin panelinin kendi
görünümünü değiştirmez; admin teması (`next-themes` açık/koyu + `AccentProvider`
vurgu rengi) **kullanıcı başına** bir tercihtir, bu panel ise **site geneli** bir
yayın ayarıdır. İkisi ne veri modelinde, ne uçta, ne de CSS token'ında birbirine
değer.

#### 10.12.1 Rota sınırı — üç ekran, tek sahiplik, taşıma YOK

Üç yönetim ekranı arasındaki sınır şu üç soruyla çizilir:

| Soru | Ekran | Örnek alanlar |
|---|---|---|
| Site **nasıl çalışır**? (kimlik/işlev/hesap) | `/admin/settings` | `siteName`, `homePageId`, `siteTemplate`, rol matrisi, SMTP |
| Site **nasıl görünür**? | `/admin/appearance` **(YENİ)** | renkler, fontlar, başlık düzeni, anahtarlar, 404, özel kod |
| Site içinde **nereye gidilir**? + site kimliği | `/admin/navigation` | menü ağacı, header CTA, footer sütunları, **logo/slogan**, **sosyal hesap linkleri** |

**Karar: Logo & Marka ve Sosyal Hesap Linkleri TAŞINMAZ — derin link verilir.**
İkisi de `/admin/navigation` ekranında çalışır durumda, canlı önizlemeye bağlı ve
kendi kaydedilmemiş-değişiklik akışına sahiptir. Taşımak, kullanıcıya görünen hiçbir
kazanç sağlamadan saf bir gerileme riskidir; ayrıca logo header/footer yapısının,
sosyal linkler de footer sütunlarının **yanında** düzenlendiğinde anlamlıdır.
`/admin/appearance` bunun yerine salt-okunur birer özet kartı gösterir ve
`/admin/navigation?tab=locations` derin linkini verir (frontend-agent, `activeTab`'ı
`?tab=` sorgu parametresinden okuyacak şekilde küçük bir ekleme yapar).

Bu, **her iki mevcut yüzey için de aynı kararın** uygulanmasıdır — tutarlılık
kasıtlıdır. Genel kural: **bir alan YALNIZCA TEK bir ekranda düzenlenir; diğer
ekranlar yalnızca derin link verir.** (`/admin/settings`'teki `siteName` alanı bu
kuralın zaten uygulanmış bir örneğidir: slogan orada düzenlenmez, Navigasyon'a
yönlendirir.)

Gerçekten YENİ olan tek sosyal medya işlevi **paylaşım butonlarıdır**
(`socialShareEnabled` / `socialShareNetworks`) — bu, ziyaretçinin içeriği dışarı
paylaşmasıdır ve sitenin kendi hesaplarıyla ilgisi yoktur. Bu yüzden `SocialPlatform`
enum'u YENİDEN KULLANILMAZ; ayrı bir `SocialShareNetwork` enum'u tanımlanır (biri
`GITHUB` gibi paylaşım hedefi olmayan, diğeri `COPY_LINK` gibi hesabı olmayan
değerler içerir; birleştirmek iki listeyi de yanlış kılardı).

#### 10.12.2 Şema stratejisi — iki YENİ singleton tablo, `SiteSettings` DOKUNULMAZ

**Karar: `SiteSettings`'e HİÇBİR kolon eklenmez.** Yeni iki tablo açılır:
`SiteAppearance` (görünüm) ve `SiteCustomCode` (özel CSS/JS + denetim izi). İkisi de
`id = "singleton"` sabiti ve `SiteSettings` ile aynı lazy-upsert `DEFAULTS` desenini
kullanır.

Gerekçeler (önem sırasına göre):

1. **Rol eşiği farklıdır ve alan-başına RBAC bir anti-paterndir.** `PATCH
   /admin/settings` bugün tek bir ADMIN eşiğine sahiptir. Görünüm ayarlarının denetim/
   onay/hız-sınırı politikası (özellikle özel JS) bundan farklıdır. Ayrı tablo → ayrı
   uç → rolün `requireSiteRole` preHandler'ı ile **uç seviyesinde** zorlanması. Tek
   gövdede "bu alan ADMIN, şu alan EDITOR" mantığı, tam olarak sessizce yanlış
   uygulanan türden bir koddur.
2. **`GET /settings` PUBLIC'tir.** Oraya ~30 görünüm kolonu eklemek, mevcut public
   DTO'nun şeklini ve onu tüketen her testi/istemciyi değiştirirdi. Yeni bir public
   uç (`GET /appearance`) mevcut sözleşmeyi hiç kırmadan eklenir.
3. **Yaşam döngüleri farklıdır.** Görünüm bir bütün olarak sıfırlanabilir/ön ayara
   döndürülebilir (`POST /admin/appearance/reset`); `siteName`/`homePageId` için
   böyle bir işlem anlamsızdır. "Renklerimi sıfırla" komutunun ana sayfa seçimini de
   sıfırlayabilecek bir tabloda yaşaması riskli bir yakınlıktır.
4. **Sıcak bir tabloda migration riski yoktur** — `SiteSettings` her public sayfa
   render'ında okunur.

**Karar: alanlar TİPLİ KOLONDUR, JSON blob DEĞİL.** `SiteModule.settings` gibi bir
`Json` alanı cazip görünür ama: Zod ile alan-başına doğrulama (hex deseni, enum,
min/max) kaybolur, OpenAPI'de gerçek bir şekil tanımlanamaz, kısmi PATCH semantiği
belirsizleşir ve tüketici her okumada elle tip daraltma yapmak zorunda kalır. Renk/
font/anahtar alanlarının sayısı (~28) sabit ve öngörülebilirdir; bu, tam olarak
kolonların işidir.

Tek FK: `SiteAppearance.pageHeaderBackgroundMediaId → Media`, `onDelete: SetNull`
(mevcut `coverMediaId` paterni — serbest URL alanı değil, medya kütüphanesinden
seçim). Görsel silinirse banner sessizce renge/sade metne düşer, 500 vermez.
`SiteCustomCode.cssUpdatedById`/`jsUpdatedById → User`, `onDelete: SetNull` —
kullanıcı silinse de denetim satırı korunur.

#### 10.12.3 Tema ön ayarları — statik kod registry'si, tablo YOK, canlı bağ YOK

Ön ayarlar (`Klasik`/`Modern`/`Minimal` vb.) `lib/appearance-presets.ts` içinde
**kod içi statik bir liste**dir — `MODULE_REGISTRY` ve `PERMISSIONS_MATRIX` ile aynı
patern. DB tablosu yoktur (kullanıcı ön ayar OLUŞTURAMAZ; bu istenirse ayrı bir
özelliktir).

**Ön ayar uygulamak bir sunucu işlemi DEĞİLDİR.** İstemci `GET
/admin/appearance/presets`'ten değerleri alır, formu doldurur, kullanıcı Kaydet
dediğinde normal `PATCH /admin/appearance` gider. Sebep: `presetKey` **canlı bir bağ
olsaydı**, kullanıcı tek bir rengi elle değiştirdiğinde "ön ayar hâlâ geçerli mi?"
sorusu cevapsız kalırdı ve her okuma "ön ayar + override" birleştirmesi gerektirirdi.
Bunun yerine ön ayar bir **tohum (seed)** değerdir: alanlar her zaman tek başına
düzenlenebilir (kullanıcının istediği "ileri kullanıcı için atlama imkanı"), elle
değişiklik yapılınca istemci `presetKey: null` (özel) gönderir.

Ön ayarlar **yalnızca renk ve tipografi** taşır. Bakım modu/çerez bandı gibi
anahtarları, 404 metinlerini veya özel kodu ASLA değiştirmezler — bir "tema seçimi"nin
siteyi bakıma alması kabul edilemez bir sürpriz olurdu.

Ön ayar listesinin frontend sabiti yerine **sunucu ucu** olmasının sebebi: ön ayar,
doğrudan bu kontratın alanlarına yazılacak değerleri içerir; frontend'de dursaydı
sunucu doğrulamasından bağımsız evrilir ve enum'da olmayan bir font içeren ön ayar
kaydedilirken 422 verirdi. Statik bir listeyi API üzerinden sunmanın projede zaten
emsali var: `GET /admin/settings/permissions`.

**Fontlar kapalı bir enum'dur** (`SiteFont`) — bu bir tercih değil, teknik
zorunluluktur: frontend `next/font/google` kullanır ve bu API font adının **derleme
zamanında** bilinmesini gerektirir; çalışma zamanında gelen keyfi bir dize yüklenemez.
Ek fayda, kontrolsüz üçüncü taraf isteklerinin ve öngörülemeyen düzenin önlenmesidir.
`SYSTEM` varsayılanı hiç harici istek yapmaz.

#### 10.12.4 Renk/tipografi render sözleşmesi — `--site-*` token'ları, `.site-scope`

Admin paneli `globals.css` içinde `.admin-shell` altında `--primary`/`--ring`/
`--viz-series-1` token'larını `AccentProvider`'ın yazdığı `--accent-*` değişkenlerine
bağlar. Site renkleri bu token'lara **ASLA yazmaz**. Bağlayıcı kural:

- Site değerleri `--site-primary`, `--site-secondary`, `--site-button`,
  `--site-button-text`, `--site-link`, `--site-heading-font`, `--site-body-font`,
  `--site-base-font-size` değişkenlerine yazılır.
- Bu değişkenler **yalnızca `(site)` route grubunun layout'undaki `.site-scope`
  sarmalayıcısına** uygulanır — `:root`'a DEĞİL. `:root`'a yazmak, `.admin-shell`
  tarafından geçersiz kılınsa bile, admin panelindeki `.admin-shell` dışında kalan
  her şeyi (toast, dialog portal'ları) etkileme riski taşır.

Bu isimlendirme kararı **yük taşıyan** bir karardır: admin panelindeki canlı
önizlemenin, ayrı bir iframe'e taşınmadan, mevcut `SiteHeader`/`SiteFooter`
bileşenleriyle güvenle çalışabilmesinin tek sebebi budur — önizleme sarmalayıcısına
`.site-scope` + `--site-*` verilir, admin arayüzü etkilenmez.

**Alan adlarında `site` ön eki KULLANILMAZ** (`SiteAppearance.primaryColor`, ne
`sitePrimaryColor`): tablo/uç/DTO adı kapsamı zaten taşır ve `SiteAppearance.
sitePrimaryColor` kekemelik olurdu. Site-scope netliği isim tekrarıyla değil,
yukarıdaki **render sözleşmesiyle** garanti edilir. (Bu, "alan adları açıkça
site-scope olsun" isteğinin lafzından ziyade amacını karşılayan bilinçli bir
sapmadır; kayda geçirilmiştir.)

**Kontrast sunucuda zorlanmaz.** Renk seçimi öznel bir tasarım kararıdır; sert bir
422 kullanıcıyı kendi sitesinden kilitlerdi. Bunun yerine istemci, WCAG AA eşiğinin
altındaki kombinasyonlarda seçicinin yanında **engellemeyen** bir uyarı gösterir
(eşiği ve metni ui-designer tanımlar). `buttonTextColor` ayrı bir alandır çünkü
otomatik siyah/beyaz türetimi orta tonlu zeminlerde AA'yı güvenilir biçimde sağlamaz.

#### 10.12.5 Görünüm anahtarları — `SiteModule` DEĞİL, tipli kolonlar

**Karar: "Kayan yukarı çık butonu", "çerez bandı", "bakım modu" gibi anahtarlar
`SiteModule` tablosunu KULLANMAZ.** Gerekçe:

- `SiteModule`/`MODULE_REGISTRY` (§10.9) semantiği "kendi admin rotaları, kendi veri
  modeli ve kendi menü girdisi olan bir özellik alanı"dır (`adminPath`,
  `recommendedFor` alanları bunun içindir). Yukarı-çık butonunun ne admin sayfası, ne
  veri modeli, ne de sidebar girdisi vardır. Registry'ye eklemek, "Eklentiler"
  ekranında onu "Ürünler"in eşiti gibi göstermek olurdu — kullanıcıya söylenen
  semantik bir yalan.
- `SiteModule.settings` `Json`'dır: çerez bandının metni ve politika linki için
  alan-başına doğrulama ve gerçek bir OpenAPI şekli gerekir.
- Yön asimetriktir: bir anahtar ileride gerçek bir modüle terfi ettirilebilir; ama
  aslında onay kutusundan ibaret olan bir "modül", kullanıcıya dönük bir ekranı
  kalıcı olarak kirletir.

**Kabul edilen anahtarlar (v1, beş adet):** `backToTopEnabled` (varsayılan `true`),
`stickyHeaderEnabled` (`true`), `cookieBannerEnabled` (`false`, + `cookieBannerText`
+ `cookieBannerPolicyHref`), `maintenanceModeEnabled` (`false`, +
`maintenanceMessage`) ve — kendi bölümünde — `socialShareEnabled`. Hepsinin ortak
özelliği: hedefledikleri arayüz ya zaten vardır (header) ya da bağımsız, küçük bir
bileşendir.

**Reddedilenler (gerekçesiyle):** ekmek kırıntısı/breadcrumb (var olmayan bir sayfa
hiyerarşisini gerektirir), okuma ilerleme çubuğu (kapsam şişmesi), "animasyonları
kapat" (bu bir ziyaretçi tercihidir ve `prefers-reduced-motion` ile karşılanmalıdır —
site sahibinin ayarı olarak modellemek erişilebilirlik açısından yanlış olurdu),
kenar çubuğu/widget (mimari yok, kullanıcı da kapsam dışı bıraktı).

**Çerez bandı — v1 BİLGİLENDİRMEDİR, onay yöneticisi DEĞİLDİR.** Hiçbir script'i
engellemez, koşullu yüklemez ve onay kaydı tutmaz. Bu, KVKK/GDPR açısından kritik bir
ayrımdır: arayüz metni "onay alıyoruz" izlenimi verirse, olmayan bir uyumluluk vaat
edilmiş olur. compliance-agent metni bu gözle doğrular; gerçek bir onay yöneticisi
(kategoriler, geri çekme, onay kaydı) ayrı bir özelliktir.

**Bakım modu bir GÜVENLİK kontrolü DEĞİL, bir SUNUM anahtarıdır.** API'yi kapatmaz,
hiçbir veriyi korumaz. Bağlayıcı kurallar:

- Yalnızca `(site)` route grubunun layout'unda değerlendirilir. `/admin` **başka bir
  route grubudur ve etkilenmez** — yönetici kendini asla kilitleyemez. Bunun API
  seviyesinde bir engel olarak uygulanması YASAKTIR (admin paneli kendi kendini
  kilitlerdi).
- Bakım sayfası HTTP **503** + `Retry-After` ile döner (arama motorlarının doğru
  davranışı için; 200 dönmek sayfaların "içerik bu" diye indekslenmesine yol açar).
- **v1'de kullanıcıya özel atlatma (bypass) YOKTUR.** Sebep teknik: `(site)`
  layout'unun ayar çağrısı anonim ve `revalidate: 60` ile ISR-önbelleklidir; oturuma
  duyarlı bir atlatma, her public sayfa render'ında `cache: "no-store"` gerektirir ve
  bu gerçek bir performans gerilemesidir. Bakım sayfası `/admin`'e bir bağlantı
  içerir. İleride istenirse doğru yer `middleware.ts`'tir (oturum çerezi istek başına
  okunabilir ve layout'un önbelleği bozulmaz).

#### 10.12.6 Özel CSS/JS — tehdit modeli ve katmanlı koruma

Bu, kontrattaki **en yüksek riskli** yüzeydir: kaydedilen metin her ziyaretçinin
tarayıcısında sitenin kendi kaynağından (same-origin) çalışır.

**Karar: TÜM görünüm yazma uçları — CSS ve JS dahil — yalnızca ADMIN'dir.** Bu,
"CSS için ADMIN/EDITOR olabilir" ilk önerisinden bilinçli bir sapmadır ve hakemlik
kararıdır: EDITOR'a global CSS yazdırıp renk seçiciyi yasaklamak tutarsızdır, ve CSS
tek başına bir saldırı yüzeyidir — `position: fixed` kaplamayla clickjacking,
`content: url(...)` ile dışarı istek/veri sızdırma, yasal uyarıyı veya çerez bandını
`display: none` ile gizleme. security-agent bu politikayı **sıkılaştırabilir,
gevşetemez**. Okuma (`GET`) authenticated'tır: kod zaten public HTML kaynağında
görünür olduğundan okumayı kısıtlamak güvenlik tiyatrosu olurdu.

**Ayrı uçlar, ayrı belgeler.** `PUT /admin/appearance/custom-code/css` ve `PUT
/admin/appearance/custom-code/js` — PATCH değil PUT, çünkü gövde tek bir metin
belgesinin tamamıdır. Ayrı olmalarının sebebi, JS politikasını CSS'ten bağımsız
sıkılaştırabilmek ve tek gövde içinde alan-başına rol kontrolü anti-paterninden
kaçınmaktır.

**Onay akışı kontratta temsil edilir:** gövdede `acknowledged: boolean` zorunlu
alandır. Değer boş DEĞİLSE `true` olmak zorundadır, aksi hâlde `422
VALIDATION_ERROR`. Kod **temizlenirken** (`null`/`""`) onay aranmaz — kod kaldırmak
her zaman güvenlidir. Onayın sunucuda zorlanması şarttır; yalnızca arayüzdeki bir
onay kutusu doğrudan API çağrısıyla atlanabilirdi.

**Reddedilen seçenek: sunucu tarafı sanitizasyon.** Keyfi JavaScript'i anlamlı
biçimde temizlemek imkânsızdır; kısmi bir temizleyici, olmayan bir güvenliğe dair
yanlış güven yaratır. Koruma bunun yerine **katmanlıdır**: yetenek kısıtı (ADMIN),
açık onay, denetim izi, hız sınırı, boyut sınırı ve kill switch.

**Denetim izi:** `appearance.custom_css.update` / `appearance.custom_js.update`,
`metadata: { length, sha256, acknowledged }`. **Kod gövdesi audit metadata'sına
yazılmaz** — 50 KB'lık blob'u denetim kaydında çoğaltmak yerine özet tutulur (özet
ayrıca ileride CSP hash kaynağı olarak yeniden kullanılabilir).

**Kill switch:** `CUSTOM_CODE_ENABLED` ortam değişkeni (varsayılan `true`). `false`
iken iki PUT ucu 403 döner ve public `GET /appearance` `customJs: null` verir; saklı
değer korunur ve yönetim ucunda görünmeye devam eder. Barındırılan/çok kiracılı bir
kurulumda keyfi JS tümden yasaklanabilsin ve olay anında tek kaldıraçla kapatılabilsin
diye vardır. devops-agent bu değişkeni sahiplenir; arayüz kapalıyken editörü devre
dışı bırakıp nedenini açıklar (kullanıcı 403'ü kaydettikten sonra görmemelidir).

**Render sözleşmesi (frontend-agent için bağlayıcı):**

- Enjeksiyon **YALNIZCA `(site)` route grubunun layout'unda** yapılır. Kök
  `app/layout.tsx` admin panelini de sarmalar; oraya konması site CSS'inin admin
  arayüzünü bozması demektir. Bu, bu bölümdeki **tek en önemli uygulama kuralıdır**.
- `customCss` → `<style>`; `customJs` → `next/script`,
  `strategy="afterInteractive"`, sabit `id`.
- Gömmeden önce kapanış etiketi kaçışı ZORUNLUDUR (`</style` ve `</script`
  dizilerinin nötrleştirilmesi) — aksi hâlde metin, kendi etiketinden çıkıp
  belgeye keyfi işaretleme enjekte edebilir.
- **Özel CSS/JS canlı önizlemede UYGULANMAZ (v1).** Önizleme, admin DOM'u içinde
  satır içi çalışır; keyfi CSS'i doğru önizlemek gerçek bir belge (iframe) gerektirir
  ve mevcut paylaşılan `SiteHeader`/`SiteFooter` yaklaşımını bozardı. Bu bölüm bunun
  yerine "yeni sekmede siteyi aç" sunar. (Renkler/fontlar/düzen önizlemede
  ÇALIŞIR — `--site-*` scope'u sayesinde, bkz. §10.12.4.)

#### 10.12.7 404 sayfası

`notFoundTitle` / `notFoundMessage` / `notFoundButtonLabel` / `notFoundButtonHref`,
hepsi nullable; `null` ise frontend'in sabit Türkçe varsayılanı kullanılır. Buton,
etiket ve href'in **ikisi de** doluysa gösterilir (`headerCta*` ile aynı kural).

İki bağlayıcı uygulama notu:

- Mevcut `frontend/src/app/not-found.tsx` **kök** not-found'dur ve admin 404'lerini de
  yakalar. Özelleştirilmiş 404, `(site)` segmentinin **kendi** `not-found.tsx`'ine
  konur; admin genel olanı kullanmaya devam eder.
- 404 render'ı sırasında yapılan ayar çağrısı **asla hata fırlatmamalıdır** — bir 404
  bileşeninde fırlatılan hata 500'e dönüşür. `fetchSiteSettingsServer`'daki
  try/catch → varsayılan deseni birebir uygulanır.

#### 10.12.8 Kaydedilmemiş değişiklik koruması — ortak hook'a ÇIKARILIR (refactor kapsamdadır)

Bugün aynı mantık (`beforeunload` + capture-phase link tıklaması + `window.confirm` +
aynı Türkçe uyarı metni) `/admin/navigation` ve `/admin/settings` sayfalarında
**kopyalanmış** durumdadır. Dokuz bölümlü yeni panelde üçüncü bir kopya çıkarmak
sürdürülebilir değildir.

**Karar: `frontend/src/hooks/use-unsaved-changes-guard.ts` çıkarılır ve mevcut İKİ
sayfa da bu hook'a taşınır — refactor bu görevin kapsamındadır.** Sadece yeni panelde
kullanmak, kopyaların kalıcılaşmasını garantilerdi. Taşıma mekaniktir (iki uygulama
zaten birebir aynı); riski qa-agent'ın iki mevcut sayfa için ekleyeceği regresyon
testi karşılar. `UNSAVED_CHANGES_WARNING` sabiti de hook modülüne taşınır (tek metin
kaynağı).

Bağlayıcı imza:

```ts
useUnsavedChangesGuard({ enabled: boolean; message?: string }): {
  confirmDiscard: () => boolean; // sekme değişimi gibi uygulama-içi geçişler için
}
```

Efektler `beforeunload` ve `/admin` linklerine capture-phase tıklamayı üstlenir;
`confirmDiscard()` sekme değiştirmede çağrılır ve devam edilebiliyorsa `true` döner.

#### 10.12.9 Panel yapısı ve kaydetme semantiği

Panelin dokuz bölümünün **hepsi tek bir `PATCH /admin/appearance` ucunu kullanır**
(özel kod hariç). "Bölüm başına Kaydet" bir **arayüz** kavramıdır: her bölüm yalnızca
kendi alanlarını gönderir, kısmi PATCH semantiği bunu doğal olarak karşılar. Dokuz
ayrı uç = dokuz Zod şeması + zamanla birbirinden sapan dokuz kod yolu demek olurdu.
Bölüm başına Kaydet düğmesinin yanında, tüm kirli bölümleri tek istekte yazan bir
"Tümünü Kaydet" yapışkan çubuğu bulunur (mevcut sayfaların yapışkan Kaydet kartı
paterni).

Canlı önizleme **mevcut** `SiteHeader`/`SiteFooter` bileşenleriyle yapılır — yeni bir
önizleme bileşeni YAZILMAZ. `/admin/navigation`'daki `previewSettings` /
`previewNavigationItems` / `previewSocialLinks` / `previewFooterColumns` deseni
genişletilerek yeniden kullanılır; ortak kısım paylaşılan bir bileşene çıkarılabilir,
ancak `SiteHeader`/`SiteFooter`'ın prop arayüzü DEĞİŞTİRİLMEDEN.

Önbellek gecikmesi kullanıcıya söylenir: public ayar çağrısı `revalidate: 60`
kullandığından değişiklikler siteye **en geç 60 saniyede** yansır; panel bunu açıkça
yazar. `cache: "no-store"`'a geçmek yasaktır (her public sayfa render'ında ek istek).

#### 10.12.10 Sayfa Başlığı Banner'ı — public tarafta HENÜZ implemente EDİLMEDİ

`pageHeaderStyle: "BANNER"` admin panelinde (`/admin/appearance`, "Sayfa Başlığı
Düzeni" bölümü) seçilebilir ve önizlemede (`PreviewPageHeaderBanner`) render edilir,
ancak `(site)` route grubunda (`frontend/src/app/[lang]/(site)/`) bu stili gerçek
ziyaretçi sayfalarında basan bir bileşen **yok** — `fetchSiteAppearanceServer`
(`frontend/src/lib/api/server-appearance.ts`) yalnızca header/footer renk-font CSS
değişkenlerini besliyor, sayfa başlığı bloğunun kendisi henüz yazılmadı.

O bileşen yazılırken **admin önizlemesiyle aynı okunabilirlik garantisi** uygulanmalı:
metnin arkasına `overlayOpacity`'den bağımsız, sabit `bg-black/60 backdrop-blur-sm`
bir pill (bkz. `PreviewPageHeaderBanner`, `frontend/src/app/admin/appearance/page.tsx`).
Text-shadow tek başına yetersizdir — etkinliği arka plan görselinin içeriğine göre
değişir; blur tabanlı pill arkasındaki her görseli/deseni bulanıklaştırıp karartarak
`overlayOpacity` %0 olsa bile sabit bir kontrast tabanı garanti eder. Bu iki
render'ın (admin önizleme / gerçek site) görsel olarak sapması, "önizlemede okunur,
sitede okunmaz" tutarsızlığına yol açar.

### 10.13 Üçüncü Parti Entegrasyon: API Anahtarları + Public API + Giden Webhook'lar

Durum: v1 planlama · `feature/third-party-integration`. Bu bölüm **üç ayrı ama birbirine
bağlı** yeteneği tanımlar:

1. Admin panelden yönetilen **API anahtarı** sistemi (`/admin/settings/api-keys`),
2. Bu anahtarlarla kimlik doğrulanan, mevcut admin API'sinden **AYRI ve SALT-OKUNUR**
   bir **public API katmanı** (`/api/v1/public/*`),
3. Olay bazlı, HMAC ile imzalanmış **giden (outbound) webhook** sistemi
   (`/admin/settings/webhooks`).

Aşağıdaki kararlar **bağlayıcıdır**; ajanlar tahmin YÜRÜTMEZ. Uçların tam şekli
`openapi.yaml` (`ApiKeys`, `OutboundWebhooks`, `PublicApi` tag'leri) içindedir —
çelişki hâlinde kontrat kazanır.

**İsimlendirme çakışması uyarısı (ZORUNLU okuma):** projede zaten
`backend/src/modules/webhooks/stripe.routes.ts` var ve o **GELEN** (inbound) bir
webhook'tur — Stripe bize POST atar. Bu bölümdeki sistem tam tersidir: **BİZ dışarıya
POST atarız**. İki kavram ASLA aynı modül/klasör/tip adı altında toplanmaz. Bağlayıcı
ayrım:

| Yön | Modül | URL | Kimlik doğrulama |
|---|---|---|---|
| **Gelen** (mevcut, DOKUNULMAZ) | `modules/webhooks/` | `POST /webhooks/stripe` | Stripe imza doğrulaması |
| **Giden** (YENİ) | `modules/outbound-webhooks/` | `/admin/settings/webhooks` (yönetim) | `SiteRole=ADMIN` |

Tip/DTO adlarında da bu ayrım korunur: `OutboundWebhook`, `WebhookDelivery`,
`WebhookEvent`. Çıplak `Webhook` adı HİÇBİR yerde kullanılmaz (belirsizdir).

#### 10.13.1 Modül ve dosya yapısı (backend-agent — bağlayıcı)

Üç YENİ modül açılır; mevcut hiçbir modül taşınmaz/yeniden adlandırılmaz.

```
backend/src/modules/api-keys/
  api-keys.routes.ts         # /admin/settings/api-keys — admin CRUD
  api-keys.schemas.ts        # Zod
  api-keys.service.ts        # anahtar üretimi, hash, doğrulama, cache invalidation

backend/src/modules/outbound-webhooks/
  outbound-webhooks.routes.ts      # /admin/settings/webhooks — admin CRUD + deliveries
  outbound-webhooks.schemas.ts     # Zod
  outbound-webhooks.service.ts     # CRUD iş mantığı, secret üretimi/rotasyonu
  outbound-webhooks.dispatcher.ts  # süreç-içi sweeper + gönderim + backoff (§10.13.8)
  outbound-webhooks.retention.ts   # delivery log budama (§10.13.8)

backend/src/modules/public-api/
  public-api.routes.ts       # /api/v1/public/* — SALT-OKUNUR (yalnızca GET)
  public-api.schemas.ts      # Zod — Public* DTO'ları (§10.13.5)
```

Ortak/altyapı dosyaları:

```
backend/src/middleware/api-key-auth.ts   # X-Api-Key doğrulama preHandler'ı (§10.13.4)
backend/src/lib/api-key.ts               # anahtar formatı, üretim, parse, hash
backend/src/lib/api-key-rate-limit.ts    # anahtar-başına sayaç (§10.13.6)
backend/src/lib/ssrf-guard.ts            # URL/IP doğrulama + pinned lookup (§10.13.7)
backend/src/lib/webhook-signature.ts     # HMAC imza üretimi (§10.13.9)
backend/src/lib/webhook-emitter.ts       # emitWebhookEvent() — tek giriş noktası
backend/src/lib/webhook-events.ts        # olay kayıt defteri (statik registry)
```

`app.ts` kayıtları (mevcut desene birebir uyar):

```ts
api.register(apiKeysRoutes,          { prefix: "/admin/settings/api-keys" });
api.register(outboundWebhooksRoutes, { prefix: "/admin/settings/webhooks" });
api.register(publicApiRoutes,        { prefix: "/public" });   // nihai: /api/v1/public/*
```

Ayrıca `app.ts`'e §10.8.1 deseniyle AYNI şekilde iki kayıt daha eklenir:
`registerWebhookDispatcher(app)` ve `registerWebhookDeliveryRetentionScheduler(app)`
(`onReady` kurtarması + `onClose` temizliği ZORUNLU).

**Yeni ortam değişkeni GEREKMEZ** (devops-agent notu): webhook secret'ları mevcut
`ENCRYPTION_KEY` ile şifrelenir, hız sınırı sabitleri koddadır.

#### 10.13.2 Şema (db-agent — TEK SAHİP)

`backend/prisma/schema.prisma` tek dosyadır; aşağıdaki enum/modeller oraya eklenir.
**Bu bölümdeki alan listesi bağlayıcıdır** — backend-agent şema tasarlamaz, tüketir.

```prisma
// --- API Anahtarları (§10.13.3) ---

// İLERİYE DÖNÜK: public katman v1'de salt-okunurdur, ama scope kontrolü ŞİMDİDEN
// şemada ve doğrulama hattında vardır (bkz. §10.13.4) — yazma uçları eklendiğinde
// yeni bir migration ve yeni bir yetki ekseni İCAT EDİLMESİN diye.
enum ApiKeyScope {
  READ
  READ_WRITE
}

enum ApiKeyStatus {
  ACTIVE
  REVOKED
}

model ApiKey {
  id          String       @id @default(uuid())
  seq         Int          @unique @default(autoincrement())   // cursor sayfalama
  name        String                                            // ör. "Mobil Uygulama"
  description String?
  // Anahtarın GİZLİ OLMAYAN tanıtıcı parçası: `cmsk_<12hex>` (bkz. §10.13.3).
  // Doğrulamada indeks araması bunun üzerinden yapılır — tüm anahtarları taramak YOK.
  keyPrefix   String       @unique
  // sha256(rawKey) hex. DÜZ METİN ASLA SAKLANMAZ, geri döndürülemez (bkz. §10.13.3).
  keyHash     String       @unique
  // Ham anahtarın SON 4 karakteri — listede maskeli gösterim için. Tek başına
  // tahmin edilebilir bir bilgi taşımaz (32 byte entropinin son 16 biti).
  last4       String
  scope       ApiKeyScope  @default(READ)
  status      ApiKeyStatus @default(ACTIVE)
  lastUsedAt  DateTime?
  // MASKELENMİŞ istemci IP'si (lib/pii-mask.ts::maskIp) — sızmış anahtarı tespit
  // etmek için. HAM IP SAKLANMAZ (compliance-agent kararı, §10.13.10).
  lastUsedIp  String?
  expiresAt   DateTime?    // null = süresiz
  revokedAt   DateTime?
  revokedById String?
  createdById String?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  createdBy User? @relation("ApiKeyCreator", fields: [createdById], references: [id], onDelete: SetNull)
  revokedBy User? @relation("ApiKeyRevoker", fields: [revokedById], references: [id], onDelete: SetNull)

  @@index([status])
  @@index([createdById])
  @@map("api_keys")
}

// --- Giden Webhook'lar (§10.13.8) ---

// Wire (JSON) gösterimi ENUM ADIYLA BİREBİR AYNIDIR — SCREAMING_SNAKE. Ayrı bir
// `blog_post.published` gibi nokta-notasyonu eşleme tablosu BİLİNÇLİ olarak
// AÇILMADI: projedeki tüm enum'lar (`OrderStatus`, `PageStatus`, `ImportJobType`)
// wire'da SCREAMING_SNAKE'tir; ikinci bir gösterim kaçınılmaz olarak sapardı.
enum WebhookEvent {
  PING                       // yalnızca POST .../test ile üretilir, gerçek bir olay değildir
  PAGE_PUBLISHED
  BLOG_POST_PUBLISHED
  BLOG_POST_UPDATED
  PRODUCT_CREATED
  PRODUCT_UPDATED
  PRODUCT_DELETED
  PORTFOLIO_ITEM_PUBLISHED
  ORDER_CREATED
  ORDER_PAID
  ORDER_STATUS_CHANGED
}

enum OutboundWebhookStatus {
  ACTIVE
  PAUSED     // admin elle duraklattı
  DISABLED   // sistem üst üste başarısızlık sonrası otomatik kapattı (§10.13.8)
}

enum WebhookDeliveryStatus {
  PENDING    // sıraya alındı, henüz denenmedi
  SENDING    // şu an gönderiliyor (çökme kurtarması bu durumu arar)
  RETRYING   // en az bir deneme başarısız, `nextAttemptAt` dolu
  SUCCEEDED  // 2xx alındı
  FAILED     // kalıcı hata VEYA deneme hakkı tükendi
}

model OutboundWebhook {
  id              String                @id @default(uuid())
  seq             Int                   @unique @default(autoincrement())
  name            String
  description     String?
  // SSRF doğrulamasından geçmiş mutlak https URL (§10.13.7). Şema seviyesinde
  // `String`'dir; kısıt uygulama katmanındadır (lib/ssrf-guard.ts) — DB'de ifade
  // edilemeyecek (DNS çözümlemesi gerektiren) bir kısıttır.
  url             String
  // AES-256-GCM ile ŞİFRELİ (lib/crypto.ts::encryptSecret) — HASH DEĞİL.
  // Gerekçe §10.13.9'da: HMAC imzası için secret'ın GERİ ÇÖZÜLEBİLİR olması
  // matematiksel bir zorunluluktur; hash'lenirse imza üretilemez.
  secretEncrypted String
  secretLast4     String
  // Postgres enum dizisi. Boş dizi YASAKTIR (en az 1 olay), uygulama katmanı zorlar.
  events          WebhookEvent[]
  status          OutboundWebhookStatus @default(ACTIVE)
  // Art arda başarısız gönderim sayacı; ilk başarılı gönderimde 0'a döner.
  // WEBHOOK_AUTO_DISABLE_THRESHOLD'a ulaşınca status = DISABLED (§10.13.8).
  consecutiveFailureCount Int           @default(0)
  autoDisabledAt  DateTime?
  lastTriggeredAt DateTime?
  lastSuccessAt   DateTime?
  lastFailureAt   DateTime?
  createdById     String?
  createdAt       DateTime              @default(now())
  updatedAt       DateTime              @updatedAt

  createdBy  User?             @relation("OutboundWebhookCreator", fields: [createdById], references: [id], onDelete: SetNull)
  deliveries WebhookDelivery[]

  @@index([status])
  @@index([createdById])
  @@map("outbound_webhooks")
}

model WebhookDelivery {
  id         String                @id @default(uuid())
  seq        Int                   @unique @default(autoincrement())   // cursor sayfalama
  webhookId  String
  event      WebhookEvent
  // Gönderilen JSON gövdenin TAMAMI (zarf dahil, §10.13.9) — yeniden denemede
  // BİREBİR AYNI baytlar gönderilir; olay anındaki durum yeniden hesaplanmaz.
  payload    Json
  // Alıcının idempotency anahtarı olarak kullandığı değer `id`'dir; ayrı bir
  // `eventId` kolonu AÇILMADI (ikinci bir kimlik kavramı gereksiz).
  status     WebhookDeliveryStatus @default(PENDING)
  attemptCount Int                 @default(0)
  maxAttempts  Int                 @default(5)
  nextAttemptAt DateTime?          // dolu ve status IN (PENDING, RETRYING) ise sweeper alır
  responseStatus     Int?
  // Alıcı yanıtının İLK 512 karakteri (uygulama katmanında kesilir). Tam gövde
  // ASLA saklanmaz — alıcı hata sayfasında kendi iç bilgisini sızdırabilir.
  responseBodySnippet String?
  // Makine-okunur hata sınıfı: "timeout" | "dns_failure" | "connection_refused" |
  // "tls_error" | "redirect_not_followed" | "ssrf_blocked" | "http_error" | "unknown"
  errorCode  String?
  errorMessage String?
  durationMs Int?
  // Payload kişisel veri içeriyor mu (ORDER_* olayları: müşteri e-postası/adı).
  // `ExportJob.containsPii` ile AYNI amaç ve AYNI saklama mantığı (§10.13.10).
  containsPii Boolean              @default(false)
  // Elle yeniden gönderimde (redeliver) kaynak kaydın id'si — denetim izi.
  redeliveryOfId String?
  firstAttemptAt DateTime?
  lastAttemptAt  DateTime?
  deliveredAt    DateTime?
  createdAt      DateTime          @default(now())

  webhook OutboundWebhook @relation(fields: [webhookId], references: [id], onDelete: Cascade)

  // Delivery log listesi HER ZAMAN tek bir webhook kapsamında ve `seq desc`
  // sıralıdır — bu bileşik indeks o sorgunun tamamını karşılar.
  @@index([webhookId, seq])
  // Sweeper'ın sıcak sorgusu: WHERE status IN (...) AND nextAttemptAt <= now().
  @@index([status, nextAttemptAt])
  @@map("webhook_deliveries")
}
```

`User` tarafına eklenecek karşı-ilişki alanları (Prisma zorunlu kılar):

```prisma
apiKeysCreated   ApiKey[]          @relation("ApiKeyCreator")
apiKeysRevoked   ApiKey[]          @relation("ApiKeyRevoker")
outboundWebhooks OutboundWebhook[] @relation("OutboundWebhookCreator")
```

Bilinçli olarak YAPILMAYANLAR (db-agent bunları "eksik" sanmasın):

- **`WebhookDelivery.events` üzerinde GIN indeksi YOK.** Emisyon sorgusu
  (`status = ACTIVE AND events has :event`) en fazla 20 satırlık bir tabloda çalışır
  (§10.13.8 üst sınırı); `@@index([status])` + bellekte filtreleme yeterlidir. GIN'in
  yazma maliyeti bu ölçekte gereksizdir.
- **`ApiKey` için organizasyon/site FK'sı YOK.** Bu sistem site-genelidir
  (`SiteSettings`/`SiteModule` ile aynı kapsam), org bazlı DEĞİLDİR — `SiteRole`
  ekseninde yönetilir.
- **`WebhookDeliveryAttempt` gibi ayrı bir deneme tablosu YOK.** Bir gönderimin
  denemeleri `attemptCount`/`lastAttemptAt`/`responseStatus` ile özetlenir;
  `ImportJobError` deseninin (satır-başına hata) buradaki karşılığı yoktur, çünkü
  bir gönderim ya bütünüyle başarılıdır ya değildir (`ExportJob` ile aynı gerekçe).

#### 10.13.3 API anahtarı formatı ve hash'leme (security-agent — bağlayıcı kontrat)

**Ham anahtar formatı (değişmez):**

```
cmsk_<prefix>_<secret>
      12 hex    64 hex
```

Örnek: `cmsk_7f3ka9dm2q0x_4b1e…` (toplam 82 karakter).
Parse regex'i: `^cmsk_([0-9a-f]{12})_([0-9a-f]{64})$`.

Kararların gerekçeleri:

- **`cmsk_` sabit ön eki** — sızıntı taraması içindir. GitHub/GitLab push protection
  ve `gitleaks` gibi araçlar ancak ayırt edici, sabit bir ön ek varsa bir dizeyi
  "kimlik bilgisi" olarak tanıyabilir. Rastgele bir base64 dizesi taranamaz.
- **Hex, base64url DEĞİL** — base64url alfabesi `_` içerir; ayırıcı olarak `_`
  kullanan bir formatta parse belirsizleşirdi. Hex'in %33 uzunluk maliyeti, makine
  tarafından taşınan bir kimlik bilgisinde önemsizdir.
- **İki parçalı yapı (prefix + secret)** — doğrulama `WHERE keyPrefix = ?` ile TEK bir
  unique indeks aramasıdır. Tek parçalı bir anahtarda ya tüm satırlar taranır ya da
  hash'in kendisi aranır; ikincisi mümkündür ama prefix ayrıca **admin panelinde
  gösterilebilir bir tanıtıcı** sağlar (hangi anahtarın kullanıldığı, secret'ı ifşa
  etmeden loglardan/listeden okunabilir).
- **`secret` = `crypto.randomBytes(32)`** — 256 bit entropi.

**Hash'leme: `sha256(rawKey)` (hex), `lib/tokens.ts::hashToken` YENİDEN KULLANILIR.**
Argon2/bcrypt gibi yavaş bir KDF **bilinçli olarak KULLANILMAZ.** Gerekçe (security-agent
bunu bir bulgu olarak değil, kayda geçmiş bir karar olarak değerlendirmelidir):

1. KDF'lerin varlık sebebi **düşük entropili** insan şifrelerini kaba kuvvete karşı
   yavaşlatmaktır. Burada sır 256 bit **rastgeledir**; ön-görüntü araması sha256 ile
   de argon2 ile de hesaplama olarak imkânsızdır. Yavaşlatmanın kazandırdığı güvenlik
   sıfırdır.
2. Buna karşılık maliyet gerçektir: doğrulama **her public API isteğinde** çalışır.
   Argon2 (~100 ms) her isteğe eklenirse bu, kendi başına bir DoS vektörüdür.
3. Projede emsal zaten budur: `RefreshToken` ve `PasswordResetToken` de `hashToken`
   (sha256) kullanır. Üçüncü bir yaklaşım tutarsızlık üretirdi.

**`lib/crypto.ts::encryptSecret` API anahtarı için KULLANILMAZ** — geri
döndürülebilirdir; API anahtarının hiçbir senaryoda geri okunması gerekmez, dolayısıyla
geri döndürülebilir saklama gereksiz bir risktir.

**Tek seferlik gösterim:** ham anahtar YALNIZCA `POST /admin/settings/api-keys` (201)
yanıtında `plainKey` alanında döner. Başka HİÇBİR uç bu değeri dönmez; loglanmaz
(`app.ts` redact listesine `plainKey` ve `plainSecret` EKLENİR); audit `metadata`'sına
yazılmaz.

#### 10.13.4 Public API kimlik doğrulama — `X-Api-Key` (bağlayıcı)

**Header kararı: `X-Api-Key: cmsk_…` — TEK kabul edilen biçim.**
`Authorization: Bearer <key>` **KABUL EDİLMEZ** (ne birincil ne de geriye uyumluluk
biçimi olarak). Gerekçe, estetik değil güvenliktir:

- Admin API'si `Authorization: Bearer <JWT>` kullanır. Aynı header'ı iki farklı
  kimlik bilgisi türü için kullanmak, yanlış doğrulayıcının yanlış tokeni ayrıştırmaya
  çalıştığı kod yollarına kapı açar. Ayrı header ile bu **yapısal olarak imkânsızdır**:
  `/public/*`'a gönderilen bir admin JWT'si sert 401'dir, `/admin/*`'a gönderilen bir
  API anahtarı da sert 401'dir. Karışma yüzeyi sıfırdır.
- Header adı kimlik bilgisi türünü kendi başına belli eder; proxy/log/destek
  akışlarında teşhis kolaylaşır.

**Doğrulama akışı** (`middleware/api-key-auth.ts`, `preHandler`):

1. `X-Api-Key` yoksa/formata uymuyorsa → `401 UNAUTHORIZED`. **Hata mesajı ayrım
   yapmaz** ("Geçersiz veya eksik API anahtarı.") — "anahtar yok" ile "anahtar yanlış"
   ayrımı numaralandırma bilgisi sızdırır.
2. `keyPrefix` ile satır bulunur; bulunmazsa → 401.
3. `hashToken(rawKey)` ile `keyHash` **`crypto.timingSafeEqual`** kullanılarak
   karşılaştırılır (düz `===` YASAK — zamanlama sızıntısı).
4. `status !== ACTIVE` → 401. `expiresAt` geçmişte → 401.
5. Scope kontrolü: rota `requiredScope` (varsayılan `READ`) belirtir; anahtarın scope'u
   yetmiyorsa → `403 FORBIDDEN`. v1'de tüm public uçlar `READ` ister, dolayısıyla
   `READ_WRITE` anahtar da geçer; **ama kontrol hattı ŞİMDİDEN vardır** (kullanıcı
   gereksinimi) — ileride yazma ucu eklendiğinde `requiredScope: "READ_WRITE"` yazmak
   yeterli olur.
6. `request.apiKey = { id, name, scope }` set edilir. **`request.user` ASLA set
   edilmez** — API anahtarı bir kullanıcı DEĞİLDİR; `requireSiteRole` gibi
   kullanıcı-temelli guard'ların bir API anahtarıyla yanlışlıkla geçmesi bu sayede
   imkânsızdır.
7. `lastUsedAt`/`lastUsedIp` güncellemesi **kısıtlıdır**: yalnızca `lastUsedAt` boşsa
   veya `API_KEY_LAST_USED_THROTTLE_MS` (60 sn) geçmişse yazılır, `void` ile
   fire-and-forget çalışır ve hatası isteği DÜŞÜRMEZ (`logAudit` deseni). Aksi hâlde
   her okuma isteği bir yazma isteği doğururdu.

**Doğrulama cache'i:** `lib/api-key.ts` içinde süreç-içi, TTL'li (30 sn) küçük bir
pozitif-sonuç cache'i tutulur (en fazla 500 giriş). **İptal/silme/güncelleme
anında cache girişi senkron olarak temizlenir** (`invalidateApiKeyCache(keyId)`) —
bu yüzden iptal edilmiş bir anahtarın 30 sn daha çalışması gibi bir pencere YOKTUR.
Tek instance varsayımı §10.8.1 ile aynıdır; çok-instance'a geçilirse bu cache Redis'e
taşınmalıdır (observability-agent/devops-agent notu).

**CORS:** public API **sunucudan-sunucuya** kullanım içindir. Mevcut global CORS
politikası (`origin: FRONTEND_URL`) DEĞİŞTİRİLMEZ; `/public/*` için `origin: "*"`
AÇILMAZ. Tarayıcı içi JavaScript'ten API anahtarı kullanmak anahtarı ifşa eder —
dokümantasyonda açık uyarı olarak yer alır.

#### 10.13.5 Public API yüzeyi — yalnızca GET, ayrı `Public*` DTO'ları

Prefix: `/api/v1/public/*`. **Tüm uçlar `GET`'tir**; v1'de yazma ucu YOKTUR.

| Uç | Açıklama |
|---|---|
| `GET /public/me` | Çağıran anahtarın kendi bilgisi (ad, scope, kalan kota) — entegrasyon teşhisi |
| `GET /public/pages` · `GET /public/pages/{slug}` | Yayındaki sayfalar |
| `GET /public/blog` · `GET /public/blog/{slug}` · `GET /public/blog/categories` | Yayındaki blog yazıları |
| `GET /public/products` · `GET /public/products/{slug}` · `GET /public/products/categories` | Yayındaki ürünler |
| `GET /public/portfolio` · `GET /public/portfolio/{slug}` · `GET /public/portfolio/categories` | Yayındaki portföy öğeleri |

Bağlayıcı davranış kuralları:

1. **Görünürlük filtresi sunucudadır ve atlanamaz:** her sorgu `status = PUBLISHED AND
   deletedAt IS NULL` ile başlar. `?status=`/`?trashed=` gibi parametreler bu katmanda
   **YOKTUR** (kabul edilmez, 422) — admin listelerindeki filtreler buraya
   KOPYALANMAZ. Taslak/çöp içeriğe erişim yolu bulunmamalıdır.
2. **Modül kapısı korunur:** `/public/products*` ve `/public/portfolio*`
   `requireModuleEnabled("products")` / `("portfolio")` guard'ını kullanır — modül
   kapalıysa `404` (mevcut public uçlarla BİREBİR aynı davranış, §10.9).
3. **Sayfalama:** cursor tabanlı, `?limit=` (varsayılan 20, en fazla **100**),
   `meta.nextCursor`. Portföy listesi manuel `order asc` ile sıralanır (§10.9.4 ile
   tutarlı), diğerleri `publishedAt desc, seq desc`.
4. **`?locale=`** mevcut public uçlarla BİREBİR aynı semantiktir (alan bazlı sessiz
   fallback; `Page.isLegalDocument` istisnası dahil, bkz. `LocaleQuery`).
5. **Statik rota önceliği:** `/public/blog/categories` ile `/public/blog/{slug}`
   çakışmaz — Fastify radix router statik segmenti parametreli olana tercih eder
   (`/admin/blog/categories` ile aynı, projede kanıtlanmış desen). Yine de `categories`
   slug'ı bir içerik için oluşturulamaz sayılmaz; slug ucu erişilemez olur — bu kabul
   edilmiş bir kısıttır.

**DTO kararı: public katman KENDİ `Public*` DTO'larını kullanır; `Page`/`BlogPost`/
`Product`/`PortfolioItem` şemaları YENİDEN KULLANILMAZ.** Bu, iki somut sebeple
yük taşıyan bir karardır:

1. **PII sızıntısı önlenir.** Mevcut `toPageDto`/`toBlogPostDto`/`toProductDto`/
   `toPortfolioItemDto` (bkz. `mappers/index.ts`) `author: UserSummary` döner ve
   `UserSummary` **personel e-posta adresini içerir**. Üçüncü parti bir entegratöre
   personel e-postası göndermek kabul edilemez. `Public*` DTO'ları katı bir
   **izin listesidir**; `author`, `authorId`, `seoScore`, `seoScoreIssues`,
   `deletedAt`, `viewCount`, `translations` (ham blob) ve `localizations` içermez.
2. **Kontrat dondurulur.** Admin DTO'ları iç refactor'larla evrilir; üçüncü parti
   sözleşmesi evrilemez. Ayrı şema, iç bir değişikliğin dış kontratı SESSİZCE
   kırmasını yapısal olarak engeller. Sapma bedeli (mapper tekrarı) bilinçli olarak
   kabul edilmiştir.

`Public*` DTO alanları için bkz. `openapi.yaml#/components/schemas/PublicPage` vb. ve
`shared-types.ts` §10.13 bölümü.

#### 10.13.6 Hız sınırlama — iki katman, atlanamaz taban (bağlayıcı)

Kullanıcı gereksinimi: "rate-limit bu yeni katmanda bypass edilemez olmalı". Bunu
sağlayan **iki bağımsız katman** tanımlanır. Tek katmanlı çözümler yetersizdir ve
sebebi kayda geçirilmelidir:

> `@fastify/rate-limit`'in `onRequest` hook'u **kök seviyede** kayıtlıdır ve
> `preHandler` tabanlı API anahtarı doğrulamasından **ÖNCE** çalışır. Bu yüzden
> route-level `config.rateLimit` içinde "doğrulanmış anahtar id'sine göre" kova
> üretmek MÜMKÜN DEĞİLDİR — o anda anahtar henüz doğrulanmamıştır. Header'dan
> okunan **doğrulanmamış** bir ön eke göre kova üretmek ise saldırganın her istekte
> rastgele bir ön ek göndererek sonsuz taze kova açmasına, yani sınırın tamamen
> atlanmasına yol açar. Bu tuzağa DÜŞÜLMEMELİDİR.

**Katman 1 — IP tabanı (atlanamaz).** `/public/*` rotalarında route-level
`config.rateLimit` **varsayılan keyGenerator ile** (yani IP ile) kullanılır. Hiçbir
header bu kovayı etkileyemez.

**Katman 2 — anahtar başına kota.** `lib/api-key-rate-limit.ts` içinde süreç-içi
kayan pencere sayacı; `api-key-auth` preHandler'ından **SONRA**, aynı kapsamda ikinci
bir `preHandler` olarak çalışır. Kova anahtarı **doğrulanmış `ApiKey.id`**'dir.
Doğrulanmamış/uydurma anahtar bu katmana hiç ulaşamaz (önce 401 alır) → kova
bölünmesiyle atlatma imkânsızdır.

`backend/src/lib/rate-limit.ts`'e eklenecek sabitler (isim ve değerler bağlayıcı;
backend-agent implementasyonu yapar, değerleri kendi başına değiştiremez):

| Sabit | Değer | Nerede |
|---|---|---|
| `PUBLIC_API_IP_RATE_LIMIT` | `{ max: 300, timeWindow: "1 minute" }` | `/public/*` route-level, IP kovası (Katman 1) |
| `PUBLIC_API_KEY_RATE_LIMIT` | `{ max: 120, timeWindow: "1 minute" }` | doğrulanmış `ApiKey.id` kovası (Katman 2) |
| `PUBLIC_API_KEY_BURST_RATE_LIMIT` | `{ max: 20, timeWindow: "1 second" }` | aynı kova, ani yük tavanı |
| `API_KEY_MANAGEMENT_RATE_LIMIT` | `{ max: 10, timeWindow: "1 minute" }` | `POST/PATCH/DELETE /admin/settings/api-keys*`, `.../revoke` |
| `WEBHOOK_MANAGEMENT_RATE_LIMIT` | `{ max: 20, timeWindow: "1 minute" }` | `POST/PATCH/DELETE /admin/settings/webhooks*` (her biri DNS çözümlemesi tetikler) |
| `WEBHOOK_TEST_RATE_LIMIT` | `{ max: 5, timeWindow: "1 minute" }` | `POST .../webhooks/{id}/test` — gerçek giden istek üretir, en güçlü kötüye kullanım vektörü |
| `WEBHOOK_REDELIVER_RATE_LIMIT` | `{ max: 10, timeWindow: "1 minute" }` | `POST .../deliveries/{id}/redeliver` |

Yanıt sözleşmesi: aşımda `429` + standart hata zarfı (`error.code: RATE_LIMITED`) +
`Retry-After`. `x-ratelimit-limit` / `x-ratelimit-remaining` / `x-ratelimit-reset`
header'ları her `/public/*` yanıtında döner ve **Katman 2'nin (anahtar kotası)
değerlerini taşır** — entegratör için anlamlı olan odur; Katman 1 sessiz bir tabandır.

Süreç-içi sayaç, projenin mevcut tek-instance varsayımıyla (§10.8.1) tutarlıdır.
Yatay ölçeklemeye geçilirse Katman 2 Redis'e taşınmalıdır — aksi hâlde efektif limit
instance sayısıyla çarpılır (devops-agent/performance-agent notu).

#### 10.13.7 SSRF önleme — katmanlı, teslimat anında yeniden doğrulanan (bağlayıcı)

Webhook URL'i, admin tarafından girilen ve sunucumuzun **bağlantı kuracağı** bir
adrestir; bu tanım gereği bir SSRF yüzeyidir. `lib/ssrf-guard.ts` aşağıdaki kontrolleri
**HEM oluşturma/güncelleme anında HEM DE her teslimat denemesinde** uygular.

**A. Sözdizimsel kontroller (URL parse sonrası):**

1. Şema **yalnızca `https:`**. `http:` HİÇBİR ortamda kabul edilmez — geliştirme
   istisnası da YOKTUR ("dev'de gevşet" kalıbı, üretimde unutulan bayrakların klasik
   kaynağıdır). Yerel test için tünel servisi (ngrok vb.) kullanılır.
2. URL'de kimlik bilgisi (`https://user:pass@host/...`) → RED.
3. Port **yalnızca 443** (belirtilmemiş veya açıkça `:443`). Diğer tüm portlar → RED.
   Gerçek webhook alıcıları (Zapier, Make, n8n, müşteri API gateway'leri) istisnasız
   443 üzerindedir; keyfi port izni, iç servis port taramasının doğrudan yoludur.
4. Host **literal IP OLAMAZ** (ne IPv4 ne IPv6, ne de `[::ffff:127.0.0.1]` gibi
   sarmalanmış biçimler) → RED. Meşru bir webhook hedefi DNS adıdır. Bu tek kural,
   basit SSRF yüklerinin büyük çoğunluğunu eler.
5. Host adı **çok etiketli ve public bir DNS adı** olmalıdır. RED listesi: tek
   etiketli adlar (nokta içermeyen), `localhost`, `*.localhost`, `*.local`,
   `*.internal`, `*.intranet`, `*.lan`, `*.home.arpa`, `*.cluster.local`.
6. Uzunluk sınırı: URL en fazla 2048 karakter.

**B. Ağ katmanı kontrolleri (DNS çözümlemesi):**

Host `dns.lookup(host, { all: true, verbatim: true })` ile çözülür. **Dönen TÜM
adreslerin** her biri public unicast olmalıdır; **bir tanesi bile** aşağıdaki
aralıklara düşerse istek reddedilir (kısmen-geçerli diye kabul edilmez):

- IPv4: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10` (CGNAT), `127.0.0.0/8`,
  `169.254.0.0/16` (**bulut metadata `169.254.169.254` dahil**), `172.16.0.0/12`,
  `192.0.0.0/24`, `192.0.2.0/24`, `192.88.99.0/24`, `192.168.0.0/16`,
  `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4` (multicast),
  `240.0.0.0/4` (reserved), `255.255.255.255/32`.
- IPv6: `::/128`, `::1/128`, `fc00::/7` (ULA), `fe80::/10` (link-local),
  `ff00::/8` (multicast).
- **Sarmalanmış IPv4 açılır ve YENİDEN kontrol edilir:** `::ffff:0:0/96`
  (IPv4-mapped), `64:ff9b::/96` (NAT64), `2002::/16` (6to4 — gömülü IPv4 çıkarılır).
  Bu adım atlanırsa `::ffff:127.0.0.1` gibi bir kayıt kontrolü delip geçer.

Çözümleme başarısızsa (NXDOMAIN/timeout) → RED (`errorCode: "dns_failure"`).

**C. DNS rebinding (TOCTOU) — asıl zor kısım, çözüm PINLEME:**

Oluşturma anındaki doğrulama **tek başına yetersizdir**: saldırgan, doğrulama
sırasında public bir IP, teslimat sırasında `127.0.0.1` döndüren kısa TTL'li bir DNS
kaydı kullanabilir. Bağlayıcı çözüm:

1. Her teslimat denemesinde host **yeniden** çözülür ve B'deki kontroller **yeniden**
   uygulanır.
2. Geçen adreslerden biri seçilir ve **HTTP isteği o IP'ye PİNLENİR**: `undici`
   `Agent`'ına özel bir `connect.lookup` verilir; bu fonksiyon **yalnızca doğrulanmış
   IP'yi** döner ve işletim sistemi çözümleyicisine **ikinci kez başvurulmaz**.
   `Host` header'ı ve TLS SNI/sertifika doğrulaması **orijinal host adıyla** yapılmaya
   devam eder (aksi hâlde TLS kırılır ve MITM'e kapı açılır).
3. **Yönlendirmeler (3xx) TAKİP EDİLMEZ** — `maxRedirects: 0`. Bir 3xx yanıtı
   `FAILED` + `errorCode: "redirect_not_followed"` olarak kaydedilir ve **yeniden
   denenmez**. Yönlendirme takibi, doğrulanmamış bir hedefe bağlanmanın en kısa
   yoludur; pinlemeyi tamamen anlamsız kılar.
4. **Proxy ortam değişkenleri (`HTTP_PROXY`/`HTTPS_PROXY`) onurlandırılmaz** — bir
   proxy, pinlemeyi atlatır.
5. Zaman aşımları: bağlantı **5 sn**, toplam **10 sn** (`WEBHOOK_REQUEST_TIMEOUT_MS`).
   Yanıt gövdesi okuması **8 KiB** ile sınırlıdır (yavaş/devasa yanıt bir DoS
   vektörüdür); saklanan snippet ilk 512 karakterdir.

**D. Denetim:** URL reddi audit'e `outbound_webhook.url_rejected` +
`status: FORBIDDEN` olarak yazılır (`metadata: { host, reason }` — **çözülen IP
YAZILMAZ**, iç ağ topolojisini audit loguna sızdırmamak için). Oluşturma/güncelleme/
silme/secret rotasyonu/test aksiyonları da `outbound_webhook.*` ile denetlenir.

**E. Üst sınır:** site genelinde en fazla **20** webhook tanımlanabilir
(`WEBHOOK_MAX_COUNT = 20`); aşımda `409 CONFLICT`. Tek bir olayın 20'den fazla giden
istek doğurmasını ve tabloların sınırsız büyümesini engeller.

#### 10.13.8 Teslimat, yeniden deneme ve delivery log

**Emisyon (`lib/webhook-emitter.ts::emitWebhookEvent`) — TEK giriş noktası.** Route/
service katmanı doğrudan `WebhookDelivery` satırı OLUŞTURMAZ; her zaman bu fonksiyonu
çağırır. Bağlayıcı kurallar:

- Emisyon **transaction COMMIT'inden SONRA** yapılır. Transaction içinde yapılırsa
  geri alınan bir işlem için webhook gitmiş olabilir.
- Emisyon **asıl isteği ASLA düşürmez** — `logAudit` ile aynı desen (`try/catch`,
  hata yalnızca loglanır).
- O olaya abone **`ACTIVE`** webhook yoksa hiçbir satır yazılmaz (sıfır maliyet).
- Abone her webhook için bir `WebhookDelivery` satırı: `status: PENDING`,
  `nextAttemptAt: now()`.

Emisyon noktaları (backend-agent tahmin yürütmez):

| Olay | Nereden |
|---|---|
| `PAGE_PUBLISHED` | `pages.routes.ts` PATCH/bulk **ve** `lib/scheduled-publish.ts` sweeper'ı |
| `BLOG_POST_PUBLISHED` | `blog.routes.ts` PATCH/bulk **ve** blog yayın zamanlayıcısı |
| `BLOG_POST_UPDATED` | `blog.routes.ts` PATCH — yayındaki bir yazının içeriği değiştiğinde |
| `PRODUCT_CREATED` / `PRODUCT_UPDATED` / `PRODUCT_DELETED` | `products.routes.ts` (DELETED = kalıcı silme) |
| `PORTFOLIO_ITEM_PUBLISHED` | `portfolio.routes.ts` PATCH/bulk |
| `ORDER_CREATED` | `checkout.routes.ts` (session açıldığında) |
| `ORDER_PAID` | `webhooks/stripe.routes.ts` (sipariş `PAID`'e geçtikten sonra) |
| `ORDER_STATUS_CHANGED` | `orders.routes.ts` status PATCH + refund |
| `PING` | `POST /admin/settings/webhooks/{id}/test` |

**Bağlayıcı kural: `*_PUBLISHED` olayları YALNIZCA duruma GEÇİŞTE tetiklenir**
(`DRAFT`/`SCHEDULED` → `PUBLISHED`). Zaten yayında olan bir içeriğin tekrar
kaydedilmesi `*_PUBLISHED` üretmez (bunun için `*_UPDATED` vardır). Bu kolayca
yanlış yapılan bir ayrımdır; qa-agent bunu test etmelidir.

**Dispatcher (`outbound-webhooks.dispatcher.ts`) — süreç-içi, kuyruk YOK.** §10.8.1'de
kurulan desenin aynısı:

- `setInterval` ile her **15 sn**'de bir tarama: `status IN (PENDING, RETRYING) AND
  nextAttemptAt <= now()`, `take: 20`, `orderBy: nextAttemptAt asc`.
- Satır alınırken `status: SENDING` + `lastAttemptAt` yazılır (aynı satırın iki kez
  işlenmesini önler).
- Eşzamanlılık tavanı **5** (`WEBHOOK_DISPATCH_CONCURRENCY`).
- `onReady` kurtarması ZORUNLU: `SENDING`'de kalmış satırlar `RETRYING`'e çevrilir ve
  `nextAttemptAt: now()` yapılır (çökme/restart sonrası asılı kalmasın).
- `onClose` ile interval temizlenir.

**Yeniden deneme politikası:**

| Sonuç | Davranış |
|---|---|
| `2xx` | `SUCCEEDED`, `deliveredAt` yazılır, webhook'un `consecutiveFailureCount` **0**'lanır |
| `3xx` | `FAILED` — **yeniden denenmez** (`redirect_not_followed`, §10.13.7-C3) |
| `408`, `429`, `5xx` | Yeniden denenir |
| Diğer `4xx` | `FAILED` — yeniden denenmez (kalıcı istemci hatası; alıcının URL'i yanlış) |
| Ağ hatası / timeout / DNS hatası / TLS hatası | Yeniden denenir |
| SSRF reddi | `FAILED` — **yeniden denenmez** (`ssrf_blocked`) |

`maxAttempts = 5` (1 ilk deneme + 4 yeniden deneme). Gecikme tablosu
`WEBHOOK_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000]` (30 sn → 2 dk →
10 dk → 60 dk; toplam pencere ~72 dk). Üzerine **eşit jitter** uygulanır:
`gecikme = base/2 + random(0, base/2)` — aynı anda başarısız olan çok sayıda
gönderimin alıcıya senkronize dalga hâlinde geri dönmesini (thundering herd)
engeller. Hak tükendiğinde `status: FAILED` ve `consecutiveFailureCount++`.

**Otomatik kapatma:** `consecutiveFailureCount >= WEBHOOK_AUTO_DISABLE_THRESHOLD (20)`
olduğunda webhook `status: DISABLED`, `autoDisabledAt: now()` yapılır ve
`outbound_webhook.auto_disabled` audit kaydı yazılır. Yeniden etkinleştirme
**ELLEdir** (`PATCH … { status: "ACTIVE" }`) ve sayacı sıfırlar. Ölü bir uç noktaya
sonsuza dek istek atmak hem bizim hem alıcının kaynağını yakar.

**Delivery log (`GET .../deliveries`):** cursor sayfalı, `seq desc`. Detay ucu
`payload` + `responseBodySnippet` döner. Elle yeniden gönderim
(`POST .../deliveries/{id}/redeliver`) **yeni bir satır oluşturur**
(`redeliveryOfId` ile kaynağa bağlı); mevcut satırın sayaçları değiştirilmez —
denetim izi değişmez kalmalıdır.

**Budama (`outbound-webhooks.retention.ts`,** `import.retention.ts` **ile AYNI desen):**

| Sabit | Değer | Etki |
|---|---|---|
| `WEBHOOK_DELIVERY_KEEP_PER_HOOK` | `100` | Webhook başına en yeni 100 kayıt tutulur, fazlası silinir ("son N gönderim" gereksinimi) |
| `WEBHOOK_DELIVERY_RETENTION_MS` | `30 gün` | Yaş tavanı — 100'e ulaşmayan webhook'larda da log sonsuza kadar durmaz |
| `WEBHOOK_DELIVERY_PII_REDACT_MS` | `7 gün` | `containsPii: true` kayıtlarda `payload` → `{"redacted": true}` (§10.13.10) |

Redaksiyon penceresi (7 gün) yeniden deneme penceresinden (~72 dk) çok daha uzundur;
budama bir retry'ı asla bozmaz.

#### 10.13.9 HMAC imza formatı (bağlayıcı — alıcı bu sözleşmeye göre doğrular)

**Secret formatı:** `whsec_` + 32 rastgele byte'ın hex'i (64 karakter) →
`whsec_<64hex>`. Yalnızca oluşturma (`POST /admin/settings/webhooks`, 201) ve
rotasyon (`POST .../rotate-secret`) yanıtlarında `plainSecret` olarak **bir kez**
döner.

**Saklama: `lib/crypto.ts::encryptSecret` (AES-256-GCM) — HASH DEĞİL.** Bu, kullanıcı
gereksinimindeki "hash'lenerek saklanmalı" ifadesinden **bilinçli bir sapmadır** ve
mimar tarafından hakemlik edilmiştir: HMAC imzası üretmek için secret'ın **düz metin
hâline sunucunun her gönderimde ihtiyacı vardır**. Hash tek yönlüdür; hash'lenmiş bir
secret ile imza üretmek matematiksel olarak imkânsızdır. Gereksinimin **amacı**
("düz metin asla DB'de durmasın") AES-256-GCM ile tam olarak karşılanır; emsal
projede zaten mevcuttur (`User.twoFactorSecret`, §10.4). API anahtarı için ise gerçek
hash kullanılır (§10.13.3) — çünkü orada geri okuma ihtiyacı yoktur. security-agent
bu iki farklı yaklaşımı bir tutarsızlık olarak değil, "geri okunması gerekiyor mu?"
sorusuna verilen doğru iki farklı cevap olarak değerlendirmelidir.

**Giden istek:**

```
POST <webhook.url>
Content-Type: application/json
User-Agent: CMS-Webhook/1.0
X-Webhook-Id:        <OutboundWebhook.id>
X-Webhook-Delivery:  <WebhookDelivery.id>      # alıcının idempotency anahtarı
X-Webhook-Event:     <WebhookEvent>            # ör. BLOG_POST_PUBLISHED
X-Webhook-Timestamp: <unix saniye>
X-Webhook-Attempt:   <1..5>
X-Webhook-Signature: sha256=<hex>
```

**İmzalanan dize (bağlayıcı):**

```
signedPayload = `${timestamp}.${rawBody}`
signature     = HMAC_SHA256(secret, signedPayload)  →  lowercase hex
header        = `sha256=${signature}`
```

Kritik uygulama notları:

- `rawBody`, gövdenin **gönderilen baytlarıyla BİREBİR aynı** dize olmalıdır.
  Dispatcher `JSON.stringify` **bir kez** çağırır, aynı dizeyi hem imzalar hem
  gönderir. İki kez serileştirmek (anahtar sırası/boşluk farkı) imzayı sessizce
  geçersiz kılar — bu, bu tür sistemlerdeki bir numaralı hatadır.
- **`timestamp` imzanın İÇİNDEDİR** (başına eklenmiştir). Yalnızca gövdeyi imzalamak
  replay saldırısına açıktır. Alıcı, `|now - timestamp| > 300 sn` ise isteği
  reddetmelidir; bu, dokümantasyonda alıcıya verilen bağlayıcı tavsiyedir.
- `sha256=` ön eki, ileride algoritma değiştirilebilsin diye vardır (alıcı ön eke
  bakarak ayrıştırır) — çıplak hex GÖNDERİLMEZ.
- Yeniden denemelerde **aynı `X-Webhook-Delivery` ve aynı gövde** gönderilir;
  `X-Webhook-Timestamp` ve dolayısıyla imza HER DENEMEDE YENİLENİR (aksi hâlde 3.
  denemede alıcının 300 sn'lik replay penceresi dolmuş olurdu).
- Alıcı karşılaştırmayı **sabit zamanlı** yapmalıdır; bu da dokümantasyonda belirtilir.

**Payload zarfı (tüm olaylarda aynı):**

```json
{
  "id": "9f1c…",                         // = WebhookDelivery.id
  "event": "BLOG_POST_PUBLISHED",
  "apiVersion": "v1",
  "createdAt": "2026-08-16T10:00:00.000Z",
  "data": { }
}
```

`data` alanının şekli **public API DTO'larıyla AYNIDIR** (`PublicPage`,
`PublicBlogPost`, `PublicProduct`, `PublicPortfolioItem`) — tek bir dış kontrat,
sıfır sapma. İstisnalar:

- `ORDER_*` olaylarında `data` = `WebhookOrderPayload` (public API'de sipariş ucu
  yoktur; sipariş webhook'unun tüm anlamı müşteri/tutar bilgisini taşımaktır).
  Bu payload `customerEmail` içerir → `WebhookDelivery.containsPii = true`.
- `PRODUCT_DELETED` olayında `data` = `{ "id": "…", "slug": "…" }` (kaynak artık
  yoktur, tam DTO üretilemez).
- `PING` olayında `data` = `{ "message": "ping", "webhookId": "…" }`.

#### 10.13.10 Uç noktalar, yetki eşikleri ve compliance notları

**Yetki: `/admin/settings/api-keys*` ve `/admin/settings/webhooks*` altındaki TÜM
uçlar İSTİSNASIZ yalnızca `SiteRole=ADMIN`'dir** — okuma dahil. MANAGER/EDITOR/CUSTOMER/USER → 403 (§10.21: kimlik bilgisi yüzeyi, MANAGER'a da kapalıdır).
Gerekçe: bir API anahtarı listesi (adlar, ön ekler, scope'lar) saldırı yüzeyi
haritasıdır; bir webhook listesi ise dış entegrasyon topolojisidir. `Appearance`
tag'indeki "EDITOR bilinçli olarak dışarıda" kararıyla aynı çizgide, ama burada
**okuma da** kapsam dışıdır (Appearance'ta okuma authenticated'dır) — çünkü orada
sızan bilgi renk/font, burada kimlik bilgisi metadatasıdır.

| Grup | Uç | Not |
|---|---|---|
| ApiKeys | `GET /admin/settings/api-keys` | Cursor listesi; `plainKey` ASLA dönmez |
| ApiKeys | `POST /admin/settings/api-keys` | **201** + `plainKey` (tek sefer) |
| ApiKeys | `PATCH /admin/settings/api-keys/{keyId}` | `name`/`description`/`scope`/`expiresAt` |
| ApiKeys | `POST /admin/settings/api-keys/{keyId}/revoke` | Soft — `status: REVOKED`, kayıt kalır (denetim izi) |
| ApiKeys | `DELETE /admin/settings/api-keys/{keyId}` | **204**, kalıcı silme |
| OutboundWebhooks | `GET /admin/settings/webhooks/events` | Statik olay kayıt defteri (etiket + açıklama) — frontend olay listesini HARDCODE ETMEZ |
| OutboundWebhooks | `GET`/`POST /admin/settings/webhooks` | POST **201** + `plainSecret` (tek sefer) |
| OutboundWebhooks | `GET`/`PATCH`/`DELETE /admin/settings/webhooks/{webhookId}` | DELETE **204**, delivery'ler cascade silinir |
| OutboundWebhooks | `POST /admin/settings/webhooks/{webhookId}/rotate-secret` | Yeni `plainSecret` (tek sefer) |
| OutboundWebhooks | `POST /admin/settings/webhooks/{webhookId}/test` | **202** + `deliveryId`; `PING` olayı kuyruklar |
| OutboundWebhooks | `GET /admin/settings/webhooks/{webhookId}/deliveries` | Cursor listesi, `?status=` filtresi |
| OutboundWebhooks | `GET .../deliveries/{deliveryId}` | `payload` + `responseBodySnippet` |
| OutboundWebhooks | `POST .../deliveries/{deliveryId}/redeliver` | **202**, YENİ satır üretir |
| PublicApi | `GET /public/*` | `X-Api-Key`, salt-okunur (§10.13.5) |

**Audit aksiyon adları (bağlayıcı, `logAudit` ile):** `api_key.create`,
`api_key.update`, `api_key.revoke`, `api_key.delete`, `outbound_webhook.create`,
`outbound_webhook.update`, `outbound_webhook.delete`, `outbound_webhook.rotate_secret`,
`outbound_webhook.test`, `outbound_webhook.redeliver`, `outbound_webhook.auto_disabled`,
`outbound_webhook.url_rejected`. **`metadata`'ya ASLA `plainKey`/`plainSecret`/ham URL
kimlik bilgisi yazılmaz** (`lib/audit.ts` kuralı).

**Public API çağrıları audit'e YAZILMAZ.** Yüksek hacimli okuma trafiğidir; her GET
için bir `AuditLog` satırı tabloyu boğar ve gerçek hassas aksiyonların görünürlüğünü
azaltır. İzlenebilirlik `ApiKey.lastUsedAt`/`lastUsedIp` + normal erişim logları
üzerinden sağlanır (observability-agent bu katman için ayrı bir metrik/alert
tanımlayabilir).

**compliance-agent için açık maddeler (değerlendirilmesi gerekenler, karar onların):**

1. `WebhookDelivery.payload` — `ORDER_*` olaylarında müşteri e-postası/adı içerir
   (`containsPii: true`). Önerilen saklama: 7 gün sonra payload redaksiyonu, 30 gün
   sonra satırın tamamen silinmesi (§10.13.8). §10.8.8.1/§10.8.10'daki "progressive
   redaction" ilkesiyle tutarlı olacak şekilde tasarlanmıştır.
2. `ApiKey.lastUsedIp` — **maskelenmiş** saklanır (`lib/pii-mask.ts::maskIp`); ham IP
   DB'ye yazılmaz. Amaç sızmış anahtar tespiti; veri minimizasyonu gözetilmiştir.
3. **Veri dışa aktarımı yeni bir alıcı yaratır:** webhook, kişisel veriyi üçüncü bir
   tarafa AKTARIR. Aydınlatma metni/veri işleyen envanteri açısından
   değerlendirilmelidir — bu teknik bir karar değil, uyum kararıdır.

**qa-agent için kritik akışlar:** (a) iptal edilmiş anahtarla 401, (b) süresi dolmuş
anahtarla 401, (c) `READ` anahtarın scope korumalı uca 403'ü, (d) taslak/çöp içeriğin
public API'de görünmemesi, (e) anahtar kotası aşımında 429, (f) `http://`,
literal IP, `localhost`, `169.254.169.254`'e çözülen host ve 443 dışı port için
webhook oluşturmanın reddi, (g) 5xx sonrası backoff ile yeniden deneme ve 5. denemede
`FAILED`, (h) HMAC imzasının bilinen bir vektörle doğrulanması, (i) `*_PUBLISHED`
olayının zaten yayındaki içerik tekrar kaydedilince tetiklenmemesi.

#### 10.13.11 Entegratör Hızlı Başlangıç — Public API (documentation-agent — kullanım örneği)

> Bu alt bölüm §10.13.1–10.13.10'daki **bağlayıcı** kontratın üzerine
> documentation-agent tarafından eklenmiş bir kullanım kılavuzudur; hiçbir yeni
> tasarım kararı İÇERMEZ/DEĞİŞTİRMEZ. Çelişki hâlinde yukarıdaki alt bölümler ve
> `openapi.yaml` (`PublicApi` tag'i) kazanır. Hedef kitle: `/api/v1/public/*`
> katmanını üçüncü bir sistemden (Zapier/Make/n8n, özel entegrasyon vb.)
> tüketecek geliştiriciler.

**1. API anahtarı alın.** Admin panel → Ayarlar → API Anahtarları → "Yeni Anahtar"
(yalnızca `SiteRole=ADMIN` görür/oluşturur). Oluşturulan ham anahtar (`plainKey`,
`cmsk_<12hex>_<64hex>`, 82 karakter) **yalnızca bu ekranda, bir kez** gösterilir;
kaybederseniz eskisini iptal edip yenisini üretmeniz gerekir (§10.13.3). Anahtarı
bir sır yöneticisinde/ortam değişkeninde saklayın — panelde ikinci kez gösterilmez.

**2. İsteği gönderin.** Kimlik doğrulama `X-Api-Key` header'ı iledir;
`Authorization: Bearer <key>` **kabul edilmez** (§10.13.4):

```bash
curl "https://api.example.com/api/v1/public/blog?limit=10" \
  -H "X-Api-Key: cmsk_7f3ka9dm2q0x_4b1e...<64hex daha>"
```

**3. Yanıt zarfı ve sayfalama.** Tüm liste uçları aynı zarfı ve cursor sayfalama
sözleşmesini kullanır:

```json
{
  "data": [
    { "id": "5e4d3c2b-...", "title": "Yeni Ürün Lansmanı", "slug": "yeni-urun-lansmani", "...": "..." }
  ],
  "meta": { "nextCursor": "eyJzZXEiOjEyM30" }
}
```

`meta.nextCursor` doluysa bir sonraki sayfa `?cursor=<değer>` ile istenir; `null`
ise son sayfadasınızdır. `?limit=` varsayılan 20, en fazla 100.

**4. Hız sınırı.** Her `/public/*` yanıtı anahtar-başına kota durumunu
(§10.13.6 Katman 2) header'da taşır:

```
x-ratelimit-limit: 120
x-ratelimit-remaining: 118
x-ratelimit-reset: 42
```

Aşımda `429 RATE_LIMITED` + `Retry-After` döner. Kendi anahtarınızın anlık kota
durumunu ayrıca `GET /api/v1/public/me` ile de sorgulayabilirsiniz (aynı zamanda
"anahtarım/scope'um doğru mu?" teşhisi için kullanışlıdır).

**5. Hata kodları.**

| HTTP | `error.code` | Anlamı |
|---|---|---|
| 401 | `UNAUTHORIZED` | Anahtar eksik / geçersiz / iptal edilmiş / süresi dolmuş — mesaj ayrım YAPMAZ (§10.13.4) |
| 403 | `FORBIDDEN` | Anahtarın scope'u yetersiz (v1'de fiilen görülmez — tüm public uçlar `READ` ister, `READ_WRITE` da geçer) |
| 404 | `NOT_FOUND` | Kayıt yok VEYA yayında değil — taslak/çöp içeriğin varlığı bile sızdırılmaz |
| 422 | `VALIDATION_ERROR` | Sorgu parametresi geçersiz (ör. `limit > 100`) |
| 429 | `RATE_LIMITED` | Kota aşıldı — `Retry-After` header'ına göre yeniden deneyin |

**6. Uç noktalar (özet — tam şema `openapi.yaml`'da `PublicApi` tag'i altında):**

| Uç | Not |
|---|---|
| `GET /public/me` | Anahtarınızın adı, scope'u, anlık kota durumu |
| `GET /public/pages` · `GET /public/pages/{slug}` | Yayındaki sayfalar |
| `GET /public/blog` · `.../{slug}` · `.../categories` | Yayındaki blog yazıları |
| `GET /public/products` · `.../{slug}` · `.../categories` | Yayındaki ürünler (modül kapalıysa 404) |
| `GET /public/portfolio` · `.../{slug}` · `.../categories` | Yayındaki portföy öğeleri (modül kapalıysa 404) |

Tümü **salt-okunur**'dur (`GET`); v1'de yazma ucu yoktur. Ortak parametreler:
`?cursor=`, `?limit=`, `?locale=` (mevcut public site uçlarıyla aynı fallback
semantiği).

**7. Entegratörün bilmesi gereken kısıtlar:**

- Yalnızca `PUBLISHED` ve silinmemiş içerik döner; taslak/çöp filtre parametresi
  bu katmanda YOKTUR.
- Yanıtlar `author`/`authorId`/`seoScore`/`viewCount`/`translations` gibi iç
  alanları İÇERMEZ — personel e-postası dahil hiçbir iç bilgi bu katmana sızmaz
  (§10.13.5).
- `PublicProduct.inStock` bir boolean'dır; gerçek stok adedi dönmez.
- Bu API **sunucudan sunucuya** kullanım içindir. Anahtarı tarayıcı tarafı
  JavaScript'e GÖMMEYİN — CORS bilinçli olarak yalnızca `FRONTEND_URL`'e açıktır,
  `/public/*` için genişletilmemiştir (§10.13.4). Tarayıcıdan çağrılırsa anahtar
  ağ sekmesinden herkese görünür olur.

#### 10.13.12 Webhook Payload Örnekleri ve İmza Doğrulama (documentation-agent — kullanım örneği)

> §10.13.8/§10.13.9'daki bağlayıcı formatın somut, kopyala-yapıştır örnekleridir.
> Alıcı tarafı (webhook uç noktanız) bu sözleşmeye göre doğrulama yapmalıdır.

**Giden isteğin tam görünümü** (`BLOG_POST_PUBLISHED` örneği — header'lar §10.13.9
ile bağlayıcıdır):

```
POST /webhooks/cms HTTP/1.1
Host: hooks.example.com
Content-Type: application/json
User-Agent: CMS-Webhook/1.0
X-Webhook-Id: 3fbb5e2a-9c34-4d10-9d1a-1a2b3c4d5e6f
X-Webhook-Delivery: 9f1c1e6a-9a3e-4b71-8b8a-6a1e2f3c4d5e
X-Webhook-Event: BLOG_POST_PUBLISHED
X-Webhook-Timestamp: 1786872000
X-Webhook-Attempt: 1
X-Webhook-Signature: sha256=6f2c1eab9d4f...<hex>

{
  "id": "9f1c1e6a-9a3e-4b71-8b8a-6a1e2f3c4d5e",
  "event": "BLOG_POST_PUBLISHED",
  "apiVersion": "v1",
  "createdAt": "2026-08-16T10:00:00.000Z",
  "data": {
    "id": "5e4d3c2b-1a0f-4e5d-9c8b-7a6f5e4d3c2b",
    "title": "Yeni Ürün Lansmanı",
    "slug": "yeni-urun-lansmani",
    "excerpt": "Kısa özet metni.",
    "contentHtml": "<p>Yazının tam içeriği...</p>",
    "coverImageUrl": "https://cdn.example.com/media/cover.jpg",
    "category": { "id": "c1a2b3c4-5d6e-4f70-8a9b-0c1d2e3f4a5b", "name": "Duyurular", "slug": "duyurular" },
    "seoTitle": null,
    "seoDescription": null,
    "ogTitle": null,
    "ogImageUrl": null,
    "canonicalUrl": null,
    "noIndex": false,
    "publishedAt": "2026-08-16T10:00:00.000Z",
    "updatedAt": "2026-08-16T10:00:00.000Z"
  }
}
```

`X-Webhook-Delivery` = `data.id` üstündeki zarfın `id` alanı = alıcının
**idempotency anahtarı**; yeniden denemelerde AYNI değer gelir.

**Olay → `data` şeması eşlemesi** (tam alan listeleri için `openapi.yaml`'daki
ilgili `Public*`/`WebhookOrderPayload` şemalarına bakın):

| Olay | `data` şeması | Not |
|---|---|---|
| `PAGE_PUBLISHED` | `PublicPage` | Yalnızca DRAFT/SCHEDULED → PUBLISHED geçişinde |
| `BLOG_POST_PUBLISHED` | `PublicBlogPost` | Yalnızca durum geçişinde (yukarıdaki örnek) |
| `BLOG_POST_UPDATED` | `PublicBlogPost` | Yayındaki bir yazı güncellenince |
| `PRODUCT_CREATED` / `PRODUCT_UPDATED` | `PublicProduct` | — |
| `PRODUCT_DELETED` | `{ "id": "...", "slug": "..." }` | Kaynak artık yok, tam DTO üretilemez |
| `PORTFOLIO_ITEM_PUBLISHED` | `PublicPortfolioItem` | Yalnızca durum geçişinde |
| `ORDER_CREATED` / `ORDER_PAID` / `ORDER_STATUS_CHANGED` | `WebhookOrderPayload` | **PII içerir** (bkz. aşağı) |
| `PING` | `{ "message": "ping", "webhookId": "..." }` | Yalnızca `POST .../test` ile üretilir, gerçek bir olay değildir |

**`ORDER_STATUS_CHANGED` örneği** (`WebhookOrderPayload` — `customerEmail` alıcının
siparişi kendi sisteminde eşleştirebilmesi için **maskelenmeden** gönderilir,
bu yüzden `containsPii: true` işaretlenir ve delivery kaydı 7 gün sonra redakte
edilir, §10.13.8/§10.13.10):

```json
{
  "id": "b7a6c5d4-3e2f-41a0-9b8c-7d6e5f4a3b2c",
  "event": "ORDER_STATUS_CHANGED",
  "apiVersion": "v1",
  "createdAt": "2026-08-16T11:30:00.000Z",
  "data": {
    "id": "a1b2c3d4-e5f6-4718-9a0b-1c2d3e4f5a6b",
    "orderNumber": "ORD-LXK3F2-A1B2",
    "status": "FULFILLED",
    "previousStatus": "PAID",
    "customerEmail": "musteri@example.com",
    "customerName": "Ayşe Yılmaz",
    "currency": "TRY",
    "subtotalCents": 25000,
    "discountCents": 0,
    "taxCents": 4500,
    "totalCents": 29500,
    "paidAt": "2026-08-16T10:05:00.000Z",
    "createdAt": "2026-08-16T10:00:00.000Z",
    "items": [
      {
        "productSlug": "ornek-urun",
        "productTitle": "Örnek Ürün",
        "productSku": "SKU-001",
        "unitPriceCents": 25000,
        "quantity": 1,
        "lineTotalCents": 25000
      }
    ]
  }
}
```

`ORDER_CREATED`/`ORDER_PAID` aynı şemayı kullanır; `previousStatus` yalnızca
`ORDER_STATUS_CHANGED` olayında dolar (diğerlerinde `null`).

**İmza doğrulama (alıcı tarafı, Node.js).** Sözleşme (§10.13.9 — bağlayıcı):

```
signedPayload = `${X-Webhook-Timestamp}.${rawBody}`
signature     = hex(HMAC_SHA256(secret, signedPayload))
header        = `sha256=${signature}`
```

`secret`, webhook oluşturulurken/`rotate-secret` ile dönen `whsec_<64hex>`
değeridir. `rawBody`, gövdenin **gönderildiği baytlarla birebir aynı** ham
dizedir — `JSON.parse` edilip yeniden `JSON.stringify` ile üretilmiş bir dize
DEĞİLDİR (anahtar sırası/boşluk farkı imzayı sessizce geçersiz kılar, bu tür
sistemlerdeki en yaygın hata budur).

```js
// npm i express  (örnek Express middleware'i; framework bağımsız mantık aynıdır)
const crypto = require("crypto");
const express = require("express");

function verifyWebhookSignature({ rawBody, timestampHeader, signatureHeader, secret, toleranceSeconds = 300 }) {
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return false;

  // Replay koruması: timestamp imzanın İÇİNDEDİR (§10.13.9) — çok eski/gelecekteki
  // bir istek reddedilir. Aynı pencere değeri (300 sn) sunucu tarafında da geçerlidir.
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  const expectedHeader = `sha256=${expectedSignature}`;

  const a = Buffer.from(expectedHeader);
  const b = Buffer.from(signatureHeader ?? "");
  // Sabit zamanlı karşılaştırma ZORUNLUDUR (§10.13.9) — düz `===` zamanlama
  // sızıntısına açıktır. Uzunluklar farklıysa timingSafeEqual'ı ÇAĞIRMADAN false
  // dönülür (aksi hâlde fonksiyon kendisi hata fırlatır).
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const app = express();

app.post(
  "/webhooks/cms",
  express.raw({ type: "application/json" }), // ÖNEMLİ: ham body — express.json() DEĞİL
  (req, res) => {
    const rawBody = req.body.toString("utf8");

    const ok = verifyWebhookSignature({
      rawBody,
      timestampHeader: req.header("X-Webhook-Timestamp"),
      signatureHeader: req.header("X-Webhook-Signature"),
      secret: process.env.CMS_WEBHOOK_SECRET, // whsec_...
    });

    if (!ok) {
      return res.status(401).send("invalid signature");
    }

    const envelope = JSON.parse(rawBody);

    // X-Webhook-Delivery (= envelope.id) idempotency anahtarınızdır: aynı id'yi
    // ikinci kez işlemeyin — yeniden denemelerde (5xx/timeout sonrası) AYNI id,
    // AYNI gövde, ama YENİ timestamp/imza ile tekrar gelir (§10.13.9).
    // İşleyin: envelope.event, envelope.data ...

    res.status(200).send("ok");
  }
);
```

**Diğer önemli davranışlar (alıcı tarafında beklenmesi gerekenler):**

- **Zaman aşımı:** sunucumuz bağlantı için 5 sn, toplam istek için 10 sn bekler;
  uç noktanız zamanında yanıt vermezse `timeout` olarak kaydedilip yeniden
  denenir (§10.13.7-C5).
- **Yeniden deneme takvimi:** `2xx` dışında (ve `3xx`/kalıcı `4xx` hariç) en fazla
  5 deneme, aralar ~30 sn → 2 dk → 10 dk → 60 dk (+jitter); toplam pencere ~72 dk
  (§10.13.8). Uç noktanız idempotent olmalıdır.
- **Yönlendirme takip edilmez** (`3xx` = kalıcı başarısızlık) — webhook URL'inizi
  doğrudan (redirect'siz) hedef olarak tanımlayın.
- **Secret rotasyonu anında etkilidir** — grace period YOKTUR; yeni secret'ı
  entegrasyonunuzda güncellemeden rotasyon yaparsanız bir sonraki teslimat imza
  doğrulamasında başarısız olur (alıcı tarafında 401 döndürseniz bile CMS
  tarafında bu `http_error` olarak işlenir ve yeniden denenir, ama kalıcı
  hata sınıfına girmez — düzeltene kadar tüm denemeler tükenir).
- Test için admin panelden `POST .../webhooks/{id}/test` ile bir `PING` olayı
  tetiklenebilir; bu, uç noktanızı gerçek veriye dokunmadan doğrulamanın yoludur.

### 10.14 Blog Etiketleri (Tag) — çoka-çok sınıflandırma

Durum: v1 · Sahibi: Mimar. Bağlayıcı kaynak: `openapi.yaml` (tag `Blog`). Bu bölüm
`db-agent`, `backend-agent`, `frontend-agent` ve `qa-agent` için tek doğruluk kaynağıdır.

Kategori (`BlogCategory`) bir yazının **tek** birincil sınıflandırmasıdır (bire-çok);
etiket ise serbest, **çoklu** ve yatay bir sınıflandırmadır (çoka-çok). İkisi birbirinin
yerine geçmez ve biri diğerini kapsamaz — bu ayrım UI'da da korunur (ayrı alanlar, ayrı
sütunlar).

#### 10.14.1 Şema (db-agent — TEK SAHİP)

```prisma
model BlogTag {
  id        String   @id @default(uuid())
  seq       Int      @unique @default(autoincrement())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())

  posts BlogPostTag[]

  @@map("blog_tags")
}

model BlogPostTag {
  postId String
  tagId  String

  post BlogPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  tag  BlogTag  @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([postId, tagId])
  @@index([tagId])
  @@map("blog_post_tags")
}
```

`BlogPost` tarafına karşı-ilişki eklenir: `tags BlogPostTag[]`. `BlogPost` üzerinde
BAŞKA hiçbir kolon değişmez (`categoryId` olduğu gibi kalır).

**`BlogTag`, `Tag` DEĞİL.** İsimlendirme `BlogCategory`/`ProductCategory`/
`PortfolioCategory` deseninin devamıdır. Global bir `Tag` modeli, ürün veya portföy
etiketleri istendiğinde ya çok-varlıklı polymorphic bir ara tabloya (bu projede
`ContentRevision` dışında kaçınılan bir desen) ya da geriye dönük bir yeniden adlandırmaya
zorlardı. Tablo adları `blog_tags` / `blog_post_tags`.

**Ara tablo AÇIK (explicit), Prisma implicit m-n DEĞİL.** Gerekçeler: (a) implicit ilişki
`_BlogPostToBlogTag` adında bir tablo üretir, bu projedeki snake_case + `@@map` tablo
adlandırma standardını ihlal eder ve migration'da elle düzeltilemez; (b) açık tabloya
ileride kolon eklenebilir (ör. sıralama için `seq`); (c) `onDelete` davranışı iki taraf
için de açıkça ifade edilir, örtük varsayıma bırakılmaz.

**İndeksler.** Bileşik birincil anahtar `@@id([postId, tagId])` hem tekilliği (aynı etiket
bir yazıya iki kez eklenemez) hem de "bu yazının etiketleri" sorgusunun indeksini sağlar.
Ters yön ("bu etiketi taşıyan yazılar", etikete göre filtreleme) bileşik anahtarın soldan
öneki olmadığı için ayrı `@@index([tagId])` gerektirir. `slug @unique` public/idempotent
aramanın anahtarıdır; `name` üzerinde DB tekilliği YOKTUR (bkz. §10.14.3).

#### 10.14.2 Silme semantiği (bağlayıcı)

| Olay | Sonuç |
|---|---|
| Yazı **çöpe** taşınır (`deletedAt` set) | Etiket ilişkileri **AYNEN KORUNUR**. Geri yükleme etiketleri geri getirmek zorundadır; soft-delete asla `blog_post_tags` satırına dokunmaz. |
| Yazı **kalıcı** silinir | `BlogPostTag` satırları FK `onDelete: Cascade` ile düşer. `BlogTag` kayıtlarına DOKUNULMAZ. |
| **Etiket** silinir | `BlogPostTag` satırları cascade düşer; yazılar silinmez, yalnızca o etiketi kaybeder. `BlogCategory` silmenin `SetNull` ile yazıyı kategorisiz bırakmasıyla aynı felsefe. |
| Etiket **hiçbir yazıda kullanılmıyor** (yetim) | **OTOMATİK SİLİNMEZ.** |

**Yetim etiketler bilinçli olarak temizlenmez.** WordPress'in aksine, son yazısından
kaldırılan bir etiket ortadan kaybolmaz. Gerekçe: (a) otomatik silme, kullanıcının bir
yazıdan etiketi geçici olarak çıkarmasıyla o etiketin adının/slug'ının sessizce yok
olmasına yol açar — geri alınamaz ve sürpriz bir veri kaybıdır; (b) editoryal ekipler
etiket sözlüğünü önceden hazırlar; (c) silme her zaman açık bir kullanıcı eylemidir
(§10.11.3 "hiçbir şey kaskad silinmez" ilkesiyle tutarlı). Yetimlerin görünür olması için
`BlogTag` DTO'su `postCount` taşır (bkz. §10.14.3) ve etiket yönetim ekranı bunu gösterir;
temizlik **elle** yapılır. Otomatik/toplu temizlik istenirse önce bu bölüm güncellenir.

`postCount` **çöptekileri saymaz** (`deletedAt: null` filtreli) — yoksa "3 yazıda
kullanılıyor" diyen bir etiket, yayındaki hiçbir yazıda görünmezdi. Sayaç, klasör
sayaçlarındaki (§10.11.1) kuralın aynısıyla **tek sorguda** gelir; etiket başına ayrı
`count()` (N+1) yasaktır.

#### 10.14.3 Uç noktalar ve yetki eşikleri

`BlogCategory` uçlarının **birebir simetriği** — yeni bir desen icat edilmez:

| Uç | Yetki | Not |
|---|---|---|
| `GET /admin/blog/tags` | authenticated | Sayfalanmaz, arama parametresi almaz (§10.11.2 klasör listesiyle aynı gerekçe: liste zaten bellekte, arama frontend-only) |
| `POST /admin/blog/tags` | ADMIN, EDITOR | Satır-içi etiket oluşturmanın da kullandığı uç (§10.14.5) |
| `PATCH /admin/blog/tags/{tagId}` | ADMIN, EDITOR | |
| `DELETE /admin/blog/tags/{tagId}` | **yalnızca ADMIN** | `DELETE .../categories/{categoryId}` ile aynı eşik |

**Kontrat boşluğu kapatılıyor:** `/admin/blog/categories` ve
`/admin/blog/categories/{categoryId}` uçları kodda VAR ama `openapi.yaml`'da
BELGELENMEMİŞ (`/admin/products/categories` belgeli). Etiket uçları eklenirken bu boşluk
da kapatılır — aksi hâlde "kontrat tek doğruluk kaynağıdır" kuralı blog kategorileri için
geçersiz kalırdı.

**Slug türetme ve çakışma.** `POST` gövdesi `{ name, slug? }`; `slug` verilmezse
`slugify(name)`. `slug` unique olduğu için aynı ada sahip ikinci etiket
`409 CONFLICT` alır — global Prisma `P2002` işleyicisi (`plugins/error-handler.ts`) bunu
zaten 409'a çeviriyor, backend-agent ek bir yakalama yazmaz. `name` üzerinde DB tekilliği
yoktur çünkü kimlik slug'dır; "React" ve "react" aynı slug'a düşer ve ikincisi 409 alır —
istenen davranış budur. Satır-içi oluşturmada 409'un kullanıcıya nasıl gösterileceği
§10.14.5'tedir.

**Etiket YENİDEN ADLANDIRILDIĞINDA slug otomatik değişmez** — `PATCH` yalnızca gönderilen
alanı günceller (`BlogCategory` ile aynı davranış). Slug'ın URL kimliği olduğu ve sessizce
değişmesinin bağlantı kırdığı için bu bilinçlidir.

#### 10.14.4 Yazıya etiket atama — `tagIds` TAM SET (delta değil)

Ayrı bir `POST /admin/blog/{postId}/tags` ucu **YOKTUR**. Etiketler yazının diğer alanları
gibi mevcut create/update gövdeleriyle yönetilir:

- `POST /admin/blog` → `tagIds?: string[]` (verilmezse boş)
- `PATCH /admin/blog/{postId}` → `tagIds?: string[]`

**Semantik: gönderilen dizi yazının TAM etiket setidir** (replace), ekleme/çıkarma deltası
değil. `[]` göndermek tüm etiketleri kaldırır; alanı **hiç göndermemek** etiketlere
dokunmaz (`undefined` ≠ `[]`). Bu ayrım Hızlı Düzenle için kritiktir ve `PATCH`'in kısmi
gövde sözleşmesiyle tutarlıdır. Gerekçe: delta semantiği (`addTagIds`/`removeTagIds`) eşzamanlı
iki düzenlemede birleşme (merge) kuralı gerektirir; replace semantiği ise "son yazan kazanır"
kuralını tüm alanlarla aynı tutar.

**Uygulama kuralları (backend-agent):**
- Yazma, yazının güncellendiği **AYNI transaction** içinde yapılır. Yöntem: o yazıya ait
  `blog_post_tags` satırlarından **artık listede olmayanları** `deleteMany`, **yeni
  olanları** `createMany({ skipDuplicates: true })`. "Hepsini sil + hepsini ekle"
  yaklaşımı, hiç değişmemiş satırları gereksizce çöpe atar.
- Var olmayan bir `tagId` → `422 VALIDATION_ERROR` (sessizce yok sayılmaz). Kontrol tek
  bir `findMany({ where: { id: { in: tagIds } } })` ile yapılır, id başına sorgu yasaktır.
- Dizide tekrarlanan id'ler yazmadan önce tekilleştirilir (istek reddedilmez).
- Üst sınır **50 etiket/yazı** (`z.array(...).max(50)`) — sınırsız dizi, sınırsız yazma
  demektir.
- Etiketler **çöpteki yazıda değiştirilemez** (§10.7'nin "çöpteki içerik düzenlenemez →
  409" kuralı bu alan için de geçerlidir, ayrı bir dal yazılmaz).

**Revizyon geçmişi (§10.1) — etiketler snapshot'a DAHİLDİR.** `toBlogPostSnapshot`
`categoryId`'yi zaten saklıyor; etiketleri dışarıda bırakmak, eski bir revizyona dönen
kullanıcının kategorisinin geri geldiği ama etiketlerinin gelmediği asimetrik bir
davranış üretirdi. Snapshot'a `tagIds: string[]` eklenir, geri yükleme aynı replace
semantiğini uygular. **Geri yüklemede artık var olmayan etiket id'leri sessizce
atlanır** (422 DEĞİL) — kullanıcı silinmiş bir etiket yüzünden revizyonunu geri
yükleyemez duruma düşürülemez; snapshot geçmiş bir anın kaydıdır, geçerli bir istek
gövdesi değildir.

**Autosave etiketleri KAPSAMAZ.** `AutosaveBlogPostRequestSchema` bilinçli olarak dar
tutulmuştur (`categoryId` de dışarıdadır); `tagIds` eklenmez.

#### 10.14.5 Frontend sözleşmesi

**DTO.** `BlogPost.tags: BlogTag[]` — her zaman dizi (boşsa `[]`, asla `null`).
Sıralama **deterministik**: `seq ASC` (oluşturulma sırası). Bir okuma sırası belirtilmezse
Prisma'nın döndürdüğü sıra sabit değildir ve UI'da chip'ler istekler arasında yer
değiştirir. `BlogPost` DTO'su tek şema olduğu için `tags` public `/blog` ucunda da görünür;
etiketler public metadata olduğundan (kategori gibi) bu kabul edilmiştir — public sitede
RENDER edilmesi bu turun kapsamında değildir.

**Liste sütunu (kullanıcının 1. maddesi).** Blog listesine Kategori sütununun hemen sağına
"Etiketler" sütunu eklenir (§10.7.2'deki `extraColumns` slotu). İçerik chip'lerdir;
etiketi olmayan satır `—` gösterir. **En fazla 3 chip + "+N"** — sınırsız chip satır
yüksekliğini patlatır ve tabloyu kaydırılamaz hâle getirir. `+N` bir buton DEĞİL,
`title` ile tam listeyi veren bir metindir (satır tıklaması zaten Hızlı Düzenle'ye ait,
çakışmamalı).

**Etikete göre filtreleme (kullanıcının "opsiyonel, kolaysa" isteği) — DAHİL, client-side.**
Yeni bir query parametresi ya da backend değişikliği GEREKTİRMEZ: §10.7 gereği blog listesi
zaten tüm kayıtları belleğe çekiyor (`trashed=include&limit=100` + cursor döngüsü) ve
arama/sayfalama client-side. Etiket filtresi arama kutusunun yanına bir `<Select>` olarak
eklenir (tek etiket seçimi, "Tüm etiketler" varsayılan) ve `useFilteredList`'e giden diziyi
sekme filtresinden SONRA daraltır. **Public `/blog?tag=` filtresi bu turun KAPSAMI
DIŞINDADIR** (public site etiket sayfaları ayrı bir iş; yapılırsa `slug` üzerinden ve
`@@index([tagId])` ile).

**Etiket seçimi bileşeni.** Kategoriyle "aynı UX mantığı" istendi, ama kategori tekil bir
`<Select>`, etiket çoklu. `<select multiple>` **kullanılmaz** (mobilde kullanılamaz,
Ctrl+tık keşfedilebilir değil, seçili öğeler görünür kalmaz). Karar: **chip listesi +
arama/ekleme kutusu** — seçili etiketler kaldırma butonlu chip'ler olarak gösterilir,
altındaki kutu mevcut etiketleri filtreler. Bileşen `frontend/src/components/admin/blog/
tag-select.tsx` olarak **tek kez** yazılır ve hem tam editörde hem Hızlı Düzenle'de
kullanılır (iki ayrı uygulama = iki ayrı davranış).

**a11y (bağlayıcı, pazarlık dışı):** kutunun görünür bir `<label>`'ı olacak —
placeholder etiket YERİNE GEÇMEZ (aynı ihlal §10.15.4'te düzeltiliyor). Chip listesi
`role="list"` + `aria-labelledby`, her kaldırma butonu `aria-label="{etiket} etiketini
kaldır"`. Seçim/kaldırma sonrası değişiklik bir `aria-live="polite"` bölgesiyle duyurulur.

**Satır-içi yeni Kategori/Etiket oluşturma (kullanıcının 5. maddesi).** Yeni uç
gerekmez — mevcut `POST /admin/blog/categories` ve yeni `POST /admin/blog/tags`
kullanılır. Akış:
1. Dropdown'ın altındaki "+ Yeni Kategori Oluştur" satır-içi bir ad input'u ve
   "Oluştur"/"Vazgeç" açar (yeni bir modal AÇILMAZ — editörde açık bir modal varken
   ikinci bir katman kaydedilmemiş içerik riskini artırır).
2. Başarıda dönen kayıt yerel listeye eklenir ve **otomatik seçilir**; liste yeniden
   fetch EDİLMEZ (201 gövdesi zaten kaydı döner).
3. `409 CONFLICT` **hata olarak gösterilmez**: aynı slug'lı kayıt zaten listede olduğu
   için o kayıt seçilir ve "Bu etiket zaten vardı, seçildi." bilgi mesajı verilir.
   Frontend ayrıca **POST'tan ÖNCE** yerel listede slug eşleşmesi arar; varsa istek hiç
   gönderilmez. Böylece kullanıcı, hiçbir zaman kendi eyleminin sonucu olmayan bir hata
   görmez.
4. **Blog yazma yetkisi OLMAYAN roller** (`CUSTOMER`/`USER`; ayrıca panele girebilse de blog dışı kalan hiçbir rol yoktur — §10.21'de blog eşiği `ADMIN`/`MANAGER`/`EDITOR`'dür) için oluşturma tetikleyicisi RENDER EDİLMEZ — 403'ü
   kullanıcıya hata olarak göstermek yerine eylem hiç sunulmaz.
5. Oluşturma **yazının kaydedilmesini beklemez** (kategori/etiket bağımsız kaynaklardır)
   — ama seçim, yazı kaydedilene kadar yalnızca form state'idir.

**Editör kirlilik (dirty) kontrolü.** `admin/blog/[postId]/page.tsx` alan-alan
karşılaştırmayla (`categoryId !== snapshot.categoryId`) "kaydedilmemiş değişiklik" tespit
ediyor. `tagIds` bir DİZİDİR; referans karşılaştırması her render'da yanlış pozitif verir.
Karşılaştırma **sıralı birleştirme** (`[...ids].sort().join(",")`) ile yapılır — etiket
sırası anlamlı değildir, yalnızca küme kimliği önemlidir.

### 10.15 İçerik editöründe Galeri bloğu + MediaPicker çoklu seçim

Durum: v1 · Sahibi: Mimar. Blog'un TipTap editörüne (`components/admin/blog/post-editor.tsx`)
"Galeri Ekle" aracı eklenir. **Hedef Blog editörüdür; Sayfa'nın page-builder'ı DEĞİL** —
`Page` bir TipTap alanı değil blok listesi kullanır ve onun `GalleryBlock`'u zaten vardır
(§10.15.4'te yalnızca a11y'si düzeltilir).

#### 10.15.1 Veri modeli — yeni Prisma alanı YOKTUR (doğrulandı)

Galeri, TipTap içeriğinin İÇİNDE bir node'dur; `BlogPost.contentHtml` string alanına
serileşir. `db-agent`'ın bu madde için yapacağı **hiçbir şey yoktur** ve ayrı bir
`galleries` tablosu AÇILMAZ: galeri metin akışının bir parçasıdır, konumu paragraflara
görelidir ve ayrı bir tabloya taşınsaydı bu konum yine `contentHtml` içinde bir yer
tutucuyla ifade edilmek zorunda kalırdı (iki kaynak, senkronizasyon borcu).

Bu, `components/admin/media/gallery-field.tsx`'ten (Ürün/Portföy galerisi) **kasıtlı olarak
farklıdır**: orası forma ait bağımsız bir alandır ve her ekleme/kaldırmada ayrı API çağrısı
yapar. O bileşen yeniden KULLANILMAZ; yalnızca ızgara/kaldırma butonu görsel deseni ve
(doğru yapılmış) `aria-labelledby` + `role="list"` a11y yaklaşımı örnek alınır.

#### 10.15.2 Serileştirme — sınıf tabanlı HTML (KRİTİK kısıt)

**Doğrulanmış tuzak:** `backend/src/lib/html-sanitize.ts` bir allow-list uygular ve global
öznitelik listesi yalnızca `["id", "class"]`'tır. **Bir `data-*` özniteliği DB'ye
yazılmadan ÖNCE sessizce SİLİNİR.** Yani galeriyi `<div data-gallery data-media-ids="…">`
gibi yaygın TipTap desenine göre serileştirirsek, kullanıcı kaydettikten sonra galeri
attribute'larını kaybeder ve içerik yeniden yüklendiğinde galeri **düz bir görsel yığınına
dönüşür**. Bu, kaydetmeden fark edilmeyen sinsi bir veri kaybıdır.

**Karar: galeri, sanitizer'dan olduğu gibi geçen semantik HTML olarak serileşir.**
Sanitizer değiştirilmez, `data-*` açılmaz, saldırı yüzeyi büyütülmez:

```html
<div class="blog-gallery blog-gallery--grid">
  <figure class="blog-gallery__item">
    <img src="https://…/a.jpg" alt="Alt metin" loading="lazy" />
  </figure>
  …
</div>
```

Kullanılan her etiket (`div`, `figure`, `figcaption`, `img`) ve öznitelik
(`class`, `src`, `alt`, `loading`) mevcut allow-list'te **zaten vardır** — doğrulandı.
TipTap node'unun `parseHTML`'i `div.blog-gallery` sınıfına, düzen (layout) ise
`blog-gallery--{layout}` modifier sınıfına bakar. Sanitizer'a dokunulmadığı için
security-agent'ın bu madde için yeni bir denetimi gerekmez.

**Medya id'leri HTML'e yazılmaz** (yazılamaz — `data-*` yok). Galerinin kimliği
URL'lerdir. Sonuç ve kabul edilen kısıt: bir görsel medya kütüphanesinden silinirse
galeride kırık bir görsel kalır — bu, editöre tekil görsel eklemenin bugünkü davranışıyla
(`setImage({ src })`) **birebir aynıdır**, yeni bir zayıflık değildir.

TipTap node attrs (yalnızca bellekte/serileştirme öncesi):
`{ items: { src: string; alt: string }[]; layout: "grid" }`. Node `group: "block"`,
`atom: true`, `draggable: true`.

**`layout` v1'de yalnızca `"grid"`.** Carousel REDDEDİLDİ (bu tur): carousel public
tarafta JavaScript, klavye gezinme, `aria-roledescription="carousel"`, otomatik oynatma
durdurma ve reduced-motion desteği gerektirir — public site içeriği ise `prose` içine
`dangerouslySetInnerHTML` ile basılan **statik HTML**'dir, orada davranış çalıştıracak bir
bileşen yoktur. Alan yine de bir modifier SINIFI olarak tutulur ki carousel eklendiğinde
mevcut içerik yeniden yazılmadan tanınsın.

**Public render.** Site tarafında galeri React bileşeni yoktur; görünüm tamamen CSS'tir
(`.blog-gallery` global stil). `img` `loading="lazy"` taşır. Boş galeri (0 görsel)
serileştirilmez — kullanıcı hiç görsel seçmeden onaylarsa node hiç eklenmez.

#### 10.15.3 MediaPicker çoklu seçim modu

`MediaPicker` bugün yalnızca tekildir: tıklama = seç ve kapat (`onSelect: (media: Media) => void`).
**Ayrı bir `MediaMultiPicker` bileşeni YAZILMAZ** — klasör ağacı, yükleme, arama, boş
durumlar ve §10.11 davranışları ikinci bir kopyada sürüklenmeye başlar. Mevcut bileşen
**ayrık (discriminated) bir prop birleşimiyle** genişletilir:

```ts
type MediaPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} & (
  | { multiple?: false; onSelect: (media: Media) => void }
  | { multiple: true; onSelect: (media: Media[]) => void; maxSelection?: number }
);
```

`multiple` verilmediğinde bugünkü davranış **bit düzeyinde korunur** — mevcut çağrı
yerlerinin (post-editor tekil görsel, gallery-field, kapak görseli…) hiçbiri değişmez.
Ayrık birleşim, `onSelect`'in tekil/çoğul imzasını tip düzeyinde ayırır; tek bir
`Media | Media[]` imzası her çağrı yerinde tip daraltma zorunluluğu getirirdi.

`multiple: true` davranışı (bağlayıcı):
- Tıklama seçimi **toggle** eder, modal KAPANMAZ. Onay yalnızca alt bardaki
  "Seç (N)" butonuyla verilir; N=0 iken buton `disabled`.
- Seçili kart görsel olarak işaretlenir **ve** `aria-pressed={selected}` taşır (renk tek
  başına gösterge olamaz — WCAG 1.4.1).
- Shift+tık aralık seçimi ve Ctrl/Cmd+A, **§10.11.5'teki kurallarla birebir aynı**
  şekilde davranır (anchor görünen sıralamaya göre; Ctrl+A yalnızca ızgara odaktayken ve
  bir input odaktayken ASLA). Aynı davranışın iki yerde farklı çalışması kabul edilemez.
- Klasör değiştirmek seçimi **temizlemez** (§10.11.5'in aksine, ve bu bilinçli bir
  farktır): oradaki temizleme, görünmeyen öğeler üzerinde yıkıcı toplu işlem yapılmasını
  önlemek içindir; burada eylem yıkıcı değildir ve kullanıcının birden çok klasörden
  galeri toplaması beklenen bir akıştır. Seçim sayısı üst barda her zaman görünür kalır.
- Modal kapanışında seçim sıfırlanır.
- `maxSelection` varsayılanı **24**; sınıra ulaşıldığında seçilmemiş kartlar `disabled`
  ve bir açıklama metni gösterilir.
- Yükleme (`upload`) çoklu modda dosyayı seçime **ekler**, modalı kapatmaz.

#### 10.15.4 a11y — alt metin ve tekrarlanmayan bulgu

Önceki denetimin "GalleryBlock'ta placeholder-only form alanları" bulgusu
`components/admin/page-builder/blocks/gallery-block.tsx` kaynaklıdır: `<Input
placeholder="Görsel URL">` ve `<Input placeholder="Alt metin">` gerçek bir `<label>`
ya da `aria-label` OLMADAN kullanılıyor. Placeholder kalıcı bir etiket değildir (yazmaya
başlanınca kaybolur, ekran okuyucular tutarlı okumaz) — WCAG 3.3.2 ihlali.

**Karar: bu düzeltme BU TURUN kapsamına alınır.** İki gerekçe: (a) izole, birkaç satırlık,
davranış değiştirmeyen bir düzeltmedir; (b) bu turda ikinci bir galeri arayüzü
eklerken bilinen aynı sınıf hatayı komşu dosyada bırakmak, yeni kodun kopyalayacağı yanlış
örneği ayakta tutar. Düzeltme: her satırdaki iki alan `Field` (görünür label) ile sarılır;
tekrarlayan satırlarda görsel gürültü sorunsa label `sr-only` olur ama **DOM'da bulunur** ve
her satır için tekil id taşır ("Görsel 2 URL", "Görsel 2 alt metni").

**Yeni Galeri bloğunun a11y'si (aynı hatayı TEKRARLAMA kuralı):**
- Toolbar butonu mevcut `ToolbarButton` desenini kullanır: `aria-label="Galeri ekle"`.
- Alt metin **her görsel için zorunludur** ve akış, tekil görsel eklemedeki mevcut alt
  metin onay diyaloğunun (`post-editor.tsx::handleConfirmAltText`) çoklu karşılığıdır:
  MediaPicker kapandıktan sonra seçilen her görsel için alt metin girilen bir liste
  gösterilir, `Media.altText` varsa ön-doldurulur, **hepsi dolmadan "Ekle" `disabled`**.
  Her alan gerçek bir `<label>`'a bağlıdır — placeholder ile etiketleme YASAK.
- Alt metinler `Media.altText`'e de yazılır (mevcut `updateMediaAltText` ucuyla, tekil
  akışın aynısı) — böylece aynı görsel bir daha eklendiğinde tekrar sorulmaz.
- Editör içindeki galeri node'u `role="group"` + `aria-label="Galeri (N görsel)"`.

#### 10.15.5 ui-designer devrede — evet, DAR bir kapsamla

Galeri **görsel dili** (ızgara sütun sayısı ve kırılma noktaları, boşluk/`gap` token'ı,
köşe yarıçapı, en-boy oranı ve kırpma davranışı, MediaPicker'daki "seçili" durumunun
işareti) `ui-designer`'a devredilir; bunlar tasarım token'ı kararlarıdır ve `frontend-agent`
tarafından uydurulmaz. **Kapsam dışı (mimar kararı, tasarımcıya sorulmaz):** `.blog-gallery`
CSS sınıf adları ve HTML iskeleti — bunlar §10.15.2'de kontratın parçasıdır, çünkü
sanitizer allow-list'i ve TipTap `parseHTML` eşleşmesi bunlara bağlıdır. ui-designer bu
sınıfların İÇİNİ doldurur, adlarını değiştirmez. Etiket chip'lerinin görsel dili de
(§10.14.5) ui-designer'a aittir; mevcut bir chip/badge token'ı varsa yenisi ÜRETİLMEZ.

#### 10.15.6 ui-designer kararları — galeri grid'i, MediaPicker seçili işareti, etiket chip'i (bağlayıcı)

Durum: v1 · Sahibi: ui-designer (2026-08-16). Kapsam §10.15.5'in bıraktığı dar alanla
sınırlıdır: `.blog-gallery` sınıf adları/HTML iskeleti (§10.15.2) DEĞİŞTİRİLMEMİŞTİR,
yalnızca bu sınıfların CSS içeriği ve iki bileşenin (`MediaPicker`, etiket chip'i) görsel
durumları tanımlanmıştır. Referans alınan mevcut desenler: `gallery-field.tsx`
(`aspect-square overflow-hidden rounded-md/lg`), `media-picker.tsx` (tekil seçim
hover/focus deseni), `components/site/blocks/gallery-block.tsx` (public galeri emsali) ve
`blog/[slug]/page.tsx`'teki kapak görseli (`rounded-lg`, aynı makale akışında bitişik
görünür — radius tutarlılığı bu yüzden `--radius-lg` üzerinden kuruldu).

**A) Galeri grid'i — `.blog-gallery` CSS içeriği.** Bu sınıflar ham HTML olarak hem public
`prose` içine (`dangerouslySetInnerHTML`) hem TipTap editör alanına (`prose prose-sm`)
düşer; Tailwind utility class'ı DEĞİL, gerçek CSS kuralı gerekir (`globals.css`'e, mevcut
`:root`/`@theme inline` token blokları ile aynı dosyaya, ör. bu iki bloğun hemen altına
eklenir):

```css
.blog-gallery {
  margin: 2rem 0; /* mevcut spacing ölçeğinde 32px (my-8 karşılığı) — prose'un tanımadığı
                     bir sınıf olduğu için Typography eklentisinin otomatik dikey ritmi bu
                     div'e uygulanmaz, elle verilmek zorunda */
}

.blog-gallery--grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)); /* mobil: 2 sütun */
  gap: 0.5rem; /* 8px — gap-2, gallery-field.tsx ve public gallery-block.tsx ile aynı birim */
}

@media (min-width: 640px) { /* sm */
  .blog-gallery--grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (min-width: 768px) { /* md */
  .blog-gallery--grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

.blog-gallery__item {
  margin: 0; /* <figure> UA-varsayılan margin'ini sıfırlar — sıfırlanmazsa grid gap'i bozar */
  aspect-ratio: 1 / 1; /* aspect-square — mevcut TÜM galeri/picker desenleriyle birebir aynı oran */
  overflow: hidden;
  border-radius: var(--radius-lg); /* 0.625rem/10px — blog kapak görseliyle (rounded-lg) aynı makalede tutarlı */
}

.blog-gallery__item img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
```

Gerekçe (sütun sayısı 2/3/4): container genişliği public tarafta `max-w-3xl` (768px,
`px-4`/`px-6` ile ~608–736px içerik alanı) ile sınırlı — bu, sayfa oluşturucunun (page-builder)
`GalleryBlockView`'inin (genelde daha geniş, tam-genişlik bir bölüm) 2/3 sütun kararından
FARKLI bir bağlamdır; burada daha DAR bir sütuna daha FAZLA (4'e kadar) sütun sığdırmak
görselleri küçültse de editoryal bir galeri için kabul edilebilir, admin galeri
yönetim panellerindeki (`gallery-field.tsx`: 3/4/6 sütun) küçük-küçük-kare yönetim
kartlarından kasıtlı olarak farklıdır — oradaki amaç yoğun bir yönetim listesi, buradaki
amaç okunabilir bir editoryal görünümdür. `border` YOKTUR (gallery-field/media-picker'ın
aksine) — bu, bir yönetim kartı değil public'te doğrudan görünecek içerik görselidir;
en yakın emsal olan `GalleryBlockView` de border kullanmaz.

**Boş/az öğe durumu:** grid `repeat(N, minmax(0,1fr))` sabit sütun sayısı kullanır (mevcut
kod tabanındaki TÜM galeri örnekleri aynısını yapıyor, `auto-fill` deseni hiçbir yerde
kullanılmıyor) — 2-3 görsellik bir galeri geniş ekranda dolu olmayan bir son satır
bırakabilir; bu, projede zaten kabul edilmiş bir davranıştır, yeni bir sorun değildir.

**B) MediaPicker çoklu seçim — "seçili" işareti.** Tekil moddaki mevcut kart
(`aspect-square overflow-hidden rounded-lg border border-border … hover:ring-2
hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring`) TABAN olarak kalır;
`multiple: true` modunda seçili bir karta şu ek durum eklenir (renk TEK BAŞINA gösterge
DEĞİLDİR — WCAG 1.4.1 gereği ikon+kalıcı ring birlikte kullanılır, `aria-pressed` zaten
§10.15.3'te bağlayıcı):

- Kart: `border-primary` (nötr `border-border` yerine) + KALICI `ring-2 ring-primary`
  (yalnızca hover'da değil, seçiliyken her zaman görünür — tekil moddaki `hover:ring-2`
  davranışından bilinçli fark budur).
- Sağ üst köşede kalıcı bir onay rozeti: `absolute right-1 top-1 flex h-6 w-6
  items-center justify-center rounded-full bg-primary text-primary-foreground` içinde
  `lucide-react`'ten `<Check className="h-3.5 w-3.5" />`. Konum/boyut ölçeği
  (`right-1 top-1`, `h-6 w-6`) `gallery-field.tsx`'teki kaldırma rozetiyle BİREBİR aynı —
  "köşe rozeti" dili projede zaten var, yeniden icat edilmiyor. Tekil moddaki kaldırma
  rozetinin aksine bu rozet `opacity-0` ile hover'da belirmez, seçiliyken HER ZAMAN
  görünür (seçim durumunun fare olmadan da anlaşılması gerekir).
- `maxSelection`'a ulaşıldığında seçilİ OLMAYAN kartlar: `opacity-40 cursor-not-allowed`
  (mevcut `disabled` Button görünümüyle aynı dil) + `disabled` özniteliği (klavye/screen
  reader odağından çıkar, §10.15.3 zaten bağlayıcı).
- Grid'in kendisi (`grid-cols-3 gap-3 sm:grid-cols-4`) DEĞİŞMEZ — yalnızca kart durumu.

**C) Etiket chip'i — mevcut `Badge` bileşeni (`components/ui/badge.tsx`), YENİ bileşen
ÜRETİLMEZ.** Kullanılacak varyant: `tone="neutral" size="sm"` (soft/varsayılan, `solid`
DEĞİL). Gerekçe: `solid` + renkli ton'lar (`primary`/`success`/`warning`) projede DURUM
anlamı taşıyor (`ContentListTable`'daki "Yayında"/"Taslak"/"Zamanlanmış" rozetleri) —
etiket bir durum değil serbest metadata'dır, aynı görsel dili kullanmak yanlış bir anlam
çağrışımı yapar. Etiket başına renk/varyant farklılaştırma (hash'lenmiş renkler vb.)
YAPILMAZ — `BlogTag` şemasında bir renk alanı yok (§10.14.1) ve icat edilen bir istemci
taraflı renk şeması oturumlar arası tutarsız/rastgele görünür; tüm etiketler AYNI nötr
tonu kullanır.

- **Liste sütunu taşması:** mimarın "en fazla 3 chip + '+N'" kuralı (§10.14.5, DEĞİŞMEZ)
  şu şekilde yerleşir: hücre `flex flex-wrap items-center gap-1` (satır YÜKSEKLİĞİ
  büyürse en fazla 2 satıra sarar — mimarın "3+N sabit üst sınırı" zaten bunu pratikte
  nadir kılar). Sütun genişliği Kategori'nin `w-36` (144px) yerine `w-48` (192px) — 3 chip
  + "+N" metni 144px'e sığmaz. "+N" bir `Badge` DEĞİL, düz `<span className="text-xs
  text-foreground/60" title="...">+N</span>` (mimar: buton değil, tıklama Hızlı
  Düzenle'yle çakışmasın). Boş durum Kategori ile birebir aynı: `<span
  className="text-foreground/70">—</span>`. Mobil kart görünümünde (`content-list-table.tsx`
  `pl-11` meta satırı) aynı `Badge` + aynı 3+N kuralı, `flex flex-wrap gap-1` içinde.
- **`tag-select.tsx` (editördeki çoklu seçim chip'i):** aynı `tone="neutral" size="sm"`
  Badge, ama kaldırılabilir olduğu için yanına bitişik küçük bir X butonu eklenir (Badge
  bileşeninin kendisi kaldırma slotu taşımaz, sarmalayan bir `<span className="inline-flex
  items-center gap-1">` içinde `Badge` + `<button aria-label="{etiket} etiketini
  kaldır"><X className="h-3 w-3" /></button>`). İki bağlamda (salt-okunur tablo hücresi /
  düzenlenebilir form chip'i) AYNI ton kullanılması bilinçlidir — kullanıcı aynı etiketi
  hem listede hem editörde aynı görsel dille tanır.

Bu kararlar frontend-agent tarafından uygulanır; bu bölüm değişirse (örn. sütun sayısı
gerçek veriyle denendiğinde çok sıkışık/boş görünürse) güncellemesi gereken taraf yine
ui-designer'dır, frontend-agent kendi takdirine göre sütun/gap değiştirmez.

### 10.16 E-posta Şablonu Blok Editörü + İletişim Formu

Durum: v1 · Sahibi: Mimar · Bu bölüm §10.3'ün (mevcut ham-HTML şablon yöneticisi)
**yerini almaz, onu genişletir**. §10.3'te tanımlı `EmailTemplate` modeli, uçlar ve
`lib/template-render.ts` allow-list render'ı geçerliliğini korur; aşağıdaki maddeler
üzerine eklenir. §10.3'ün "gerçek e-posta gönderimi kapsam dışı" cümlesi ARTIK GEÇERSİZDİR
(gönderim `lib/mail.ts` + `email-templates.service.ts` ile hâlihazırda çalışıyor).

#### 10.16.1 Kapsam, kapsam dışı ve mimar hakemliği

**Kapsam içi:** kullanıcı tarafından oluşturulan e-posta şablonları, blok tabanlı
sürükle-bırak editör, değişken (variable) sistemi + kullanıcı tanımlı özel değişkenler,
tek (singleton) iletişim formu + alan yönetimi + gönderim kaydı (submission) saklama +
şablonla admin bildirimi, sunucu tarafı canlı önizleme, admin'in kendi adresine test
gönderimi.

**Kapsam dışı (bilinçli, gerekçeli):**
- **Şablon yerelleştirmesi (i18n).** `EmailTemplate`'te `translations` alanı AÇILMAZ.
  Gerekçe: gönderim tetikleyicilerinin (`auth.service.ts`, `stripe.routes.ts`) hiçbiri
  bugün alıcının dil tercihini bilmiyor (`User` modelinde locale alanı YOK) — şablon
  çevirisi eklemek, çözülmemiş "alıcının dili nedir" sorusunu şablon katmanına
  taşırdı. Sonraki tur.
- **Şablon revizyon geçmişi.** `ContentRevision.entityType` genişletilmez; §10.1 kapsamı
  Page/BlogPost'ta kalır. Bunun yerine `duplicate` ucu (bkz. §10.16.6) kullanıcıya
  "kopyala, üzerinde dene" yolunu verir.
- **`CONTACT_SUBMISSION_CREATED` giden webhook olayı.** §10.13.10 registry'sine
  EKLENMEZ (Prisma `WebhookEvent` enum'ına dokunmamak, db-agent'ın diff'ini küçük
  tutmak için). Doğal bir sonraki adımdır, bu turda değil.
- **CAPTCHA / üçüncü parti bot koruması.** Üçüncü parti bağımlılık kararı
  security-agent'ındır; v1'de honeypot + IP rate limit ile yetinilir (bkz. §10.16.9).

**Mimar hakemliği — değişken adları Türkçe mi İngilizce mi?** İstek metninde
`{{kullanici_adi}}`, `{{sifre_sifirlama_linki}}` gibi Türkçe anahtarlar örneklendi.
**Karar: SİSTEM değişkenlerinin anahtarları İngilizce snake_case kalır**
(`user_name`, `reset_link`, `site_name`, …). Üç bağlayıcı gerekçe:
1. `prisma/seed.ts`'teki 5 şablon ve `email-templates.service.ts`'teki TÜM çağrı
   yerleri bugün `user_name`/`reset_link` üretiyor. Anahtarı değiştirmek, üretimdeki
   `PASSWORD_RESET` akışını sessizce bozar (allow-list dışı kalan `{{...}}` OLDUĞU GİBİ
   basılır — kullanıcı e-postasında ham `{{sifre_sifirlama_linki}}` görür).
2. Proje kuralı (`.claude/CLAUDE.md` § Ortak Proje Kuralları): kod ve değişken isimleri
   İngilizce, kullanıcıya dönük metinler Türkçe.
3. Kullanıcı deneyimi zaten korunur: değişken paneli **Türkçe etiketi birincil**
   gösterir ("Kullanıcı Adı"), teknik anahtarı (`{{user_name}}`) ikincil satırda
   verir. Kullanıcı hiçbir zaman anahtarı elle yazmaz, panelden ekler.

**Özel (custom) değişkenlerde** anahtar kullanıcıya aittir ve Türkçe olabilir, ancak
**ASCII zorunludur**: `lib/template-render.ts::PLACEHOLDER_PATTERN` = `/\{\{(\w+)\}\}/g`
ve JS `\w` = `[A-Za-z0-9_]`. Yani `{{kullanici_adi}}` ÇALIŞIR, `{{çalışan_adı}}`
**ÇALIŞMAZ** (sessizce render edilmez, ham metin olarak e-postaya basılır). Bu yüzden
özel değişken anahtarı `^[a-z][a-z0-9_]{0,39}$` ile **sunucu tarafında** doğrulanır ve
frontend, kullanıcının girdiği Türkçe etiketten anahtarı `slugify` ile ASCII'ye
indirgeyerek önerir (`slugify` frontend'de zaten bağımlılık olarak var).

#### 10.16.2 Veri modeli — `EmailTemplate` genişletmesi (yeni tablo AÇILMAZ)

Kullanıcı şablonları için **ayrı bir tablo açılmaz**; `EmailTemplate` genişletilir.
Gerekçe: gönderim yolu (`sendTemplateEmail`), render allow-list'i, liste ekranı ve
önizleme her iki tür için de aynıdır; ikinci bir tablo bunların hepsini çiftler.

```prisma
enum EmailTemplatePurpose {
  WELCOME
  PASSWORD_RESET
  SYSTEM_ANNOUNCEMENT
  ORDER_CONFIRMATION
  ORG_INVITATION
  CONTACT_FORM_NOTIFICATION
  CUSTOM
}

/// RAW  = §10.3'ten devralınan ham HTML şablonu (`bodyHtml` kaynak).
/// BLOCKS = §10.16 blok editörü (`blocks` kaynak, `bodyHtml` KULLANILMAZ).
enum EmailTemplateEditorMode {
  RAW
  BLOCKS
}

model EmailTemplate {
  id                 String                  @id @default(uuid())
  seq                Int                     @unique @default(autoincrement())
  /// YENİ: nullable. Yalnızca `isSystem = true` satırlarda dolu (seed idempotency'si
  /// için — `prisma/seed.ts` upsert'i `where: { key }` ile çalışmaya devam eder).
  /// Kullanıcının oluşturduğu şablonlarda `null`; Postgres unique index birden çok
  /// NULL'a izin verir.
  key                String?                 @unique
  name               String
  purpose            EmailTemplatePurpose    @default(CUSTOM)   // YENİ
  editorMode         EmailTemplateEditorMode @default(BLOCKS)   // YENİ
  /// Seed'lenmiş çekirdek şablon — SİLİNEMEZ (403), `purpose`/`key` DEĞİŞTİRİLEMEZ.
  isSystem           Boolean                 @default(false)    // YENİ
  /// "Kullanımda mı?" — bkz. §10.16.3 aktiflik kuralı.
  isActive           Boolean                 @default(false)    // YENİ
  subject            String
  /// Yalnızca editorMode=RAW için kaynak. BLOCKS modunda "" (render ÖNBELLEKLENMEZ).
  bodyHtml           String                  @default("")       // YENİ default
  /// editorMode=BLOCKS kaynağı — EmailBlock[] (bkz. §10.16.4).
  blocks             Json                    @default("[]")     // YENİ
  /// §10.3'ten devralındı, salt bilgi amaçlı; artık `lib/email-variables.ts`
  /// registry'sinden TÜRETİLİR (bkz. §10.16.5) ve yazma uçlarında DEĞİŞTİRİLEMEZ.
  availableVariables Json
  /// Kullanıcı tanımlı değişkenler: { key, label, sampleValue }[] (bkz. §10.16.5).
  customVariables    Json                    @default("[]")     // YENİ
  updatedById        String?
  updatedAt          DateTime                @updatedAt
  createdAt          DateTime                @default(now())

  updatedBy    User?         @relation("EmailTemplateUpdater", fields: [updatedById], references: [id], onDelete: SetNull)
  contactForms ContactForm[] @relation("ContactFormNotificationTemplate")

  @@index([purpose, isActive])
  @@map("email_templates")
}
```

**Migration adı:** `add_email_template_builder`.

**Geriye dönük doldurma (backfill) — migration'ın parçası, ZORUNLU:**
mevcut 5 satır (`WELCOME`, `PASSWORD_RESET`, `SYSTEM_ANNOUNCEMENT`,
`ORDER_CONFIRMATION`, `ORG_INVITATION`) için `purpose` = `key` ile aynı değer,
`editor_mode = 'RAW'`, `is_system = true`, `is_active = true`.
Backfill YAPILMAZSA `sendTemplateEmail` hiçbir şablon bulamaz ve kayıt/şifre
sıfırlama/sipariş onayı e-postalarının TAMAMI 404 ile düşer.

**`bodyHtml` neden ÖNBELLEKLENMİYOR?** Render çıktısı site logosuna
(`SiteSettings.logoUrl`), site adına ve yayınlanan hukuki sayfaların listesine
(`Page.isLegalDocument`) bağlıdır. Bunlar şablondan bağımsız değişir; önbelleklenmiş
HTML sessizce eskir ve KVKK footer'ı yanlış/eksik linkle gönderilir. Render maliyeti
string birleştirmedir — önbelleklemenin faydası yok, riski gerçek.

#### 10.16.3 Aktiflik kuralı — "kullanıldığı yer" semantiği

Liste ekranındaki "kullanıldığı yer" ve "aktif/pasif" sütunları TEK bir kuraldan doğar:

> `purpose ≠ CUSTOM` olan her amaç için **en fazla BİR** şablon `isActive = true`
> olabilir; gönderim tetikleyicileri şablonu **amaca göre** çözer, anahtara göre değil.

- `sendTemplateEmail(app, key, …)` imzası **`sendTemplateEmail(app, purpose, …)`**
  olarak değişir; çözümleme `findFirst({ where: { purpose, isActive: true } })`.
  Bulunamazsa mevcut davranış korunur: `NotFoundError` (sessizce yutulmaz).
- `purpose = CUSTOM` şablonlarda `isActive` yalnızca "kullanılabilir/pasifleştirilmiş"
  anlamı taşır, teklik kuralı UYGULANMAZ.
- Teklik **iki katmanda** zorlanır (savunma derinliği, §10.13'teki çok katmanlı
  rate-limit deseniyle aynı felsefe):
  1. **Servis katmanı:** `POST /{templateId}/activate` tek bir transaction içinde
     önce aynı `purpose`'un diğer satırlarını `isActive = false` yapar, sonra hedefi
     `true` yapar.
  2. **DB katmanı — kısmi unique index (raw SQL, Prisma şemasıyla ifade edilemez):**
     ```sql
     CREATE UNIQUE INDEX "email_templates_active_purpose_key"
       ON "email_templates" ("purpose")
       WHERE "is_active" = true AND "purpose" <> 'CUSTOM'::"EmailTemplatePurpose";
     ```
     db-agent bunu migration `.sql` dosyasına elle ekler ve `schema.prisma`'ya
     açıklama satırı olarak not düşer (Prisma bu indeksi introspect edemez).

`isActive = true` olan bir şablonu **silmek** 409 `CONFLICT` döner ("önce başka bir
şablonu aktifleştirin") — aksi halde şifre sıfırlama akışı sessizce ölür.

#### 10.16.4 E-posta blok modeli ve **sunucu tarafı** render (KRİTİK kısıt)

**Doğrulanmış tuzak (§10.15.2 ile aynı sınıf hata):** `lib/html-sanitize.ts`'in global
öznitelik listesi `"*": ["id", "class"]`'tır — **`style` özniteliği izin listesinde
DEĞİLDİR ve DB'ye yazılmadan önce sessizce silinir.** E-posta HTML'i ise satır-içi
(`inline`) `style` OLMADAN çalışmaz: Gmail `<style>` bloğunu ve harici CSS'i büyük ölçüde
yok sayar, Outlook `class` seçicilerine güvenilemez. Yani **blok editörünün ürettiği
HTML `sanitizeRichHtml`'den GEÇİRİLEMEZ** ve `sanitizeRichHtml` bu iş için
gevşetilmemelidir (`style` açmak, tüm blog/sayfa içeriği için CSS enjeksiyon yüzeyi
açardı).

**Karar: HTML istemciden ASLA kabul edilmez; sunucu üretir.**

- İstemci yalnızca **yapısal blok verisi** gönderir (`blocks: EmailBlock[]`).
- `backend/src/lib/email-renderer.ts` (YENİ, backend-agent sahipliğinde) blokları
  tablo-tabanlı, satır-içi stilli e-posta HTML'ine dönüştürür. Satır-içi `style`
  değerleri **kullanıcı girdisinden değil**, doğrulanmış token'lardan üretilir
  (hizalama enum'ı, `^#[0-9a-fA-F]{6}$` regex'li renk, `none|sm|md|lg` boşluk enum'ı).
  Kullanıcı hiçbir koşulda ham CSS yazamaz.
- Blok içi zengin metin (`text` bloğunun `html` alanı) `lib/html-sanitize.ts`'e YENİ bir
  export ile temizlenir: **`sanitizeEmailRichText(html)`** — `sanitizeRichHtml`'den AYRI,
  DAHA DAR bir allow-list:
  `allowedTags: ["p","br","strong","em","u","s","a","ul","ol","li","span"]`,
  `allowedAttributes: { a: ["href","target","rel"], "*": [] }`,
  `allowedSchemes: ["http","https","mailto","tel"]`.
  **`style`/`class`/`id` DAHİL DEĞİL** — görsel her şey renderer'ın işi.
  `sanitizeRichHtml` ve `SANITIZE_OPTIONS` **DEĞİŞTİRİLMEZ**; iki sabit yan yana durur.
- Değişken render'ı **HTML üretildikten SONRA**, mevcut `renderTemplate()` ile yapılır
  (allow-list + HTML-escape, `lib/template-render.ts` DEĞİŞMEZ).

**Blok tipleri** (`EmailBlockType`) ve veri şekilleri:

```ts
type EmailBlockType =
  | "logo-header" | "heading" | "text" | "button" | "image" | "divider" | "footer";

interface EmailBlockStyle {
  align: "left" | "center" | "right";        // varsayılan "left"
  backgroundColor: string | null;            // ^#[0-9a-fA-F]{6}$
  textColor: string | null;                  // ^#[0-9a-fA-F]{6}$
  paddingY: "none" | "sm" | "md" | "lg";     // varsayılan "md"
  paddingX: "none" | "sm" | "md" | "lg";     // varsayılan "md"
}

interface EmailBlockBase { id: string; type: EmailBlockType; style: EmailBlockStyle; }
```

| type | `data` şeması | Değişken kabul eden alanlar |
|---|---|---|
| `logo-header` | `{ useSiteLogo: boolean; logoUrl: string \| null; height: number (16–120) }` | — |
| `heading` | `{ text: string (1–200); level: 1 \| 2 \| 3 }` | `text` |
| `text` | `{ html: string (≤ 20 000 krk) }` | `html` |
| `button` | `{ label: string (1–80); href: string; backgroundColor: string \| null; textColor: string \| null; radius: "none" \| "sm" \| "full" }` | `label`, `href` |
| `image` | `{ mediaId: string \| null; url: string; alt: string (1–200); width: number \| null }` | — |
| `divider` | `{ thickness: 1 \| 2 \| 4; color: string \| null }` | — |
| `footer` | `{ text: string (≤ 1000) }` | `text` |

Bağlayıcı kısıtlar:
- `useSiteLogo: true` iken `logoUrl` render anında `SiteSettings.logoUrl`'den okunur;
  logo tanımsızsa blok **hiç render edilmez** (kırık görsel yerine boşluk).
- `image.alt` **zorunludur** (a11y — §10.15.4 ile aynı kural; e-posta istemcilerinin
  çoğu görselleri varsayılan olarak engeller, alt metin tek okunabilir içerik olur).
- `button.href` ya `http(s)://…`/`mailto:` olmalı ya da **tamamen** tek bir değişken
  olmalıdır (`^\{\{\w+\}\}$`). Karışık/serbest değerler 422. `javascript:`/`data:` her
  koşulda reddedilir.
- Şablon başına en fazla **50 blok**; `blocks` gövdesi en fazla **256 KB**.
- **İç içe blok YOKTUR** — e-posta bloğu düz bir listedir (Bölüm B'nin sütun modeliyle
  KARIŞTIRILMAMALI; ikisi ayrı sistemlerdir ve tip/registry paylaşmaz).

**Zorunlu KVKK footer'ı (compliance kancası, bağlayıcı).** `renderEmailTemplate()`
kullanıcının `footer` bloğundan BAĞIMSIZ olarak, çıktının **en sonuna** bir uyum
footer'ı ekler. İçeriği:
- `SiteSettings.siteName`,
- `status = PUBLISHED`, `deletedAt = null`, `isLegalDocument = true` olan TÜM `Page`
  kayıtlarının başlık + `${FRONTEND_URL}/{defaultLocale}/{slug}` bağlantıları
  (mevcut "hukuki belge" ayarının doğrudan tüketicisi — yeni bir ayar İCAT EDİLMEZ).

Kullanıcı bu bloğu silemez/kapatamaz; `footer` bloğu yalnızca **ek** metin (adres,
imza) içindir. Hiç hukuki sayfa yoksa footer yalnızca site adını basar ve
`app.log.warn` ile uyarı düşer (sessiz kalmaz).

#### 10.16.5 Değişken (variable) sistemi

**Registry:** `backend/src/lib/email-variables.ts` (YENİ) — `lib/permissions-matrix.ts`
ve `lib/module-registry.ts` ile **aynı statik-registry deseni**. Frontend değişken
listesini HARDCODE ETMEZ, API'den okur.

```ts
export interface EmailVariableDefinition {
  key: string;            // ör. "user_name" — İngilizce snake_case (bkz. §10.16.1)
  label: string;          // ör. "Kullanıcı Adı" — Türkçe, UI'da birincil
  sampleValue: string;    // önizleme/test gönderiminde kullanılır
  source: "system" | "custom" | "contact-field";
}
```

Amaca göre sistem değişkenleri (bağlayıcı — mevcut `seed.ts` ve çağrı yerleriyle birebir):

| purpose | değişkenler |
|---|---|
| (hepsi, global) | `site_name`, `site_url` |
| `WELCOME` | `user_name`, `login_url` |
| `PASSWORD_RESET` | `user_name`, `reset_link` |
| `SYSTEM_ANNOUNCEMENT` | `user_name`, `announcement_title`, `announcement_body` |
| `ORDER_CONFIRMATION` | `order_number`, `customer_name`, `items_summary`, `total_formatted` |
| `ORG_INVITATION` | `inviter_name`, `organization_name`, `accept_url` |
| `CONTACT_FORM_NOTIFICATION` | `form_title`, `submitted_at`, `submission_url` + **iletişim formunun her alanı için `{{<field.key>}}`** |
| `CUSTOM` | yalnızca global + kullanıcının özel değişkenleri |

`site_name`/`site_url` global olduğu için `WELCOME` şablonunda da geçerlidir; bu
değişkenleri `sendTemplateEmail` **her çağrıda otomatik enjekte eder** (çağıranın
göndermesine gerek yok).

**Özel (custom) değişkenler.** `EmailTemplate.customVariables` = `{ key, label,
sampleValue }[]`, en fazla 20 adet. Anahtar `^[a-z][a-z0-9_]{0,39}$` (bkz. §10.16.1) ve
o şablonun sistem değişkenleriyle **çakışamaz** (422 `CONFLICT` değil, `VALIDATION_ERROR`
— alan bazlı hata `details.customVariables`).

**İletişim formu alanları otomatik değişken olur.** `purpose =
CONTACT_FORM_NOTIFICATION` olan bir şablonun `variables` listesi hesaplanırken backend
`ContactFormField` satırlarını okur ve her biri için `{ key: field.key, label:
field.label, sampleValue: <tipe göre örnek>, source: "contact-field" }` üretir. Yani
admin forma "telefon" alanı eklediğinde `{{telefon}}` **hiçbir ek işlem olmadan**
değişken panelinde belirir (istenen davranış).

**Doğrulama.** Yazma uçlarında (`POST`/`PATCH`) şablon metinlerindeki `{{…}}`
kalıpları taranır; izinli sette olmayan bir anahtar varsa istek **422** ile reddedilir
(`details.blocks = ["Tanımsız değişken: {{foo}}"]`). Gerekçe: allow-list dışı kalan
kalıp `renderTemplate` tarafından OLDUĞU GİBİ basılır — kullanıcı bunu kaydetme anında
değil, gerçek e-posta gittikten sonra fark eder. **Kaydetme anında hata vermek
bilinçli bir seçimdir.**

`availableVariables` alanı artık **istemciden kabul edilmez**; her yazmada registry'den
türetilip yazılır (§10.3'teki "salt bilgi amaçlı" niteliği korunur, ama artık tek
doğruluk kaynağı registry'dir).

#### 10.16.6 E-posta şablonu uçları (yetki: SiteRole=ADMIN, GET dahil)

**BREAKING:** §10.3'teki `{key}` adreslemesi **`{templateId}` (uuid)** ile değiştirilir.
Gerekçe: kullanıcı şablonlarının `key`'i yoktur (`null`) ve `name` değiştirilebilir bir
etikettir; kararlı adres yalnızca `id` olabilir. frontend-agent
`frontend/src/lib/api/email-templates.ts`'i ve
`app/admin/notifications/templates/[key]/` rotasını `[templateId]`'ye taşır.
`frontend/src/lib/api/types.ts::EmailTemplateKey` union'ı **kaldırılır** (bugün zaten
hatalı: `ORDER_CONFIRMATION`/`ORG_INVITATION` eksik).

| Uç | Açıklama |
|---|---|
| `GET /admin/notifications/templates` | Liste (özet DTO — `blocks` DÖNMEZ). Sıra: `seq ASC`. Filtre: `?purpose=`, `?isActive=` |
| `POST /admin/notifications/templates` | Yeni şablon. Body `{ name, purpose, subject?, blocks? }`. 201. Audit `notifications.template_create` |
| `GET /admin/notifications/templates/variables?purpose=` | Şablon oluşturmadan ÖNCE değişken listesi (registry) |
| `GET /admin/notifications/templates/{templateId}` | Tam DTO (`blocks` + hesaplanmış `variables` dahil) |
| `PATCH /admin/notifications/templates/{templateId}` | `{ name?, subject?, blocks?, bodyHtml?, customVariables? }`. Audit `notifications.template_update` |
| `DELETE /admin/notifications/templates/{templateId}` | 204. `isSystem` → 403, `isActive` → 409. Audit `notifications.template_delete` |
| `POST /admin/notifications/templates/{templateId}/activate` | Bu şablonu amacın aktifi yapar (§10.16.3). Audit `notifications.template_activate` |
| `POST /admin/notifications/templates/{templateId}/duplicate` | Kopya (`isSystem=false`, `isActive=false`, `key=null`, adı "… (kopya)"). 201 |
| `POST /admin/notifications/templates/preview` | **Durumsuz (stateless) taslak önizleme** — kaydedilmemiş editör durumunu render eder. DB'ye YAZMAZ |
| `POST /admin/notifications/templates/{templateId}/test-send` | **Kaydedilmiş** şablonu örnek verilerle admin'in KENDİ adresine gönderir |

**İki ayrı önizleme/test yolu — bilinçli:**
- Önizleme **durumsuzdur** (`{ subject, editorMode, blocks, bodyHtml, purpose,
  customVariables, sampleValues? }` gövdesi) çünkü editörde her tuş vuruşunda (500 ms
  debounce) çağrılır ve kaydetmeyi zorunlu kılmamalıdır.
- Test gönderimi **kaydedilmiş satır üzerinden** çalışır: gerçekten gönderilecek olan
  şeyin test edilmesi, kaydedilmemiş bir taslağın değil. Ayrıca audit kaydı somut bir
  `targetId` gerektirir.

**`test-send` güvenlik kararı (bağlayıcı):** gövde **`to` alanı KABUL ETMEZ**; alıcı her
zaman `request.user.email`'dir. ADMIN arkasında bile "keyfi HTML'i keyfi adrese gönder"
ucu bir spam-relay/phishing vektörüdür ve SMTP itibarımızı yakar. Yanıt
`{ sentTo, messageId, previewUrl? }` (`previewUrl` yalnızca dev/Ethereal'de dolu, bkz.
`lib/mail.ts`). Rate limit `EMAIL_TEST_SEND_RATE_LIMIT = { max: 3, timeWindow: "1 minute" }`
(`lib/rate-limit.ts`'e eklenir). Audit `notifications.template_test_send` — metadata'ya
alıcı adresi YAZILMAZ (audit metadata'sında PII yasağı; `actorEmail` zaten kayıtta).

**Rota çakışması uyarısı (backend-agent):** `/variables` statik segmenti
`/{templateId}` param segmentiyle aynı seviyededir. Fastify'ın radix router'ı statik
segmenti önceler, dolayısıyla çakışma YOKTUR — ancak `templateId` param'ı
`z.string().uuid()` ile doğrulanmalıdır ki yanlış sıralamada bile "variables" 422 verip
sessiz bir 404'e dönüşmesin.

#### 10.16.7 İletişim formu — veri modeli

Site tarafında iletişim formu **YOKTUR** (doğrulandı: `backend/src` içinde tek bir
`contact` eşleşmesi yok; frontend'deki tek eşleşme checkout sayfasındaki alakasız bir
metin). Sıfırdan tanımlanır.

**Karar: TEK (singleton) form.** `SiteSettings`/`SiteAppearance` ile aynı
`id = "singleton"` + lazy-upsert deseni. Gerekçe: çoklu form, form seçici UI'ı, form
başına şablon eşlemesi ve public rotada slug çözümlemesi getirir — istenmedi. İleri
yol açık bırakılır: public uç bugünden `/contact/form` (tekil kaynak) olarak
adlandırılır; çoklu forma geçişte `/contact/forms/{slug}` eklenir, mevcut uç
varsayılana yönlenir.

**Karar: gönderimler (submission) VERİTABANINA YAZILIR**, e-posta bildirimi bundan
TÜRETİLİR. Gerekçe: SMTP tek hata noktasıdır; yalnızca e-posta gönderen bir form,
SMTP arızasında ziyaretçinin mesajını **kalıcı olarak kaybeder** ve ziyaretçi bunu
asla öğrenemez. Bu, kabul edilebilir bir tasarım değildir. Sonuç olarak minimal bir
"Gelen Kutusu" ekranı da kapsama alınır (liste + detay + durum + silme) — bu bilinçli
bir kapsam genişlemesidir, mimar kararıdır.

```prisma
enum ContactFieldType { TEXT EMAIL PHONE TEXTAREA SELECT CHECKBOX }
enum ContactSubmissionStatus { NEW READ ARCHIVED SPAM }

model ContactForm {
  id                     String   @id @default("singleton")
  title                  String   @default("İletişim")
  description            String?
  submitLabel            String   @default("Gönder")
  successMessage         String   @default("Mesajınız alındı. En kısa sürede dönüş yapacağız.")
  isEnabled              Boolean  @default(true)
  /// Bildirimin gideceği adres. null ise bildirim GÖNDERİLMEZ (submission yine kaydedilir).
  notifyEmail            String?
  /// null ise purpose=CONTACT_FORM_NOTIFICATION olan aktif şablona düşülür (§10.16.3).
  notificationTemplateId String?
  // --- KVKK (compliance-agent alanı; alanlar mimar tarafından açılır, DEĞERLERİ ona aittir) ---
  consentRequired        Boolean  @default(true)
  consentText            String   @default("")
  /// Onay metnindeki "Aydınlatma Metni" bağlantısının hedefi — `Page.isLegalDocument`
  /// olan bir sayfa. Sayfa silinirse SetNull.
  consentLegalPageId     String?
  /// Gönderimlerin saklama süresi (gün). 0 = süresiz (compliance-agent onayı gerekir).
  retentionDays          Int      @default(180)
  updatedById            String?
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  notificationTemplate EmailTemplate?      @relation("ContactFormNotificationTemplate", fields: [notificationTemplateId], references: [id], onDelete: SetNull)
  consentLegalPage     Page?               @relation("ContactFormConsentPage",          fields: [consentLegalPageId],     references: [id], onDelete: SetNull)
  updatedBy            User?               @relation("ContactFormUpdater",              fields: [updatedById],            references: [id], onDelete: SetNull)
  fields               ContactFormField[]
  submissions          ContactSubmission[]

  @@map("contact_forms")
}

model ContactFormField {
  id          String           @id @default(uuid())
  seq         Int              @unique @default(autoincrement())
  formId      String
  order       Int
  /// ^[a-z][a-z0-9_]{0,39}$ — e-posta şablonunda {{key}} olarak görünür (§10.16.5).
  key         String
  label       String
  type        ContactFieldType
  required    Boolean          @default(false)
  placeholder String?
  helpText    String?
  /// SELECT için { value, label }[]; diğer tiplerde [].
  options     Json             @default("[]")
  maxLength   Int?
  /// name/email/message — SİLİNEMEZ ve `key`/`type`'ı DEĞİŞTİRİLEMEZ (label/sıra serbest).
  isSystem    Boolean          @default(false)
  createdAt   DateTime         @default(now())

  form ContactForm @relation(fields: [formId], references: [id], onDelete: Cascade)

  @@unique([formId, key])
  @@index([formId, order])
  @@map("contact_form_fields")
}

model ContactSubmission {
  id                  String                  @id @default(uuid())
  /// Cursor sayfalama için stabil sıra (projedeki tüm listelerle aynı desen).
  seq                 Int                     @unique @default(autoincrement())
  formId              String
  /// Liste/arama ve bildirim için denormalize — `data` içinde de bulunur.
  name                String
  email               String
  /// TÜM alanların key→value anlık görüntüsü. Alan sonradan silinse bile veri korunur.
  data                Json
  status              ContactSubmissionStatus @default(NEW)
  // --- KVKK ---
  consentAt           DateTime?
  /// Gönderim ANINDA gösterilen onay metninin birebir kopyası (ispat yükümlülüğü).
  consentTextSnapshot String?
  // --- PII (30 gün sonra redakte edilir, bkz. §10.16.10) ---
  ipAddress           String?
  userAgent           String?
  piiRedactedAt       DateTime?
  // --- Bildirim ---
  notifiedAt          DateTime?
  /// SMTP hatasının kısa mesajı — gönderim BAŞARISIZ olsa da submission kaydı durur.
  notificationError   String?
  readAt              DateTime?
  readById            String?
  createdAt           DateTime                @default(now())

  form   ContactForm @relation(fields: [formId], references: [id], onDelete: Cascade)
  readBy User?       @relation("ContactSubmissionReader", fields: [readById], references: [id], onDelete: SetNull)

  @@index([formId, status, seq])
  @@index([createdAt])
  @@map("contact_submissions")
}
```

**Karşı-ilişki (back-relation) alanları — db-agent unutmasın:**
`Page` → `contactFormConsents ContactForm[] @relation("ContactFormConsentPage")`,
`User` → `contactFormUpdates ContactForm[] @relation("ContactFormUpdater")` ve
`contactSubmissionsRead ContactSubmission[] @relation("ContactSubmissionReader")`.

**Migration adı:** `add_contact_form`.

**Seed (`prisma/seed.ts`) eklemeleri:**
1. `ContactForm` singleton'ı (`upsert` `where: { id: "singleton" }`).
2. Üç sistem alanı: `name` (TEXT, required), `email` (EMAIL, required),
   `message` (TEXTAREA, required), `isSystem: true`, `order` 0/1/2.
3. `CONTACT_FORM_NOTIFICATION` amaçlı, `isSystem: true`, `isActive: true`,
   `editorMode: BLOCKS` bir e-posta şablonu — blok editörünün canlı bir örneği olur.

**Karar: iletişim formu bir MODÜL DEĞİLDİR.** `MODULE_REGISTRY`'ye eklenmez; navigasyon
ve site ayarları gibi çekirdek bir site yeteneğidir ve açma/kapama `ContactForm.isEnabled`
ile zaten sağlanır. İkinci bir açma/kapama mekanizması (modül + isEnabled) kullanıcıyı
"kapalı ama neden görünmüyor" tuzağına düşürür.

#### 10.16.8 İletişim formu uçları

**Admin (SiteRole=ADMIN; gönderim okuma ADMIN veya EDITOR):**

| Uç | Yetki | Açıklama |
|---|---|---|
| `GET /admin/contact/form` | ADMIN | Form + alanlar (lazy-upsert varsayılanları) |
| `PATCH /admin/contact/form` | ADMIN | `{ title?, description?, submitLabel?, successMessage?, isEnabled?, notifyEmail?, notificationTemplateId?, consentRequired?, consentText?, consentLegalPageId?, retentionDays? }`. Audit `contact.form_update` |
| `PUT /admin/contact/form/fields` | ADMIN | **Tam değiştirme** (`PUT /admin/navigation` deseni). Audit `contact.fields_update` |
| `GET /admin/contact/submissions` | ADMIN, EDITOR | Cursor sayfalı (`seq DESC`), `?status=`, `?q=` (ad/e-posta), `?cursor=`, `?limit=` |
| `GET /admin/contact/submissions/{submissionId}` | ADMIN, EDITOR | Detay. **Okundu işaretlemez** (yan etkisiz GET) |
| `PATCH /admin/contact/submissions/{submissionId}` | ADMIN, EDITOR | `{ status }`. `READ`'e geçişte `readAt`/`readById` dolar. Audit `contact.submission_status_change` |
| `DELETE /admin/contact/submissions/{submissionId}` | ADMIN | 204. Audit `contact.submission_delete` (KVKK silme talebi karşılığı) |

`PUT /admin/contact/form/fields` doğrulaması: gövdedeki `key`'ler tekil olmalı; üç
sistem anahtarının (`name`,`email`,`message`) **hepsi bulunmalı** ve `type`'ları
değişmemiş olmalı — aksi halde 422. Sistem alanı silmeye çalışmak sessizce yok
sayılmaz, açıkça hata verir.

**Public (kimlik doğrulama YOK):**

| Uç | Açıklama |
|---|---|
| `GET /contact/form` | `isEnabled=false` ise **404**. Yanıt: alanlar + onay metni + hukuki sayfa bağlantısı. `notifyEmail`, `retentionDays`, `notificationTemplateId` **DÖNMEZ** (iç yapılandırma sızdırılmaz) |
| `POST /contact/submissions` | 201 `{ id, message }`. `message` = `successMessage` |

`POST /contact/submissions` gövdesi:
```jsonc
{
  "values": { "name": "…", "email": "…", "message": "…", "telefon": "…" },
  "consent": true,        // consentRequired ise zorunlu ve true olmalı
  "website": ""           // honeypot — bkz. §10.16.9
}
```

Doğrulama sırası ve davranış:
1. Form kapalıysa → 404.
2. Honeypot doluysa → **201 (sahte başarı)**, kayıt `status: SPAM`, e-posta GÖNDERİLMEZ.
3. `consentRequired && consent !== true` → 422.
4. `values` alan bazlı doğrulanır (`required`, `maxLength`, `EMAIL` formatı, `SELECT`
   değeri `options` içinde). Tanımsız anahtarlar **sessizce atılır** (kayda girmez) —
   kötü niyetli bir istemci `data`'yı şişiremesin.
5. Kayıt yazılır (`consentAt`, `consentTextSnapshot`, `ipAddress`, `userAgent`).
6. Bildirim e-postası gönderilir. **Gönderim hatası isteği DÜŞÜRMEZ**: `try/catch`,
   `notificationError` doldurulur, `app.log.error` yazılır, yanıt yine **201**.
   Ziyaretçi bizim SMTP arızamızın bedelini ödemez.

Bildirim, `notifyEmail` adresine, `notificationTemplateId` (ya da amacın aktif şablonu)
ile, değişken haritası `{ …values, form_title, submitted_at, submission_url }` olarak
gönderilir. `submission_url` = `${FRONTEND_URL}/admin/contact/submissions/{id}`.

#### 10.16.9 Kötüye kullanım koruması (security-agent gözden geçirir)

- **Rate limit** (`lib/rate-limit.ts`'e eklenir, §10.13.6 tablosuyla aynı üslup):
  - `CONTACT_SUBMIT_RATE_LIMIT = { max: 5, timeWindow: "1 minute" }` — IP tabanlı,
    route-level `config.rateLimit`.
  - `EMAIL_TEST_SEND_RATE_LIMIT = { max: 3, timeWindow: "1 minute" }`.
- **Honeypot:** public formda `website` adlı, CSS ile gizlenmiş, `tabindex="-1"`,
  `autocomplete="off"` bir alan. Doluysa 201 döner ama `SPAM` olarak kaydedilir —
  botun "başarısız oldum" sinyali almasını engeller.
- **Gövde boyutu:** `POST /contact/submissions` için toplam `values` serileştirilmiş
  boyutu ≤ 32 KB (Fastify global `bodyLimit` 5 MB+, tek başına yetersiz).
- **E-posta enjeksiyonu:** `notifyEmail` yalnızca ADMIN tarafından ayarlanır ve
  `z.string().email()` ile doğrulanır; ziyaretçinin girdiği `email` **hiçbir zaman**
  `to`/`from` başlığına konmaz (yalnızca gövdede değişken olarak, HTML-escape edilerek
  basılır — `renderTemplate` bunu zaten yapar). `Reply-To` başlığı v1'de EKLENMEZ
  (başlık enjeksiyonu yüzeyi açar; istenirse security-agent onayıyla eklenir).

#### 10.16.10 Saklama (retention) ve PII (compliance-agent gözden geçirir)

`ImportJob`'ın §10.8.8.1 deseniyle **birebir aynı** yaklaşım — tembel/bir sonraki
yazmaya bağlı tetikleme KABUL EDİLEMEZ, gerçek zaman-tetiklemeli scheduler kullanılır:

`backend/src/lib/contact-retention.ts` (YENİ), `app.ts::onReady` içinde **kendi
try/catch bloğunda** (mevcut 5 grubun yanına 6. grup olarak) kaydedilir:
- **30 gün:** `ipAddress`/`userAgent` `null`'lanır, `piiRedactedAt` yazılır.
- **`retentionDays` gün** (varsayılan 180): submission **kalıcı silinir**.
  `retentionDays = 0` → silme yok (compliance-agent onayı gerektiren özel durum).
- `onClose` ile kendi interval'ini temizler.

Ayrıca:
- Admin liste yanıtında e-posta **maskelenmez** (iş gereği: admin cevap yazacak),
  ancak `lib/pii-mask.ts::maskEmail` gelecekteki bir dışa aktarma için hazırdır.
- `logAudit` metadata'sına ziyaretçi adı/e-postası/mesajı **YAZILMAZ** (yalnızca
  `targetId`).
- `ContactSubmission` **`lib/export-storage.ts` / rapor dışa aktarmaya dahil edilmez**
  (yeni bir `ExportJobType` açılmaz) — bu turda kapsam dışı.

#### 10.16.11 Frontend veri akışı (frontend-agent)

**Şablon listesi** (`app/admin/notifications/templates/page.tsx` — yeniden yazılır):
`listTemplates()` → kart/tablo; sütunlar: ad, **kullanıldığı yer** (= `purpose`'un
Türkçe etiketi + `isActive` rozeti), son düzenleme (`updatedAt`, `date-fns` ile göreli),
durum. "Yeni Şablon" → amaç seçimli modal → `POST` → `[templateId]`'ye yönlendir.

**Editör** (`app/admin/notifications/templates/[templateId]/page.tsx`): üç sütun —
sol blok paleti, orta tuval (dnd-kit), sağ seçili blok ayarları + değişken paneli.

State (tek bir `useEmailTemplateEditor` hook'unda toplanır):
```ts
{
  template: EmailTemplate | null;
  name: string; subject: string;
  blocks: EmailBlock[];
  customVariables: EmailCustomVariable[];
  selectedBlockId: string | null;
  dirty: boolean;
  preview: { html: string; subject: string } | null;
  previewLoading: boolean;
}
```
- **Otomatik kaydetme YOK** (sayfa/blog editöründen bilinçli fark: e-posta şablonu
  canlı bir gönderim yolunu besler, yarım kaydedilmiş bir şablon gerçek kullanıcılara
  bozuk e-posta gönderir). Kaydet açık, `dirty` iken sayfadan ayrılma uyarısı.
- **Önizleme tek kaynaktan gelir:** istemci HTML üretmez, 500 ms debounce ile
  `POST /admin/notifications/templates/preview` çağrılır. İki render motoru (istemci +
  sunucu) sürüklenme (drift) demektir; §10.15.2'deki aynı "tek doğruluk kaynağı"
  ilkesi.
- **Önizleme `dangerouslySetInnerHTML` ile BASILMAZ.** `<iframe sandbox="" srcDoc={html}
  title="E-posta önizlemesi" />` kullanılır. İki gerekçe: (a) savunma derinliği —
  `sandbox` (allow-scripts YOK) script çalıştırmayı imkânsız kılar; (b) e-posta HTML'i
  satır-içi stil + tablo düzeni içerir ve admin panelinin Tailwind bağlamına
  sızdırılırsa hem görünüm bozulur hem önizleme yalan söyler.

**Değişken ekleme (imleç konumuna).** `useVariableTarget()` adında küçük bir kayıt
(registry) hook'u: değişken kabul eden HER alan (`subject` input'u, `heading.text`,
`button.label`, `button.href`, `footer.text`, ve `text` bloğunun TipTap editörü)
odaklandığında kendini "son hedef" olarak kaydeder. Değişken paneli:
- hedef bir TipTap editörüyse → `editor.commands.insertContent("{{key}}")`;
- hedef düz bir `<input>/<textarea>` ise → `selectionStart` konumuna metin eklenir ve
  imleç eklenen metnin sonuna taşınır;
- hiç hedef yoksa → buton `disabled` ve "Önce bir metin alanına tıklayın" ipucu
  (sessizce yanlış yere eklemek YASAK).

**dnd-kit.** `components/admin/navigation/nav-tree-editor.tsx`'teki mevcut kurulum
referans alınır: `PointerSensor` (`activationConstraint: { distance: 6 }`) +
`KeyboardSensor` (`sortableKeyboardCoordinates`), tek `SortableContext` +
`verticalListSortingStrategy` (e-posta blokları düz bir listedir, izdüşüm/projection
mantığı GEREKMEZ). `SortableContext`'in `items` dizisi `useMemo` ile stabil tutulur —
`PERFORMANCE_NOTES.md`'de belgelenmiş, ölçülmüş re-render tuzağı.

**İletişim formu ekranları.** `app/admin/contact/page.tsx` (form ayarları + alan
düzenleyici, alan sıralaması yine dnd-kit) ve `app/admin/contact/submissions/`
(liste + detay). Public form `app/[lang]/(site)/contact/page.tsx` — `GET /contact/form`
ile alanlar dinamik render edilir, gönderim `POST /contact/submissions`. Sidebar'a
"İletişim" girdisi eklenir.

#### 10.16.12 ui-designer'dan beklenen kararlar (kod yazmaz, token/desen tanımlar)

1. **Blok paleti**: sol panelde ikon+etiket listesi mi, üstte yatay çip şeridi mi;
   sürüklenebilir paletten mi yoksa tıkla-ekle mi (mimar tercihi: tıkla-ekle + tuvalde
   sürükle-sırala — palette sürükleme dnd karmaşıklığını iki katına çıkarır).
2. **Seçili blok** göstergesi (kenarlık/gölge/ofset) ve sürükleme tutamacı (drag
   handle) ikonu + hedef alanı boyutu. Renk tek başına gösterge OLAMAZ (WCAG 1.4.1).
3. **Değişken paneli**: chip listesi mi arama kutulu liste mi; Türkçe etiket birincil,
   `{{key}}` ikincil (mimar kararı) — tipografi/ton ölçeği ui-designer'ın.
4. **Blok stil kontrolleri**: renk seçici (mevcut `accent-color-picker.tsx` yeniden
   kullanılabilir mi), hizalama segment kontrolü, boşluk (`none/sm/md/lg`) token
   değerlerinin px karşılıkları — **e-posta için px değerleri ZORUNLU** (rem/CSS
   değişkeni e-posta istemcilerinde çalışmaz; ui-designer bu kısıtı bilerek karar verir).
5. **Önizleme çerçevesi**: masaüstü/mobil genişlik geçişi, iframe çerçeve stili.
6. **Şablon listesi** kart mı tablo mu (mevcut `content-list` deseni yeniden
   kullanılabilir mi) + "aktif/pasif" rozet tonu.
7. **Public iletişim formu** alan düzeni, hata durumu ve KVKK onay kutusu tipografisi.

Kapsam DIŞI (mimar kararı, tasarımcıya sorulmaz): blok tipi anahtarları, `data`
şemaları, değişken sözdizimi, iframe `sandbox` kullanımı, sunucu render'ı.

---

### 10.17 Sayfa içerik bloklarında Grid / Kolon düzeni

> **v3 ile SUPERSEDE edildi — bkz. §10.19.** Bu bölüm v1/v2'nin tarihsel karar kaydı olarak
> KORUNUR (silinmedi), ancak §10.19 yazıldıktan sonra artık GÜNCEL kontrat DEĞİLDİR:
> `type: "columns"` yeni kod tarafından bir daha ASLA üretilmez, yalnızca okunan/kabul
> edilen bir legacy şekildir. Derinlik kısıtı ("en fazla 1"), `hero` yasağı ve
> `MAX_COLUMNS_PER_ROW`/`MAX_BLOCKS_PER_COLUMN`/`MAX_TOTAL_BLOCKS` sabitleri §10.19'da
> DEĞİŞTİ — güncel değerler için §10.19.3'e bakın.

Durum: v2 (esnek N-sütun, **v3 tarafından supersede edildi**) · Sahibi: Mimar.

**v2 değişikliği (bu turda):** v1'in sabit `columnCount: 2|3` + `ratio` enum'u KALDIRILDI.
Bir satır artık "+" butonuyla sınırsız (pratikte `MAX_COLUMNS_PER_ROW=24`, salt DoS koruması)
sayıda sütuna büyüyebilir; her sütun kendi göreli genişlik ağırlığını (`width`, varsayılan 1 =
eşit pay) taşır. Ayrıntılar için bkz. §10.17.3 (güncellendi) ve §10.17.8 (yeni, v1→v2 geçiş
notları). §10.17.4/§10.17.5/§10.17.6'nın geri kalanı (derinlik-1 kısıtı, sanitize, SEO,
dnd-kit sözleşmesi, mobil tek kırılma noktası) DEĞİŞMEDİ.

#### 10.17.1 Kapsam düzeltmesi — bu YALNIZCA `Page` içindir, Blog DEĞİL

İstek "Sayfa/Blog içerik blokları" diyor, ancak **`BlogPost`'un blok sistemi YOKTUR**:
blog içeriği `BlogPost.contentHtml` alanındaki TipTap zengin metnidir (bkz. §10.15.1 —
oradaki tespitin tam tersi yönde aynı ayrım). Sütun düzeni **yalnızca
`Page.blocks`** (ve `Page.translations.<LOCALE>.blocks`) için tanımlanır. Blog'a
sütun getirmek, TipTap içinde bir "columns" node'u + `html-sanitize` allow-list'inde
`style`/grid desteği gerektirirdi — ayrı ve çok daha büyük bir iş, bu turda REDDEDİLDİ.

#### 10.17.2 db-agent için: **YAPILACAK HİÇBİR ŞEY YOK**

`Page.blocks` zaten `Json @default("[]")`. Yeni tablo, yeni kolon, migration
**GEREKMEZ**. Bu madde bilinçli olarak açıkça yazılmıştır ki db-agent boşuna bir
migration üretmesin (§10.15.1 ile aynı gerekçe).

#### 10.17.3 Veri modeli — iç içe `columns` konteyner bloğu

İki seçenek değerlendirildi:
- **(a)** Düz liste + her bloğa `layout: { span, row }` metadata'sı.
- **(b)** `type: "columns"` konteyner bloğu, çocukları içinde tutar.

**Karar: (b).** Gerekçe: (a)'da "hangi bloklar aynı satırda" bilgisi sıralamadan
TÜRETİLİR; sütunlar arası taşıma, araya blok ekleme ve kısmi güncelleme bu türetmeyi
bozar (bir bloğun silinmesi komşu satırı sessizce yeniden gruplar). (b)'de sahiplik
açıktır, dnd-kit'in resmî "multiple containers" örneği doğrudan uygulanabilir ve
sunucu doğrulaması yapısaldır.

```ts
export type PageBlockGap = "none" | "sm" | "md" | "lg";
export type PageColumnVerticalAlign = "top" | "center" | "bottom";

/** Bir sütunun İÇİNE konabilen bloklar — `columns` ve `hero` HARİÇ. */
export type LeafBlock =
  | TextBlock | ImageBlock | GalleryBlock | CtaBlock
  | FeaturedProductsBlock | FeaturedPortfolioBlock;

export interface PageColumn {
  id: string;
  /** Göreli genişlik ağırlığı (grid `fr` birimi) — varsayılan 1 (eşit pay). */
  width: number;
  blocks: LeafBlock[];
}

export interface ColumnsBlock {
  id: string;
  type: "columns";
  data: {
    gap: PageBlockGap;
    verticalAlign: PageColumnVerticalAlign;
    /** En az 2 — üst sınır `MAX_COLUMNS_PER_ROW` (24, salt DoS koruması, UX sınırı DEĞİL). */
    columns: PageColumn[];
  };
}

export type Block = HeroBlock | LeafBlock | ColumnsBlock;
```

Bağlayıcı kurallar:
- `columns.length >= 2` (tekil bir sütun anlamsızdır — "Tam Genişlik" zaten bunun
  karşılığıdır, aşağı bakınız); üst sınır `MAX_COLUMNS_PER_ROW = 24` (422, DoS koruması —
  kullanıcıya gösterilen bir "en fazla N sütun" mesajı DEĞİLDİR, pratikte hiç dokunulmaz).
- Sütun sayısı sabit bir `columnCount` alanıyla AYRICA TUTULMAZ — her zaman `columns.length`
  ile TÜRETİLİR (v1'deki "ikisi senkron kalmalı" kırılganlığı bu şekilde ORTADAN KALKAR).
- **Derinlik en fazla 1:** bir sütunun içine `columns` KONULAMAZ. `hero` de
  konulamaz (tam-genişlik banner'dır, dar bir sütunda anlamsızdır). İkisi de
  422 + `details.blocks`.
- Sütun başına en fazla **20** blok; sayfa başına (iç içe dahil) toplam en fazla
  **200** blok.
- **Mobil yığılma bir VERİ ALANI DEĞİLDİR.** `stackOnMobile` gibi her zaman `true`
  olan gizli bir bayrak eklenmez; yığılma tamamen CSS'tir (bkz. §10.17.5).

**"Tam Genişlik" bir düzen değeri değil, `columns` bloğunun YOKLUĞUDUR.** Editördeki "Düzen"
seçicisi (yalnızca sarmalanmamış tekil bloklarda görünür) bir sarmalama işlemidir; büyütme/
küçültme/kaldırma artık ayrı, satırın kendi kontrolleridir (v2, aşağıdaki §10.17.8):
- **Sarmalama** (`full → satır`): blok, 0. sütunu kendisi olan yeni, 2 sütunlu bir
  `ColumnsBlock` ile değiştirilir; 2. sütun boş başlar.
- **Büyütme** (satırın kendi "+" butonu): satırın sağına, seçilen türde yeni bir blok içeren
  bir sütun daha eklenir; TÜM sütunlar otomatik olarak eşit genişliğe (`width: 1`) sıfırlanır.
  Sabit bir üst sınır (eski "2 veya 3") YOKTUR.
- **Küçültme** (bir sütundaki bloğu silmek): o sütun BOŞALIRSA satırdan tamamen kaldırılır,
  kalan sütunlar eşit genişliğe yeniden dengelenir; **satırdaki BAŞKA, önceden zaten boş olan
  bir sütuna (doldurulmamış bir sürükle-bırak yer tutucusu) DOKUNULMAZ**. Tek sütuna düşen bir
  satır otomatik olarak Tam Genişliğe döner. İçerik kaybı YOK (silinen zaten kullanıcının
  bilerek sildiği blok), bu yüzden onay diyaloğu GEREKMEZ. Bir bloğu SÜRÜKLEYEREK başka bir
  sütuna taşımak bu otomatik küçültmeyi TETİKLEMEZ — kaynak sütun boşalsa bile boş bir bırakma
  alanı olarak KALIR (taşımak silmek DEĞİLDİR).
- **Kaldırma** (satırın kendi "Tam Genişlik" butonu, manuel unwrap): **VERİ KAYBI TUZAĞI.**
  Sütun 0 dışındaki sütunlarda blok varsa, bunlar **atılmaz**; tüm sütunların blokları soldan
  sağa, sütun içi sırayla düzleştirilip konteynerin yerine konur. Boş olmayan sütun varsa
  kullanıcıya onay diyaloğu gösterilir. Sessizce silmek YASAK.

#### 10.17.4 Backend — dokunulması ZORUNLU yerler

Bu maddenin **en kritik güvenlik bulgusu**: `modules/pages/lib/sanitize-blocks.ts`
bugün `blocks.map(...)` ile **yalnızca üst seviyeyi** dolaşıyor ve `type === "text"`
bloklarının `data.html`'ini temizliyor. Sütun içine konan bir `text` bloğu bu
döngüye **hiç uğramaz** → `sanitizeRichHtml` atlanır → public sayfada
`dangerouslySetInnerHTML` ile basılan **stored XSS**. Bu, sütun özelliği eklenirken
yapılabilecek en kolay ve en sessiz hatadır.

Yapılacaklar (backend-agent):
1. **`backend/src/lib/page-blocks.ts` (YENİ, paylaşılan):**
   `flattenPageBlocks(blocks: unknown[]): unknown[]` — `columns` bloklarının
   `data.columns[].blocks`'unu **doküman sırasında** (sütun 0 → sütun 1 → …)
   düzleştirir. Konteynerin kendisi de sonuçta yer alır.
2. **`sanitize-blocks.ts`:** `sanitizePageBlocks` bir seviye **özyinelemeli** olur —
   `type === "columns"` ise her sütunun `blocks`'unu aynı fonksiyondan geçirir.
   `sanitizePageTranslations` değişmeden bunu devralır (çeviri blokları da korunur).
3. **`lib/seo-score.ts`:** `collectPageImages`, `firstImageBlockUrl`, `collectPageText`
   `readBlocks(...)` yerine `flattenPageBlocks(readBlocks(...))` üzerinde çalışır.
   Aksi halde sütuna taşınan metin/görseller SEO skorunda **yok sayılır** ve kullanıcı
   içeriğini taşıdığı anda skorunun düştüğünü görür (sessiz gerileme).
4. **`modules/pages/pages.schemas.ts`:** `BlockSchema` bugün `z.record(z.unknown())` —
   tamamen serbest. **Bu serbestlik diğer tipler için KORUNUR** (minimum diff), yalnızca
   `type === "columns"` için dar bir şema devreye girer:
   ```ts
   const BlockSchema = z.record(z.unknown()).superRefine((block, ctx) => {
     if (block.type !== "columns") return;                 // eski davranış aynen
     const parsed = ColumnsBlockSchema.safeParse(block);    // dar, tam şema
     if (!parsed.success) { /* ctx.addIssue(...) */ }
   });
   ```
   `ColumnsBlockSchema` çocuklarda `type ∉ {"columns","hero"}` kuralını ve sayısal
   üst sınırları uygular.
5. `mappers/index.ts::toPageDto` ve `public-api.mappers.ts` **değişmez**
   (`blocks`'u olduğu gibi taşırlar) — ancak `docs/architecture/openapi.yaml`
   `PageBlock` açıklaması güncellenir.
6. `import.worker.ts` **değişmez** (içe aktarma her zaman tek bir `text` bloğu üretir).
7. `pages.routes.ts::applyLocale` **değişmez** (`PAGE_ARRAY_FIELDS = ["blocks"]`
   dizinin tamamını değiştirir, iç yapısına bakmaz).

#### 10.17.5 Public render ve responsive davranış

`components/site/blocks/index.tsx::BlockRenderer` `columns` dalını ekler ve **kendini
bir kez özyineler** (sütun içindeki bloklar aynı `switch`'ten geçer; `columns` içinde
`columns` şema düzeyinde imkânsız olduğu için sonsuz özyineleme riski yoktur).

Grid eşlemesi (mimar kararı — tek bir kırılma noktası, `md` = 768px; v2'de sabit
`grid-cols-N` sınıfları YERİNE, sütun sayısı/ağırlığı çalışma anında (runtime) belirlendiği
için inline `gridTemplateColumns` kullanılır — Tailwind arbitrary sınıfları derleme-zamanı
statik taramaya dayanır, dinamik `N` için ÇALIŞMAZ):

```
className="flex flex-col md:grid"
style={{ gridTemplateColumns: columns.map(c => `${c.width}fr`).join(" ") }}
```

Mobilde (`md` ALTI) `flex-col` tabanı geçerlidir — `display:grid` hiç aktifleşmediği için
`gridTemplateColumns` görmezden gelinir, sütunlar doğal akışta alt alta dizilir; ek bir
alan/JS gerekmez. `md` VE ÜZERİNDE `display:grid`e geçilir ve her sütun kendi `width`
ağırlığı kadar (`fr` birimi) yer kaplar — 2 sütun eşit ağırlıkla `1fr 1fr` (v1'in `1-1`'i ile
görsel olarak AYNI), `width:[2,1]` ise `2fr 1fr` (v1'in `2-1`'i ile AYNI oran, farklı
temsil). `verticalAlign` → `items-start | items-center | items-end`.
`gap` token'larının somut değerleri **ui-designer'ındır**; `md` kırılma noktası ve
sınıf iskeleti mimarın kontratıdır (renderer ile editör önizlemesinin aynı sınıfları
kullanması zorunludur, aksi halde WYSIWYG yalan söyler).

#### 10.17.6 Frontend — editör ve dnd-kit

`components/admin/page-builder/builder-canvas.tsx` çok konteynerli hâle gelir.
Konteyner kimliği sözleşmesi: kök liste `"root"`, her sütun `"col:<column.id>"`.

- `DndContext` **tek** ve `builder-canvas`'ın en dışındadır; `collisionDetection`
  `closestCenter` yerine **`closestCorners`** olur (çok konteynerli düzenlerde
  `closestCenter` boş/kısa konteynerlerde yanlış hedef seçer — dnd-kit'in belgelenmiş
  davranışı).
- Her sütun kendi `SortableContext`'ine sahiptir (`verticalListSortingStrategy`), kök
  liste de ayrı bir `SortableContext`'e.
- **Boş sütun tuzağı:** içinde hiç `useSortable` öğesi olmayan bir sütuna bırakma
  yapılamaz. Her sütun ayrıca `useDroppable({ id: "col:<id>" })` olmalı ve boşken
  görünür bir minimum yükseklikli bırakma alanı ("Buraya blok sürükleyin") render
  etmelidir.
- `onDragOver` konteyner değişimini (blok A sütunundan B sütununa geçtiğinde) anında
  uygular; `onDragEnd` yalnızca son sırayı sabitler — dnd-kit'in çok konteynerli
  örneğindeki standart bölünme.
- **Mevcut yukarı/aşağı ok butonları KALDIRILMAZ.** Sürükle-bırak eklenirken a11y
  yedeği olarak dururlar (`KeyboardSensor` sürüklemeyi klavyeyle mümkün kılsa da,
  ok butonları ekran okuyucu kullanıcıları için çok daha keşfedilebilir bir yoldur).
  Ayrıca sütunlar arası taşıma için ok butonlarının yanına "Sütuna taşı" menüsü
  eklenmesi **frontend-agent'ın takdirindedir**, zorunlu değildir.
- `context/page-builder-context.tsx` (v1'de eklenmişti) **KALDIRILDI** — hiçbir yerden
  import edilmiyordu (dead code, `builder-canvas.tsx` kendi yerel state'ini `blocks`/
  `onChange` prop'ları üzerinden yönetir); v2'nin `wrapInColumns`/`addColumnToRow`/
  `collapseColumnIfEmpty` API değişikliğiyle senkron TUTULMASI gereken kullanılmayan bir
  kopya bırakmamak için silindi.
- `lib/page-builder/registry.ts`'e `columns` **EKLENMEZ** — blok paletinde "Sütun"
  diye bir öğe yoktur; sütun, var olan bir bloğun "Düzen" seçiciyle sarmalanmasıyla
  ya da bir satırın kendi "+" butonuyla oluşur (istek metninin ifadesiyle birebir uyumlu).

#### 10.17.7 ui-designer'dan beklenen kararlar

1. **Satırın "+" (blok/sütun ekle) butonu** görsel dili — editörde satırın sağına eklenen
   bir uç, tıklanınca blok türü seçen bir açılır menü açar (v1'deki sabit "1/2/3 sütun ikon
   seçici" MADDESİ v2'de GEÇERSİZ, kaldırıldı).
2. `gap` token'larının (`none/sm/md/lg`) somut Tailwind karşılıkları.
3. Editördeki sütun konteynerinin görsel çerçevesi (kesikli kenarlık? etiket?),
   **boş sütun bırakma alanının** görünümü ve `MAX_COLUMNS_PER_ROW`'a (24) yaklaşan/eşit
   satırlarda **okunabilirlik uyarısının** (§10.17.3 v2 madde 2, non-blocking) görsel dili.
4. Sürükleme sırasındaki bırakma göstergesi (`DropIndicator`) —
   `components/admin/navigation/nav-tree-row.tsx`'teki mevcut desen yeniden
   kullanılabilir mi?
5. `verticalAlign` kontrolünün UI'da gösterilip gösterilmeyeceği ve her sütunun manuel
   genişlik ağırlığını (`width`) ayarlayan step control'ün görsel dili. **Şema ikisini de
   destekler**; açığa çıkarma/incelik kararı ui-designer'ındır.

Kapsam DIŞI (mimar kararı): `md` kırılma noktası, grid sınıf iskeleti, `columns` veri
şeması, derinlik kısıtı, `MAX_COLUMNS_PER_ROW` sayısal değeri (24).

#### 10.17.8 v1 → v2 geçiş notları (backward compatibility)

Bu turdan ÖNCE kaydedilmiş sayfalar `data.columnCount`/`data.ratio` alanlarıyla (v1 şekli)
DB'de duruyor olabilir. `GET` uçları bu alanı **yeniden doğrulamadan** ham JSON olarak döner
(bkz. `pages.routes.ts`) — bu yüzden:
- **Frontend (okuma):** hem admin editör (`builder-canvas.tsx::ColumnsContainerCard`) hem
  public render (`components/site/blocks/columns-block.tsx`) her sütunun `width`'ini
  SAVUNMACI okur (`c.width || 1`) — eski şekilde `width` hiç yoktur, sessizce 1 (eşit pay)
  varsayılır. `columnCount`/`ratio` alanları varsa yalnızca YOK SAYILIR (okunmaz).
- **Backend (yazma):** `modules/pages/pages.schemas.ts::BlockSchema` artık bir
  `superRefine` DEĞİL, bir `.transform()`'dur — `type: "columns"` bloklarını
  `ColumnsBlockDataPreprocessed` (bir `z.preprocess`) üzerinden geçirir: `columnCount`/
  `ratio` alanları varsa, `ratio`'nun görsel oranı (`2-1`→`[2,1]`, `1-2`→`[1,2]`, aksi halde
  eşit) her sütunun `width`'ine ÇEVRİLİR, `columnCount`/`ratio` DÜŞÜRÜLÜR. Sonuç: eski bir
  sayfa dokunulmadan (örn. başka bir alanı düzenlenip kaydedilirken) yeniden gönderilse
  bile veri KAYBOLMAZ, görsel oran KORUNUR ve bir sonraki yazımda otomatik olarak v2
  şekline geçer. Ayrı bir migration script'i YAZILMADI (bilinçli — lazy/on-write geçiş,
  INFRA.md'deki "additive, backward-compatible" DB migration felsefesiyle aynı ruh).

### 10.18 Admin kullanıcı silme — YUMUŞAK SİLME ve erasure sınırı

Durum: v1 · Sahibi: Mimar. Bağlayıcı kaynak: `openapi.yaml`
(`DELETE /admin/users/{userId}`, `POST /admin/users/{userId}/restore`,
`GET /admin/users?includeDeleted=`). Şema sahibi: db-agent
(migration `20260818074116_add_user_soft_delete`).

**Karar:** `DELETE /admin/users/{userId}` **fiziksel silme YAPMAZ**; kullanıcıyı
`status = DELETED` + `deletedAt = now()` durumuna alır (§10.7'deki içerik çöp kutusu
deseniyle aynı ruh) ve `POST /admin/users/{userId}/restore` ile geri alınabilir.

**Neden hard delete değil (üç bağlayıcı gerekçe):** (1) `Organization.ownerId` zorunlu
bir ilişkidir ve `onDelete` tanımlı değildir (Prisma varsayılanı `Restrict`) — organizasyon
sahibi bir kullanıcının fiziksel silinmesi FK hatasıyla 500 üretirdi; (2) `BlogPost`,
`Page`, `Product`, `PortfolioItem` yazarlıkları `onDelete: SetNull`'dır — fiziksel silme,
yayındaki içeriğin yazar bilgisini geri dönüşsüz koparırdı; (3) `AuditLog.actorId` de
`SetNull`'dır — denetim izinin aktör bağı kopardı, oysa §10.8.8.1 madde 4 audit
kayıtlarının bir silme talebiyle otomatik kaybolmaMAsını şart koşar.

**Veri modeli etkisi (db-agent — TEK SAHİP, uygulandı):** `SiteUserStatus` enum'una
`DELETED` değeri; `User.deletedAt DateTime?` alanı. Enum değeri eklemek geri alınamaz bir
işlemdir (`ALTER TYPE ... ADD VALUE`) — bu yüzden migration izole/tek başına gönderildi
(`ImportJobType.PRODUCTS` ile aynı ilke). ER özeti için bkz. §6.

**Davranış özeti (ayrıntı ve hata kodları `openapi.yaml`'da — tek doğru kaynak):**
- Silme atomiktir (tek Serializable transaction): `status`/`deletedAt` yazımı + TÜM
  `RefreshToken` iptali + bekleyen `PasswordResetToken` geçersizleştirmesi +
  `user.delete` audit kaydı. İçerik/medya/organizasyon kayıtlarına DOKUNULMAZ.
- `DELETED` kullanıcı kimlik doğrulamada `SUSPENDED` ile BİREBİR aynı muamele görür
  (`middleware/authenticate.ts`, `auth.service.ts`) — token ömrü boyunca erişim devam
  ETMEZ.
- `DELETED` kullanıcı diğer admin uçlarında "yok" sayılır (404); `GET /admin/users`
  varsayılan olarak gizler, `includeDeleted=true` ile görünür.
- Silme idempotent DEĞİLDİR; "kendi hesabını silme" ve "son aktif ADMIN" yasakları
  409 döner ve son-admin kontrolü yazımla AYNI transaction içinde yapılır (TOCTOU).
- Geri yükleme yalnızca `status`/`deletedAt`'i eski hâline döndürür; iptal edilen
  oturumlar KASITLI OLARAK geri gelmez.

#### 10.18.1 Unutulma hakkı (erasure/anonimleştirme) — KAPSAM DIŞI, backlog maddesi

**Bu uç bir YÖNETİMSEL silmedir** ("bu kişi artık ekipte değil"). KVKK m.11 / GDPR
Art. 17 **unutulma hakkını KARŞILAMAZ**: ad, e-posta, `passwordHash`, `lastLoginAt`,
`AuditLog.actorEmail` ve varsa `ImportJobError.rawData` içindeki kişisel veriler satırda
DURMAYA DEVAM EDER. Ürün yüzeyinde (UI metni, dokümantasyon, müşteriye verilen taahhüt)
bu uç "verilerinizi sileriz" gibi SUNULMAMALIDIR — architect kararı, bağlayıcı.

**Devir:** Gerçek, geri döndürülemez anonimleştirme AYRI bir iştir ve bu turun kapsamına
ALINMAMIŞTIR. Sahiplik: **compliance-agent** (hangi alanın silineceği/anonimleştirileceği,
hangi kaydın hukuki gerekçeyle saklanacağı, süreler) + **db-agent** (şema/migration ve
`onDelete` davranışları). backend-agent yalnızca çıkan politikayı UYGULAR, kendi başına
tasarlamaz. Bu iş açılana kadar madde bu bölümde **açık** kalır.

**Bu iş açıldığında ZORUNLU olarak kapsanacaklar (ön çalışma, bağlayıcı çerçeve):**
1. `User` satırı için "anonimleştir" semantiği: `email` → geri döndürülemez benzersiz
   yer tutucu, `name` → sabit etiket (örn. "Silinmiş kullanıcı"), `passwordHash`/
   `avatarUrl`/`twoFactorSecret`/`lastLoginAt` → `null`. Satırın KENDİSİ, §10.18'deki
   üç FK gerekçesi nedeniyle yine SİLİNMEZ.
2. `AuditLog.actorEmail` gibi denormalize PII kopyaları ve `ImportJobError.rawData`/
   `sourceRef` eşleşmeleri (§10.8.8.1 madde 4'te tanımlı redaksiyon adımı) aynı akışta
   ele alınmalıdır — `AuditLog` satırlarının KENDİSİ talep üzerine otomatik silinMEZ,
   ancak bu istisna §10.8.8.1 madde 3'teki tanımlı/sonlu `AuditLog` saklama süresinin
   var OLMASINA bağlıdır ("sınırsız süre" bir istisna gerekçesi olamaz).
3. Anonimleştirme **geri alınamaz** olduğundan `restore` ile çelişir: akış, kaydı önce
   `DELETED` durumuna alıp tanımlı bir bekleme penceresi sonunda anonimleştirmeli veya
   anonimleştirmeyi ayrı ve açıkça onaylanan bir ADMIN aksiyonu yapmalıdır — seçim
   compliance-agent + db-agent'ındır.
4. Yeni bir audit aksiyonu (`user.anonymize`) ve kendi hız sınırı/RBAC eşiği tanımlanmalı;
   security-agent akışı gözden geçirmelidir.

### 10.19 Sayfa içerik bloklarında hiyerarşik konteyner (`container`) mimarisi — v3

Durum: v3 · Sahibi: Mimar. Bağlayıcı kaynak: `.claude/design-notes-page-builder-containers.md`
(tam gerekçe/kararlar) + `openapi.yaml` (`PageBlock`/`PageContainerNode`/
`PageContainerSettings`/`PageContainerSpacing`/`PageContainerBackground`, tek doğru kaynak).
**§10.17 (v1/v2) bu bölümle SUPERSEDE edilir** ama silinmez — tarihsel karar kaydı olarak
kalır. Kapsam AYNI: **yalnızca `Page.blocks`** (ve `Page.translations.<LOCALE>.blocks`);
`BlogPost`'un blok sistemi YOKTUR (§10.17.1 aynen geçerli).

#### 10.19.1 Neden v2'den v3'e geçildi

v2'de bir "sütun" (`columns` bloğu) yalnızca bir satırın İÇİNDE, en fazla 1 seviye derinlikte
var olabilen, kendi başına görsel bir anlamı olmayan saf bir sarmalayıcıydı (arka plan/
min-height/dolgu yoktu). Bu, Elementor/Gutenberg'deki "Section/Container" desenini
karşılamıyordu ve `hero` gibi tam-genişlik bloklar bir sütunun içine hiç giremiyordu. v3
bunu tek bir kanonik **`container`** düğümüyle değiştirir: kendi başına görsel bir varlıktır
(layout/min-height/boşluk/arka plan), keyfi derinlikte iç içe geçebilir (sınırlı) ve `hero`
dahil HERHANGİ bir içerik bloğunu barındırabilir.

#### 10.19.2 db-agent için: **YAPILACAK HİÇBİR ŞEY YOK**

`Page.blocks` zaten `Json @default("[]")`. Yeni tablo/kolon/migration/backfill job
**GEREKMEZ** (§10.17.2 ile aynı gerekçe, yapısal derinliğe yükseltilmiş hali).

#### 10.19.3 Veri modeli

Kanonik hedef dosyalar: backend `pages.schemas.ts` (zod), frontend
`lib/page-builder/types.ts` (TypeScript) — sayısal sabitler ARALARINDA BİREBİR AYNI olmak
ZORUNDADIR (code-quality-agent PR checklist kalemidir).

```ts
export type PageNode = ContainerNode | ContentBlock;   // Page.blocks: PageNode[]

export interface ContainerNode {
  id: string;
  type: "container";
  settings: ContainerSettings;
  children: PageNode[];        // en fazla MAX_CHILDREN_PER_CONTAINER (24)
}

export interface ContainerSettings {
  layout: "boxed" | "full-width";     // boxed → ortalanmış + customWidth; full-width → w-full
  customWidth?: number;               // yalnızca boxed; 320–1920, varsayılan 1170
  minHeight?: { value: number; unit: "px" | "vh" };  // SERBEST STRING DEĞİL (§10.19.4)
  direction: "row" | "column";
  justifyContent: "start" | "center" | "end" | "between" | "around" | "evenly";
  alignItems: "stretch" | "start" | "center" | "end";
  gap: number;                        // px, 0–128
  padding: { top: number; right: number; bottom: number; left: number };  // 0–200, negatif YASAK
  margin: { top: number; right: number; bottom: number; left: number };   // 0–200, negatif YASAK
  background:
    | { type: "none" }
    | { type: "color"; value: string }                          // hex regex
    | { type: "image"; value: string; position; size; repeat };  // protokol beyaz listesi
  widthFr?: number;   // yalnızca direction:"row" EBEVEYN içinde anlamlı — CSS flex-grow
}
```

**Kök şekil DEĞİŞMEDİ:** `Page.blocks` hâlâ bir `PageNode[]` **dizisidir** — tek bir kök
`Container` nesnesine GEÇİLMEDİ (bilinçli red, gerekçe: `pages.routes.ts::applyLocale`'in
`PAGE_ARRAY_FIELDS` mekanizması, openapi'deki 5 ayrı `type: array` tanımı, mevcut DB
satırlarının hepsinin `[]` olması — nesneye geçiş zorunlu bir migration üretirdi). Kök dizi
**örtük (implicit) bir root container**'dır: `direction: "column"`, `layout: "full-width"`,
`gap: 0`, `padding/margin: 0` sabittir ve HİÇBİR YERDE serileştirilmez. Kullanıcı sayfanın
tamamına arka plan/genişlik vermek isterse kök diziye kendi `container`'ını ekler.

`data` (içerik) ile `settings` (sunum) ayrımı bilinçlidir: içerik blokları (`hero`/`text`/
`image`/`gallery`/`cta`/`featured-*`) `data` taşır, `container` düğümleri `settings`+
`children` taşır — bir konteynerin `data`'sı, bir içerik bloğunun `settings`'i YOKTUR.

#### 10.19.4 DoS / güvenlik sınırları

| Sabit | Değer | Not |
|---|---|---|
| `MAX_CONTAINER_DEPTH` | **4** (kök=1) | Yaprak bloklar en fazla 5. seviyede. v2'nin "en fazla 1" kısıtından yükseltildi. |
| `MAX_CHILDREN_PER_CONTAINER` | **24** | Yalnızca GERÇEK `container.children` dizilerine uygulanır — **kök `Page.blocks` dizisi bu sınıra TABİ DEĞİLDİR** (architect onaylı netleştirme, security-agent ön denetimi §13.2; v2'de de kökte ayrı bir "max children" YOKTU, bu davranış korunur). |
| `MAX_TOTAL_PAGE_NODES` | **300** | Konteynerler DAHİL, sayfa başına toplam düğüm. v2'nin 200'ünden yükseltildi (bir legacy `columns` normalize edilince `1 + N + M` düğüme dönüşür; 200'de kalmak mevcut sınıra yakın sayfaların ilk kaydında sebepsiz 422 üretirdi). |
| `MAX_PAGE_BLOCKS_BYTES` | **256 KB** | YENİ — §10.16'daki e-posta blokları tavanıyla aynı desen. Fastify'nin global `bodyLimit`'i (~5 MB) tek başına yeterli değildir. |

**Bağlayıcı doğrulama sırası** (`backend/src/lib/page-blocks.ts::scanPageNodeStructure` +
`pages.schemas.ts::PageBlockListSchema`):

```
1. Fastify bodyLimit (~5 MB, mevcut)
2. scanPageNodeStructure(raw)   ← İTERATİF (explicit stack), ÖZYİNELEME YOK — derinlik/
                                   toplam-düğüm/konteyner-başına-çocuk BURADA ölçülür/reddedilir
3. JSON.stringify + byte tavanı (256 KB)   ← try/catch'e alınır (defense-in-depth)
4. z.record(...).transform(...) özyinelemeli şema parse'ı   ← ARTIK GÜVENLİ (derinlik ≤4 garantili)
5. sanitizePageBlocks (özyinelemeli, kendi bağımsız depth-cutoff'u MAX_CONTAINER_DEPTH+2 ile)
```

Bu sıra **kritik**: `scanPageNodeStructure` zod'un özyinelemeli parse'ından ÖNCE çalışmak
ZORUNDADIR — aksi halde derinlik sınırının KENDİSİ zod'un parse'ı stack'i taşırarak bir
`RangeError`'a (temiz 422 yerine crash'e) dönüşür. İlk tasarım taslağında bu sıra
`JSON.stringify → scanPageNodeStructure` idi — security-agent ön denetimi (`.claude/
design-notes-page-builder-containers.md` §13.1) bunun da aynı DoS'a açık olduğunu tespit
etti (`JSON.stringify` V8'de özyinelemelidir), sıra düzeltilerek uygulandı. **İmza regresyon
testi:** 10.000 seviye derinlikte bir payload `RangeError` fırlatmadan temiz `422` döner
(`backend/tests/unit/pages-container-schema.test.ts`).

**CSS enjeksiyonu kapatma:** `settings`'in tamamı render motorunda DOĞRUDAN inline `style`'a
beslenir ve `sanitizePageBlocks` yalnızca `data.html`'e bakar, `settings`'e HİÇ bakmaz — bu
yüzden HER `settings` alanı ya sayısal (aralık sınırlı) ya kapalı bir enum ya da dar bir
regex/protokol-beyaz-listesidir, HİÇBİRİ serbest CSS string'i DEĞİLDİR:
- `minHeight` kullanıcı isteğindeki serbest `string` yerine `{ value: number; unit: "px"|"vh" }` (mimar tarafından bilinçli red — §10.19.3).
- `background.value` (renk) → `#rgb`/`#rrggbb`/`#rrggbbaa` regex'i.
- `background.value` (görsel URL'i) → CSS-bağlamından-kaçış karakter kara listesi (`"'()\;{}<>`+boşluk) **VE** protokol beyaz listesi (`/`, `https://`, `http://` DIŞINDA HER ŞEY, özellikle `javascript:`/`vbscript:`/`data:`, reddedilir — kara liste tek başına `%` URL-encoding'i ile atlatılabilirdi, security-agent ön denetimi §13.3).
- `padding`/`margin` negatif YASAK (0–200) — çift gerekçe: (1) editör içi UX-tuzağı, (2) güvenlik: düşük yetkili bir Editor'ün public sayfada bir elemanı başka bir elemanın üzerine görünmez taşıyıp UI-redressing/tıklama-tuzağı üretmesi (§13.4).

#### 10.19.5 Render motoru (public + editör önizlemesi — AYNI sınıf/style tablosu, WYSIWYG için zorunlu)

**Flexbox** (CSS Grid DEĞİL — v2'nin kararı tersine çevrildi): `direction`/`justifyContent`/
`alignItems`/`gap` flexbox semantiğidir; `widthFr` → `flex: <n> 1 0%` (v2'nin `<n>fr`'ıyla
matematiksel olarak birebir aynı sonuç). İç içe geçmede flex, grid'e göre çok daha
öngörülebilirdir.

Statik değerler → Tailwind sınıfı (JIT taranabilir sabit tablo); dinamik değerler (px/oran/
renk/url) → inline `style` (Tailwind arbitrary class KULLANILMAZ — derleme-zamanı statik
tarama dinamik `N` için çalışmaz, §10.17.5'teki `gridTemplateColumns` kararıyla aynı ilke).
Gerçek implementasyon: `frontend/src/components/site/blocks/container-block.tsx`.

Mobil davranış: `direction: "row"` HER ZAMAN `flex-col md:flex-row`'a çevrilir — `stackOnMobile`
gibi bir veri alanı YOKTUR (§10.17.3'ün kararı aynen geçerli).

**"Chrome" sözleşmesi (§6.3, gözden kaçırılması KOLAY):** yaprak bloklar (`text`/`hero`/`cta`/
`gallery`) kendi dış gutter'larını (`px-4 py-8` vb.) taşır. `BlockRenderer({ nodes, chrome })`:
kök dizideki yaprak bloklar `chrome: "page"` (bugünkü davranış birebir korunur); bir
`container`'ın içindeki yaprak bloklar `chrome: "bare"` (kendi gutter'ını bırakır, boşluk
konteynerin `padding`/`gap`'inden gelir). **Bilinçli, dokümante edilmiş görsel sapma:**
legacy bir `columns` sütunundaki blokların birkaç piksellik iç dolgu farkı olabilir (satır/
sütun geometrisi piksel-piksel korunur, yalnızca sütun-içi blokların kendi iç dolgusu
değişir) — bu bir hata değil, çift-gutter'ın giderilmesidir.

#### 10.19.6 Backend — dokunulması ZORUNLU yerler (özet, ayrıntı tasarım notu §5)

1. **`backend/src/lib/page-blocks.ts`:** `scanPageNodeStructure` (YENİ, iteratif) +
   `flattenPageBlocks` (özyinelemeliden **iteratife** çevrildi, imza DEĞİŞMEDİ —
   `seo-score.ts` tüketicisi korunur, `container.children`'ı da düzleştirir).
2. **`pages.schemas.ts`:** `PageBlockListSchema` (tek giriş noktası) + `PageNodeSchema` +
   `ContainerNodeSchema` + `LegacyColumnsNodeSchema` (`z.preprocess` ile sessiz
   `columns → container` çevrimi — 422 VERMEZ). `refineTotalBlockCount` KALDIRILDI (kontrol
   artık `PageBlockListSchema` içinde, doğru sırada). `TranslationsSchema` AYNI şemaya bağlı.
3. **`sanitize-blocks.ts`:** `container.children` özyineleme dalı (**ZORUNLU, atlanırsa
   §10.17.4'teki stored XSS YENİDEN AÇILIR**) + `columns` (legacy) dalı AYNEN KORUNUR (eski
   `PageRevision` snapshot'ları hâlâ bu şekilde olabilir) + bağımsız depth-cutoff
   (`MAX_CONTAINER_DEPTH + 2`, snapshot'lar yeni şemadan hiç geçmediği için).
4. `seo-score.ts` **değişmez** (flatten üzerinden otomatik kazanır — derinlikten bağımsız
   sayım, bkz. openapi.yaml `SeoScoreIssue`).
5. Mapper'lar (`mappers/index.ts::toPageDto`, `public-api.mappers.ts`) **değişmez** — `blocks`
   olduğu gibi taşınır.

#### 10.19.7 Geriye dönük uyumluluk / migration stratejisi

**DB migration script'i YOK.** İki katmanlı BC (§10.17.8'in yapısal seviyeye yükseltilmiş
hali): (a) backend `z.preprocess` ile **yazma anında** `columns → container`, (b) frontend
`lib/page-builder/normalize.ts::normalizePageNodes()` ile **okuma anında** — GET yanıtı
re-validate edilmeden ham JSON döndüğü için (`pages.routes.ts`) bu adım gereklidir. Admin
editör ve public render kökü (sayfa bileşenleri) TAM OLARAK iki giriş noktasından bu
fonksiyonu çağırır; aşağı akıştaki hiçbir bileşen legacy şekil GÖRMEZ.

Neden batch backfill YAZILMADI: `Page.blocks` bir `Json` kolonudur, `PageRevision`
snapshot'ları **tanım gereği geçmişin fotoğrafıdır** (topluca düzenlemek "geri yükle"nin
verdiği sözü bozar) — okuma-anında normalizasyon HER KOŞULDA gereklidir, backfill onu ortadan
KALDIRMAZ, yalnızca üstüne risk ekler. Çıkış stratejisi (deferred): telemetri/DB sorgusuna
göre hiçbir canlı `Page.blocks`/son-N-revizyon `columns` içermediğinde ayrı bir turda şim
kaldırılır — **bu turda YAPILMADI**.

| Senaryo | Davranış |
|---|---|
| v1 sayfa (`columnCount`/`ratio`), dokunulmadan görüntülenir | `normalizePageNodes` görsel oranı korur |
| v2 sayfa (`width`), dokunulmadan görüntülenir | `width → widthFr` birebir, piksel parite |
| v1/v2 sayfa başka bir alanı düzenlenip kaydedilir | Editör normalize edilmiş ağacı gönderir → DB'ye `container` yazılır |
| Eski istemci hâlâ `columns` gönderirse | Backend kabul eder, `container` olarak yazar — 422 VERMEZ |
| Eski `PageRevision` geri yüklenirse | Restore yazma yolundan geçer → `container` olur |
| `hero` bir konteyner içindeyken | Artık GEÇERLİ (v2 yasağı kaldırıldı) |

#### 10.19.8 Frontend — editör, palette, dnd-kit (özet)

- `lib/page-builder/types.ts`, `normalize.ts` (YENİ), `containers.ts` (YENİ — ağaç işlemleri:
  `findNode`/`insertNode`/`removeNode`/`moveNode`/`wrapInContainer`/`unwrapContainer`/
  `isDescendant` vb.), `presets.ts` (YENİ — 7 Layout Picker ön ayarı). `columns.ts` **SİLİNDİ**.
- Palette **iki bölüme** ayrılır: **Düzen** (7 ızgara ön ayarı, `LAYOUT_PRESETS`) ve **İçerik**
  (mevcut 7 blok, `blockRegistry` DEĞİŞMEDİ). §10.17.6'nın "columns palette'e EKLENMEZ" kararı
  **GEÇERSİZ KILINDI** — bir konteyner artık kendi başına görsel bir varlık olduğu için boş
  ekleyip doldurmak birincil akıştır.
- dnd-kit konteyner kimliği v3: kök `"root"`, her konteyner `"container:<id>"` (v2'nin
  `"col:<id>"` biçimi kaldırıldı). Tek `DndContext` + her konteyner kendi
  `useDroppable`/`SortableContext`'i; `isDescendant` guard'ı bir konteynerin kendi torununun
  içine bırakılmasını engeller. Yukarı/aşağı ok butonları KORUNUR (a11y yedeği).
- `wrapInColumns`/`unwrapColumns` → `wrapInContainer`/`unwrapContainer`; veri kaybı
  tuzağı koruması (`needsConfirmToUnwrap` + onay diyaloğu) AYNEN KORUNUR.

#### 10.19.9 Kapsam dışı (bilinçle ertelendi, v4 adayı)

Cihaz-bazlı (responsive) ayar setleri (Desktop/Tablet/Mobile sekmeleri), negatif margin,
arka plan overlay/gradient/video, global "bölüm şablonu" (saved sections) kütüphanesi, legacy
`columns` şiminin kaldırılması (çıkış koşulu §10.19.7'de tanımlı), blog'a konteyner getirmek
(§10.17.1 kararı geçerli), `Page.blocks`'un JSON'dan ilişkisel tabloya taşınması. Ayrıntılı
gerekçeler: `.claude/design-notes-page-builder-containers.md` §11.

### 10.20 Sayfa düzenleyicide standart/gelişmiş mod ayrımı

> **⚠ KISMEN YÜRÜRLÜKTEN KALDIRILDI (2026-08-23, §10.21).** Bu bölümün **mekanizma**
> kısmı (`TEMPLATE_EDITABLE_FIELDS` haritası, `assertTemplateEditAllowed` iteratif diff'i,
> 403 sözleşmesi, autosave/`translations` kapsaması) TAMAMEN GEÇERLİDİR ve değişmemiştir.
> Ancak **yetenek modeli** değişmiştir:
> `User.advancedBuilderEnabled` kolonu, `PATCH /admin/users/{userId}/builder-access` ucu ve
> `requireAdvancedBuilder()` middleware'i **KALDIRILMIŞTIR**;
> `canUseAdvancedBuilder` artık saf bir rol türevidir: **`role === "ADMIN"`**.
> Aşağıda "gelişmiş yetenekli EDITOR", "yetenek bayrağı", "standart kullanıcı" geçen her
> yeri §10.21'e göre okuyun. Çelişkide **§10.21 kazanır.**

Durum: v1.1 (2026-08-23'te standart kullanıcı kilidi genişletildi — bkz. aşağıdaki güncelleme
notu) · Sahibi: Mimar. Bağlayıcı kaynak: `.claude/architect-scope-page-editor-roles.md`
(tam gerekçe/kararlar, ajan görev dağılımı) + `openapi.yaml` (`User.canUseAdvancedBuilder`,
`AdminUser.advancedBuilderEnabled`, `PageEditMode`, `Page.editMode`,
`UpdateAdminUserBuilderAccessRequest`, `PermissionsMatrix.capabilities` — tek doğru kaynak).
Kapsam: yalnızca sayfa yönetim sistemi (`Page.blocks`) — blog/ürün/portföy editörleri bu
turun DIŞINDA (§10.19.1 ile aynı kapsam sınırı, ayrıca bkz. kaynak doküman §8).

> **GÜNCELLEME (2026-08-23, kullanıcı talebiyle kapsam genişletildi):** v1'de standart
> kullanıcının yapısal kilidi yalnızca `Page.editMode === "TEMPLATE"` olan sayfalarda
> uygulanıyordu (FREEFORM sayfada standart kullanıcı da yapıyı serbestçe değiştirebiliyordu).
> Kullanıcı bunu YETERSİZ buldu: standart kullanıcının yapısal değişiklik yapamaması kuralı
> artık `editMode` DEĞERİNDEN TAMAMEN BAĞIMSIZ — yalnızca `canUseAdvancedBuilder`
> (§10.20.2) belirleyicidir. `editMode` alanının kendisi (FREEFORM/TEMPLATE, kim
> değiştirebilir, backfill/migration) DEĞİŞMEDİ; yalnızca "standart kullanıcı ne zaman
> kısıtlanır" kuralı genişledi. Aşağıdaki §10.20.3/§10.20.4/§10.20.6, bu genişletilmiş
> davranışı yansıtacak şekilde güncellenmiştir. Kod tarafı: `backend/src/modules/pages/
> pages.routes.ts` (`isStructureRestricted = !canUseAdvancedBuilder(request.user!)`, artık
> `existing.editMode`'a bakmıyor) ve `frontend/src/app/admin/pages/[pageId]/page.tsx`
> (`simpleMode = !canUseAdvancedBuilder`). Test kapsamı: `TEST_COVERAGE.md` §"10.20
> GENİŞLETME" (FREEFORM e2e senaryoları 7-10).

#### 10.20.1 Neden bu bölüm var

Kullanıcı isteği "Admin/Editor tam yetkili, Standart/Yazar kısıtlı" idi, ama `SiteRole` =
`ADMIN`\|`EDITOR`\|`VIEWER` — istenen "Yazar" rolü kod tabanında YOKTU ve istenen kısıt
("başlığı değiştir, konteyner ekleme") **uç (endpoint) seviyesinde değil, tek bir isteğin
gövdesi içindeki alan seviyesinde**. `requireSiteRole` bu granüleriteyi yapısal olarak
çözemez — bu tespit aşağıdaki iki mimari kararın belirleyicisidir.

#### 10.20.2 Rol modeli — yeni `SiteRole` değeri DEĞİL, kullanıcı-başı yetenek (capability) bayrağı

```
Depolanan (DB):    User.advancedBuilderEnabled  Boolean  @default(false)
Türetilen (DTO):   User.canUseAdvancedBuilder    boolean  (salt-okunur)

canUseAdvancedBuilder = (role === "ADMIN") || advancedBuilderEnabled === true
```

`SiteRole` enum'ına DOKUNULMADI, `AUTHOR` diye bir rol EKLENMEDİ. "Standart/Yazar" =
`EDITOR` + `advancedBuilderEnabled: false`. Kısa gerekçe:

1. **Yanlış granülarite.** `SiteRole` uçlara erişimi yönetir; istenen kısıt bir `PATCH`
   gövdesinin İÇİNDE, düğüm bazında uygulanmak zorunda — enum değeri eklemek sorunun
   `requireSiteRole` ile çözüldüğü yanılsamasını yaratırdı, gerçek iş yine gövde
   seviyesinde ayrıca yazılırdı.
2. **Patlama yarıçapı.** Kod tabanında ~40 ayrı `requireSiteRole("ADMIN","EDITOR")` çağrısı
   var; yeni bir enum değeri her birinin tek tek gözden geçirilmesini gerektirirdi (unutulan
   tek yer = sessiz ayrıcalık sızıntısı ya da kırık özellik).
3. **Geri alınamazlık.** PostgreSQL'de `ALTER TYPE ... ADD VALUE` geri alınamaz
   (`schema.prisma`'da zaten iki yerde not edilmiş); boolean bir kolon her iki yöne serbestçe
   çevrilebilir.
4. **"EDITOR'ü ikiye bölmek" de reddedildi** — yayındaki her EDITOR hesabının yetkisini
   sessizce daraltırdı, kullanıcının açık isteğinin ("Editor tam yetkili") tersi olurdu.

`advancedBuilderEnabled` (verilen izin, yazılabilir) ile `canUseAdvancedBuilder` (etkin
yetenek, salt-okunur, türetilmiş) ayrı tutulur. **ADMIN için etkin değer DB'ye bakılmaksızın
her zaman `true`'dur** — kilitlenme güvenliği (`assertNotLastActiveAdmin` ile aynı refleks):
aksi halde bir yönetici kendi dahil tüm hesapların yeteneğini kapatıp geri dönüş yolu
bırakmayabilirdi. Türetme **tek bir yardımcıda** yapılır: `backend/src/lib/builder-capability.ts`;
hiçbir route kendi `role === "ADMIN" || ...` ifadesini kopyalamaz.

Bu, projenin **tek** kullanıcı-başı yetenek bayrağıdır — ikinci bir `User.canX` ihtiyacı
doğduğunda doğru cevap yeni bir boolean değil, gerçek bir `Permission` tablosudur; o karar
architect'e eskale edilir.

#### 10.20.3 `Page.editMode` — sayfa seviyesinde mod, blok bazlı kilit YOK

```prisma
enum PageEditMode {
  FREEFORM  // Serbest tasarım (varsayılan)
  TEMPLATE  // Şablon — "bu sayfa bir şablon olarak tasarlandı" etiketi
}

model Page {
  editMode PageEditMode @default(FREEFORM)
}
```

Varsayılan/backfill: kolon varsayılanı `FREEFORM`, mevcut TÜM sayfalar `FREEFORM` başlar →
davranış değişikliği sıfır, veri migration'ı gerekmez.

> **GÜNCELLEME (2026-08-23):** yukarıdaki enum yorumu bilinçli olarak `TEMPLATE`'in eski
> ("standart kullanıcı yalnızca içerik alanlarını doldurur") anlamını TAŞIMAZ hale
> getirilmiştir — bu artık YANLIŞ olurdu. §10.20 girişindeki güncelleme notuna bkz: standart
> kullanıcının yapısal kilidi `editMode`'dan TAMAMEN bağımsızdır (`canUseAdvancedBuilder`
> tek belirleyici). `editMode` alanı artık salt **gelişmiş kullanıcıya gösterilen kozmetik
> bir rozet/ipucu**dur — "bu sayfa bir şablon olarak tasarlandı, standart kullanıcılara
> devredilebilir" bilgisini taşır, ama bu bilgiyi hiçbir yetkilendirme kararı OKUMAZ; alan
> `TEMPLATE_EDITABLE_FIELDS` guard'ının (§10.20.4) çalışıp çalışmayacağını ETKİLEMEZ —
> guard artık `editMode`'dan BAĞIMSIZ olarak, standart kullanıcının her `PATCH`/autosave
> isteğinde çalışır.

Blok/düğüm bazlı `isLocked: boolean` bu turda bilinçli olarak **eklenmedi**. Gerekçe
(güvenlik, belirleyici): `isLocked` `Page.blocks` JSON'unun içinde yaşardı, ama `blocks`
yetkilendirilmeye çalışılan isteğin **kendi gövdesidir** — standart kullanıcı kendisini
kısıtlayan bayrağı `false` göndererek kendi kendini yetkilendirebilirdi. `editMode` ayrı bir
kolon olduğu ve standart kullanıcının gönderebileceği şemada hiç yer almadığı için bu tuzağa
düşmez. (Blok bazlı kilit ihtiyacı doğarsa: `feature/page-block-locking`, kapsam dışı.)

`editMode`'u ADMIN veya gelişmiş yetenekli EDITOR değiştirebilir (yalnızca-ADMIN değil —
şablon tasarlamak gelişmiş editörün işi). Ayrıcalık yükseltme riski yok: bunu değiştirebilen
kişi zaten gelişmiş yeteneklidir, `TEMPLATE` modu onu hiç kısıtlamaz. Değişiklik audit'lenir
(`content.edit_mode_change`, `content.legal_flag_change` ile birebir aynı desen).

#### 10.20.4 Standart kullanıcı için düzenlenebilir alanlar — sabit harita, kullanıcı gövdesi DEĞİL

> **GÜNCELLEME (2026-08-23):** bu bölümün başlığı ve aşağıdaki metni v1'de "şablon modunda"
> ifadesini taşıyordu çünkü guard yalnızca `editMode === "TEMPLATE"` sayfalarda çalışıyordu.
> Artık guard `editMode`'dan bağımsız, `canUseAdvancedBuilder === false` olan HER kullanıcı
> için HER sayfada (FREEFORM dahil) çalışır — "şablon modu" ifadesi aşağıda yalnızca haritanın
> kendi adını (`TEMPLATE_EDITABLE_FIELDS`) korumak amacıyla geçer, işlevsel bir ön koşul
> DEĞİLDİR.

Alan kısıtı `block.settings.editableFields` gibi istekle taşınan bir liste ile DEĞİL, koddaki
**sabit bir tip haritasıyla** uygulanır — aksi halde liste kendisi §10.20.3'teki kendi
kendini yetkilendirme tuzağına düşerdi. Kaynak dosya (otorite):
`backend/src/lib/page-template-fields.ts` → `TEMPLATE_EDITABLE_FIELDS: Record<string,
readonly string[]>`; frontend aynası `frontend/src/lib/page-builder/template-fields.ts` —
içerik BİREBİR aynı olmak zorundadır. **Fail-closed:** haritada olmayan her blok `type` için
düzenlenebilir alan kümesi boştur (bilinmeyen/gelecek blok tipleri otomatik kilitli gelir).

Özet (tam tablo kaynak dokümanda §3.2): başlık/zengin metin/görsel-url-alt-caption/buton
metni-linki + dizi tabanlı içerik listeleri (galeri, SSS, yorum, plan…) düzenlenebilir;
konteyner/layout/CSS/reveal tamamen kilitli. `custom-html.data.html` **hiçbir koşulda**
standart kullanıcıya açılmaz — ham HTML yazmak tanım gereği gelişmiş bir eylemdir.

**Uygulama katmanı: Zod DEĞİL, route seviyesi.** Kural mutlak değil görecelidir ("kayıtlı
ağaca göre neyi değiştirdin?") — Zod gövdeyi izole doğrular, DB'deki mevcut ağaca erişimi
yoktur. `PageBlockListSchema` ve blok şemaları DEĞİŞMEDİ, ikinci/dar bir şema varyantı
yazılmadı (~1000 satırlık blok şemasını çatallamak kaçınılmaz drift demektir). Kısıt, şema
parse'ından SONRA, mevcut kayıt yüklendikten sonra, DB yazımından ÖNCE tek bir yardımcıyla
uygulanır:

```
backend/src/lib/page-template-guard.ts
  → assertTemplateEditAllowed(existingBlocks: unknown[], incomingBlocks: unknown[]): void
```

İki ağaç **iteratif** (explicit stack, özyineleme YASAK — `lib/page-blocks.ts`'teki
stack-overflow gerekçesiyle aynı) dolaşılır; düğüm sayısı/`id` dizisi/her `id` için `type`
birebir aynı olmalı, `container` düğümlerinde `settings`+`reveal` derin eşit olmalı, içerik
bloklarında haritanın dışındaki her alan derin eşit olmalı — herhangi bir fark **403
FORBIDDEN** (`422` DEĞİL: gövde geçerlidir, sadece izin yoktur). `translations.<locale>.blocks`
de aynı diff'e tabidir (kayıtlı çeviri yoksa referans kanonik `blocks`'tur).

**Çağrıldığı yerler (atlanırsa güvenlik açığı):** `PATCH /admin/pages/{id}` ve **`POST
/admin/pages/{id}/autosave`** — autosave ayrı bir kod yoludur ve `blocks` yazar; burada
kontrol unutulursa 3 saniyelik debounce ile kısıtın tamamı sessizce baypas edilir (bu yüzden
qa-agent'ın zorunlu e2e senaryosu autosave baypas testidir). Revizyon-restore ve
`POST /admin/pages` bu guard'ı hiç görmez çünkü standart kullanıcıya uç seviyesinde zaten
kapalıdır (§10.20.5).

#### 10.20.5 Uç seviyesi yetki — `requireAdvancedBuilder`

Yeni middleware `backend/src/middleware/advanced-builder.ts::requireAdvancedBuilder()`,
`requireSiteRole(...)`'den SONRA çalışır (`site-rbac.ts` deseninin aynısı — 403 + audit).
Standart kullanıcıya kapalı uçlar: `POST /admin/pages` (boş sayfanın yapısı yoktur, standart
kullanıcı yalnızca VAR OLAN bir sayfanın `TEMPLATE_EDITABLE_FIELDS` kapsamındaki alanlarını
doldurabilir — bkz. 2026-08-23 güncellemesi, §10.20 girişi), sayfa silme/geri yükleme, `bulk`,
revizyon-restore.
Okuma uçları (`GET`, revizyon listeleme) ve `PATCH`/`autosave` (alan seviyesinde kontrol
edildiği için, §10.20.4) uç seviyesinde DEĞİŞMEDİ. `slug` ve `editMode` alanları `PATCH`
gövdesinde standart kullanıcı için ayrıca 403'tür — sayfanın URL'i ve düzenleme modu yapısal
kabul edilir.

Yeni uç: `PATCH /admin/users/{userId}/builder-access` (yalnızca ADMIN,
`{ advancedBuilderEnabled: boolean }`) — `/role`/`/status` uçlarıyla birebir aynı desen (rate
limit, `DELETED` kullanıcıda 404, audit `user.builder_access_change`).

#### 10.20.6 Sözleşme ve kapsam notları

- `canUseAdvancedBuilder` istemciye yalnızca UI için verilir, karar mercii DEĞİLDİR — sunucu
  her yazma isteğinde bağımsız yeniden hesaplar; frontend'in butonu gizlemesi bir kolaylıktır,
  güvenlik kontrolü değil.
- **[2026-08-23 GÜNCEL]** `editMode` artık HİÇBİR yetkilendirme kararını ETKİLEMEZ. v1'de bu
  madde "`editMode: TEMPLATE` gelişmiş kullanıcıyı kısıtlamaz; mod yalnızca standart kullanıcı
  için bir politikadır" diyordu — bu artık YANLIŞ: standart kullanıcı için de `editMode`
  ilgisizdir, kısıt tamamen `canUseAdvancedBuilder`'a bağlıdır (§10.20.2). `editMode` şu an
  yalnızca gelişmiş kullanıcıya UI'da gösterilen kozmetik bir rozet/ipucudur ("bu sayfa şablon
  olarak tasarlandı") — hiçbir route/guard bu değeri okuyup bir yetkilendirme kararı vermez
  (bkz. §10.20.3 güncelleme notu, §10.20.4 güncelleme notu).
- Public uçlar (`GET /pages`, `/pages/{slug}`) `editMode`'dan etkilenmez — bu tamamen bir
  yazma/yetkilendirme kavramıdır.
- Migration `20260822154259_add_page_editor_roles`, backfill ile mevcut ADMIN/EDITOR
  hesaplarının yetkisini korur (`advanced_builder_enabled = true WHERE role IN
  ('ADMIN','EDITOR')`) — kolon varsayılanı `false` olduğu için bu adım ZORUNLUDUR, aksi halde
  yayındaki editörlerin yetkisi sessizce daralırdı.
- Kapsam dışı (bilinçli, kaynak doküman §8): blok bazlı `isLocked`, şablondan sayfa kopyalama
  (duplicate), editoryal onay/moderasyon akışı, genel `Permission`/`UserPermission` tablosu,
  blog/ürün/portföy editörlerinde aynı ayrım, rol bazlı sayfa sahipliği.

---

### 10.21 5 kademeli kurumsal RBAC (`SiteRole` genişletmesi)

Durum: v1 (2026-08-23, mimari karar — implementasyon sıradaki ajanlarda) · Sahibi: Mimar.
**Bağlayıcı kaynak:** `.claude/architect-scope-rbac-5-tier.md` (tam gerekçeler, 20 modüllük
erişim tablosu, migration SQL'i, ajan görev dağılımı) + `openapi.yaml` (kök seviyedeki
`x-site-rbac` bloğu — tek doğru kaynak). Bu bölüm o dokümanın ÖZETİDİR.
**§10.20 ile ilişki:** §10.20'nin mekanizması korunur, yetenek modeli bu bölümle
değiştirilir (bkz. §10.20 başındaki uyarı kutusu).

#### 10.21.1 Neden bu bölüm var

3 rollü `SiteRole` (`ADMIN`/`EDITOR`/`VIEWER`) kurumsal bir ekip yapısını ifade edemiyordu:
(a) "panelin tamamına erişen ama sayfa tasarımını bozamayan yönetici" karşılığı yoktu,
(b) ön yüz üyeleri (müşteri / standart üye) ile panel kullanıcıları **aynı enum'da**
yaşıyordu ve `/admin/*` altındaki pek çok GET yalnızca `authenticated` korumalıydı — yani
kendi kendine kayıt olan bir ziyaretçi admin listelerini okuyabilirdi. (b) maddesi bu
turun **birinci sınıf güvenlik gerekçesidir.**

#### 10.21.2 Enum ve migration

```prisma
enum SiteRole { ADMIN  MANAGER  EDITOR  CUSTOMER  USER }   // sıra = azalan ayrıcalık
model User { role SiteRole @default(USER) }                // eski varsayılan: VIEWER
```

`VIEWER` **kaldırıldı.** Migration `CREATE TYPE` + `USING` cast + `DROP TYPE` + `RENAME`
desenidir (`ALTER TYPE ... ADD VALUE` DEĞİL); `SiteRole` şemada yalnızca `users.role`
kolonunda kullanıldığı için tek kolonu etkiler ve izole/tek başına gönderilir.

| Eski | Yeni | Not |
|---|---|---|
| `ADMIN` | `ADMIN` | Etki yok |
| `EDITOR` | `EDITOR` | **Kapsam daralır** — `products`/`portfolio`/`contact`/`stats` yetkilerini kaybeder |
| `VIEWER` | `USER` | **Panel erişimini tamamen kaybeder** |

`VIEWER → USER` bilinçli bir DARALTMADIR: yeni modelde "salt-okunur panel izleyicisi"
kademesi yoktur ve `EDITOR`/`MANAGER`'a eşlemek sessiz bir yetki YÜKSELTMESİ olurdu — bir
migration'ın asla yapmaması gereken şey. Panele gerçekten ihtiyacı olan eski `VIEWER` ve
daralan `EDITOR` hesapları, deploy notundaki listeden **ADMIN tarafından elle** yükseltilir.

Aynı migration `User.advancedBuilderEnabled` kolonunu **düşürür** (§10.21.4).

#### 10.21.3 Panel kapısı — `requirePanelAccess()`

`/admin/*` altındaki HER uç `ADMIN|MANAGER|EDITOR` gerektirir; `CUSTOMER`/`USER` → **403**
(+ `FORBIDDEN` statülü audit). Guard `backend/src/middleware/panel-access.ts`'tedir ve
her `/admin/*` plugin'inin kendi scope'unda `preHandler` hook'u olarak kaydedilir —
URL string'ine bakan global bir hook YAZILMAZ.

**İki istisna (liste genişletilemez):** `/admin/settings/security/2fa` ve
`/admin/settings/security/sessions` self-servis uçlardır (kendi 2FA'n / kendi oturumların),
`authenticated` kalır ve 5 rolün hepsi erişir. Bu prefix'lerin `/admin/*` altında olması
bir adlandırma kazasıdır; `/users/me/security/*` altına taşınmaları takip kalemidir.

**Zorlama testi (zorunlu, security-agent + qa-agent):** Fastify route tablosu üzerinden
"`/api/v1/admin/` ile başlayan her route panel guard'ı taşıyor mu?" otomatik olarak
doğrulanır. Manuel gözden geçirme yeterli kanıt DEĞİLDİR.

#### 10.21.4 `canUseAdvancedBuilder` — saf rol türevi

```ts
canUseAdvancedBuilder(user) === (user.role === "ADMIN")
```

`User.advancedBuilderEnabled` kolonu, `PATCH /admin/users/{userId}/builder-access` ucu,
`UpdateAdminUserBuilderAccessRequest` şeması, `AdminUser.advancedBuilderEnabled` DTO alanı
ve `middleware/advanced-builder.ts::requireAdvancedBuilder()` **kaldırıldı**. Gerekçe: iş
gereksinimi MANAGER ve EDITOR için yeteneği açıkça `false` yapıyor → bayrak hiçbir kullanıcı
için `true` olamaz → ölü kolon → drift kaynağı. §10.20'de bayrağın var olma sebebi ("yeni bir
`SiteRole` değeri eklememek") artık geçersizdir.

`User.canUseAdvancedBuilder` DTO alanı **korunur** (7 frontend dosyası okuyor). Bunun bir
yan faydası vardır: `simpleMode = !user.canUseAdvancedBuilder` ifadesi HİÇ DEĞİŞMEDEN,
MANAGER ve EDITOR için `BuilderCanvas`'ı gizleyip `TemplateEditorView`'i açar — iş
gereksinimindeki frontend kuralı **yeni bir koşul yazılmadan** karşılanır.

`PermissionsMatrix.capabilities` dizisi şekil olarak korunur; `advancedBuilder` girdisi
`alwaysGrantedTo: ["ADMIN"]`, `grantableTo: []` olur → UI hiçbir yetenek anahtarı çizmez.

#### 10.21.5 Yetki türetme ilkesi (ezberlenmesi gereken tek kural)

**MANAGER = ADMIN'in tüm yetkileri EKSİ beş kategori:** (a) ayrıcalık yükseltme yüzeyi,
(b) kimlik bilgisi yüzeyi, (c) keyfi kod yürütme, (d) site-geneli kill switch,
(f) denetim izi — VE blok yapısı.
**EDITOR = yalnızca `blog` + `media` + `pages` (içerik).**
**CUSTOMER/USER = `/admin/*`'ın tamamında 403.**

> **İş gereksinimindeki çelişkinin hakemliği.** İstek hem "ADMIN: sistem, ayarlar,
> kullanıcılar" hem "MANAGER: admin paneline tam erişir" diyordu. "Tam erişir" =
> "kapıda engellenmez ve operasyonel/içerik alanlarının tamamına ulaşır" olarak okundu;
> "ADMIN ile birebir aynı" okuması MANAGER'ı gereksiz kılardı. Belirleyici argüman
> güvenliktir: `/admin/users`'a yazabilen bir MANAGER kendini `ADMIN` yapabilir.

| Modül | ADMIN | MANAGER | EDITOR |
|---|---|---|---|
| `blog` (+kategori/etiket) — okuma/oluştur/güncelle/yayınla/çöp/geri yükle/bulk/revizyon | ✔ | ✔ | ✔ |
| `blog` — kalıcı silme, kategori/etiket silme | ✔ | ✔ | ✖ |
| `media` — okuma/yükleme/alt metin/klasör oluştur-yeniden adlandır-taşı | ✔ | ✔ | ✔ |
| `media` — kalıcı silme, klasör silme | ✔ | ✔ | ✖ |
| `pages` | üç katman — bkz. §10.21.6 |||
| `products`, `portfolio` (okuma dahil) | ✔ | ✔ | ✖ |
| `contact` (form yapılandırması + gönderimler) | ✔ | ✔ | ✖ |
| `orders` | ✔ | ✔ | ✖ |
| `stats`, `reports` | ✔ | ✔ | ✖ |
| `navigation` `GET` / `PUT` | ✔ / ✔ | ✔ / ✔ | ✔ / ✖ |
| `localization` `GET` / yazma | ✔ / ✔ | ✔ / ✔ | ✔ / ✖ |
| `email-templates` (GET dahil) | ✔ | ✔ | ✖ |
| `appearance` okuma / `PATCH`+`reset` / custom CSS-JS | ✔ / ✔ / ✔ | ✔ / ✔ / **✖** | ✔ / ✖ / ✖ |
| `site-modules` `GET` / `PATCH` | ✔ / ✔ | ✔ / **✖** | ✔ / ✖ |
| `settings` `GET` / `PATCH` / `permissions` | ✔ / ✔ / ✔ | ✔ / **✖** / **✖** | ✔ / ✖ / ✖ |
| `system` (`/admin/health`) | ✔ | **✖** | ✖ |
| `users` (`/admin/users`, okuma dahil) | ✔ | **✖** | ✖ |
| `logs` | ✔ | **✖** | ✖ |
| `api-keys`, `outbound-webhooks` (okuma dahil) | ✔ | **✖** | ✖ |
| `import` | ✔ | **✖** | ✖ |
| `/admin/settings/security/2fa`, `/sessions` | ✔ | ✔ | ✔ (+ CUSTOMER/USER — panel kapısı istisnası) |

Rol listeleri elle yazılmaz; `ROLES_ADMIN` / `ROLES_ADMIN_MANAGER` / `ROLES_PANEL`
sabitleri kullanılır (bir sonraki rol değişikliğinde ~100 çağrı yerinin tek tek triyajını
önlemek için).

#### 10.21.6 Sayfa modülü — üç katman

| Katman | Kapsam | Roller |
|---|---|---|
| **1 — Blok YAPISI** | ekle/sil/taşı/sırala, `container.settings`, `reveal`, `custom-html.data.html`, `isLegalDocument`, `authorId` | **ADMIN** |
| **2 — Yaşam döngüsü + kimlik** | çöpe at, geri yükle, kalıcı sil, `bulk`, revizyon-restore, `slug`, `editMode` | **ADMIN, MANAGER** |
| **3 — Blok İÇERİĞİ + meta** | okuma, `PATCH`, `autosave`, revizyon okuma, `title`/SEO/`status`/`scheduledAt`/`translations` | **ADMIN, MANAGER, EDITOR** |

**Tek istisna:** `POST /admin/pages` **yalnızca ADMIN**'dir. Katman 2 mantığına göre
MANAGER'a verilmesi beklenirdi; verilmiyor çünkü Katman 1 gereği MANAGER blok EKLEYEMEZ —
oluşturduğu boş sayfayı asla dolduramaz, yetkiyi vermek kırık bir akış üretirdi
(`architect-scope-page-editor-roles.md` §4.1'deki gerekçenin aynısı). MANAGER'a anlamlı bir
oluşturma yolu: `feature/page-duplicate-from-template` (takip kalemi).

Katman 1 mekanizması §10.20.4'teki `assertTemplateEditAllowed` diff'idir, DEĞİŞMEDEN;
artık `!canUseAdvancedBuilder` olan HER kullanıcı (MANAGER ve EDITOR) için, `editMode`'dan
BAĞIMSIZ olarak, hem `PATCH` hem **autosave** yolunda çalışır.

#### 10.21.7 Kayıt varsayılanı ve `CUSTOMER` terfisi

Yeni kayıtların varsayılanı **`USER`**'dır (`POST /auth/register` PUBLIC'tir — varsayılanın
panel erişimi olan bir role düşmesi doğrudan bir açıktır). Sıfırdan kurulan bir ortamda İLK
hesap `ADMIN` olmaya devam eder (kilitlenme koruması).

**`USER → CUSTOMER` terfisi:** `Order` ödendiğinde (Stripe `checkout.session.completed`) ve
`Order.siteUserId` doluysa, kullanıcının rolü `USER` ise `CUSTOMER`'a yükseltilir. Başka
hiçbir rol değiştirilmez; otomatik geri düşürme YOKTUR. Audit: `user.role_change`
(`reason: "order_paid"`, `actorId: null`).
Bunun mümkün olması için `POST /checkout/session` **isteğe bağlı kimlik doğrulamalı** hale
gelir: `Authorization: Bearer` varsa `siteUserId` kaydedilir, yoksa misafir akışı aynen
çalışır (401 üretilmez).

Reddedilen alternatifler: kayıt formunda "müşteriyim" seçimi (kullanıcı kendi rolünü
seçemez), `customerEmail` eşleşmesiyle terfi (misafir checkout'ta e-posta doğrulanmamıştır).
Geçmiş misafir siparişlerini bir hesaba bağlamak KAPSAM DIŞIDIR
(`feature/order-account-linking`).

**`CUSTOMER` ile `USER`'ın API'de farkı YOKTUR.** Yeni uç `GET /users/me/orders`
authenticated'tır ve `Order.siteUserId = me` filtresiyle çalışır; bir `USER` çağırırsa boş
liste döner. Rol guard'ı **eklenmeyecektir** — gerçek kontrol sahipliktir, ve terfi
webhook'la geldiği için rol kontrolü kullanıcının kendi siparişini görememesine yol açardı.
Ayrım ön yüz sunumundadır: `/siparislerim` bağlantısı `role === "CUSTOMER"` iken gösterilir.

#### 10.21.8 `/admin/users` rol değiştirme

Yalnızca **ADMIN** (MANAGER dahil hiç kimse). Hedef rol **5 değerin herhangi biri**;
`CUSTOMER`/`USER`'a düşürmek panel erişimini geri almanın (ban/downgrade) doğru aracıdır.
`assertNotLastActiveAdmin` değişmeden geçerlidir: son aktif `ADMIN`'i BAŞKA HERHANGİ bir
role çekmek `409 CONFLICT`. `POST /admin/users` varsayılanı `EDITOR` olarak KALIR (en dar
panel rolü). `role: VIEWER` artık şema doğrulamasında **422**'dir.

#### 10.21.9 Frontend sonuçları (atlanması kolay)

- Sidebar görünürlüğü rol bazlıdır; EDITOR'de yalnızca "Blog Yazıları", "Medya" ve
  "Sayfalar (Salt İçerik Düzenleme)" görünür — "Kullanıcılar", "Ayarlar", "Sistem Sağlığı"
  gizlidir (tam tablo: kaynak doküman §8.2).
- `/admin` gösterge paneli `/admin/stats/*` çağırdığı için **EDITOR girişte `/admin/blog`'a
  yönlendirilir**; `notification-center` EDITOR için ilgili uçları hiç fetch etmez — aksi
  halde panel her açılışta 403 gürültüsü üretir.
- Gizleme bir güvenlik önlemi DEĞİLDİR; sunucu her istekte bağımsız karar verir.
- Rol etiketleri: `Süper Yönetici` / `Yönetici` / `Editör` / `Müşteri` / `Standart Üye`.
  Eski `Yazar (Standart Düzenleyici)` / `İzleyici` etiketleri KALDIRILIR.
- Yeni ön yüz rotaları: `/hesabim` (5 rol) ve `/siparislerim` (CUSTOMER).

#### 10.21.10 Kapsam dışı (bilinçli)

Genel `Permission`/`UserPermission` tablosu; rol bazlı içerik sahipliği; MANAGER'a şablondan
sayfa klonlama; geçmiş misafir siparişlerini hesaba bağlama; `/admin/settings/security/*`
rotalarının taşınması; editoryal onay/moderasyon akışı; organizasyon bazlı `MembershipRole`
ekseni (bu iş onu HİÇ etkilemez).

---

### Bilinen Sorunlar / Backlog

- **`preValidation` vs RBAC hook sıralaması** (2026-08-05, qa-agent, orta öncelik,
  blocker değil): Zod `body` şeması olan ve `preHandler` tabanlı RBAC kullanan route'larda
  (örn. `POST /admin/import/jobs/:jobId/start`) body doğrulaması `preValidation`'da,
  `authenticate`/`requireSiteRole` hook'larından ÖNCE çalışıyor. Sonuç: yetkisiz bir
  çağıran bozuk/boş body gönderirse 403 yerine 422 alıyor. Veri sızıntısı yok (şema zaten
  `openapi.yaml` ile public) ve geçerli isteklerde bir etkisi yok — projede yaygın bir
  pattern, sadece import'a özel değil. Düzeltme: RBAC hook'larını `preValidation`'dan önce
  çalışacak şekilde (örn. `onRequest` seviyesinde) taşımak — proje genelinde bir geçiş
  gerektirir, bu sprintin kapsamına alınmadı.
- **Kullanıcı erasure / anonimleştirme (unutulma hakkı)** (2026-08-18, architect, AÇIK,
  blocker değil — sahibi: compliance-agent + db-agent): `DELETE /admin/users/{userId}`
  yalnızca yumuşak silmedir; KVKK m.11 / GDPR Art. 17 karşılanMAZ. Ayrıntılı çerçeve ve
  bu iş açıldığında zorunlu kapsam maddeleri: **§10.18.1**. Bağımlılık: `AuditLog` için
  proje-geneli saklama süresi (§10.8.8.1 madde 3) — o tanımlanmadan erasure istisnası
  hukuken savunulamaz.
