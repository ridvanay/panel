# INFRA.md — Altyapı & Dağıtım

Bu dosya devops-agent tarafından güncel tutulur. Herhangi bir ajan yeni bir servis, yeni bir
env değişkeni veya altyapı ile ilgili bir değişiklik yaptığında burası da güncellenmelidir.

## Servisler

| Servis | Teknoloji | Port | Health check |
|---|---|---|---|
| backend | Fastify + Prisma + PostgreSQL | 4000 | `GET /api/v1/healthz` → `{"status":"ok"}` |
| frontend | Next.js 16 (App Router, standalone output) | 3000 | `GET /api/health` → `{"status":"ok"}` |
| db | PostgreSQL 16 (alpine) | 5432 | `pg_isready` |

`backend`'deki `/admin/health` ayrı bir uçtur (auth gerektirir, depolama kotası bilgisi döner) —
orkestrasyon/container health check için **kullanılmaz**, sadece admin panel içindir.

**ÖNEMLİ — otomatik migration YOK**: backend container'ı başlarken şemayı kendiliğinden
migrate etmez (`Dockerfile` CMD sadece `node dist/server.js`). Yeni migration içeren bir
değişiklikten sonra `docker compose up` yapılıyorsa, backend'i başlatmadan/health'e
geçmeden önce migration'ların manuel uygulanması gerekir — bkz. aşağıdaki "Tam `docker
compose up` doğrulaması" bölümündeki adım adım komut ve kalıcı çözüm önerisi (ayrı bir
`migrate` compose servisi).

## Dosyalar

- `backend/Dockerfile`, `backend/.dockerignore` — multi-stage (deps → build → prod-deps →
  runtime), `node:20-alpine`, non-root kullanıcı, `prisma` CLI runtime'dan silinir (yalnızca
  üretilen `@prisma/client` kalır).
- `frontend/Dockerfile`, `frontend/.dockerignore` — multi-stage, `next.config.ts`'teki
  `output: "standalone"` ile minimal runtime (tam `node_modules` kopyalanmaz).
  **ÖNEMLİ**: runtime stage'de `ENV HOSTNAME=0.0.0.0` zorunlu — aksi halde Next.js standalone
  server.js, Docker'ın container'a atadığı `HOSTNAME` env değişkenini (container ID) kullanıp
  container'ın dahili IP'sine bind olur, `127.0.0.1`'den (ve dolayısıyla healthcheck'ten/host
  port mapping'inden) erişilemez hale gelir. Bu hata build sırasında YAKALANAMAZ, yalnızca
  runtime'da fark edilir — bu yüzden bu Dockerfile gerçekten `docker run` ile test edilip
  healthcheck'in `healthy` döndüğü doğrulanmıştır.
- `docker-compose.yml` (kök dizin) — tam yığın (db + backend + frontend), `depends_on` +
  `condition: service_healthy` zinciriyle: db sağlıklı → backend başlar → backend sağlıklı →
  frontend başlar.
- `backend/docker-compose.yml` — **korunmuştur**, değiştirilmedi. Sadece DB gerektiren backend
  geliştirmesi (dev server `tsx watch` ile, container'sız) için hâlâ kullanılabilir.
- `.github/workflows/ci.yml` — PR/push'ta lint → typecheck → test → build (backend + frontend,
  paralel) + Docker image build doğrulaması (push YOK, sadece Dockerfile'ların bozulmadığını
  doğrular).
- `.github/workflows/deploy.yml` — production/staging deploy şablonu (bkz. aşağıda).
- `backend/eslint.config.mjs` — backend'de daha önce hiç lint kurulumu yoktu, CI'daki lint
  adımı için minimal bir flat config eklendi (bkz. "Bilinen sınırlamalar"). Ayrıca
  `scripts/**/*.js` için Node/CommonJS globals override'ı içerir (`copy-static-assets.js`
  bkz. aşağıdaki madde).
- `backend/scripts/copy-static-assets.js` — `tsc` yalnızca `.ts` dosyalarını derlediği için
  `src/**` altına commit edilmiş görsel varlıklar (örn.
  `src/modules/demo-templates/assets/modern-architecture/*.png`) `dist/`e otomatik
  kopyalanmıyordu; bu, prod/Docker çalışma zamanında (`lib/assets.ts::templateAssetsDir()`
  `__dirname` = `dist/...` üzerinden dosya aradığı için) "şablon varlığı bulunamadı" hatasına
  yol açıyordu (`npm run dev`/vitest bunu yakalamaz, çünkü ikisi de `src/`den çalışır).
  Düzeltme: `backend/package.json`'daki `"build"` script'i artık `tsc -p tsconfig.json &&
  node scripts/copy-static-assets.js` — bu script `src/**` altındaki `.png/.jpg/.jpeg/.webp/.gif`
  (ve **`.pdf`**, bkz. aşağıdaki `ecommerce-pro` maddesi) dosyalarını aynı göreli yola `dist/`e
  kopyalar (genel amaçlı, yalnızca demo-templates'e hardcode değil). `backend/Dockerfile`'ın
  `build` stage'ine `COPY scripts ./scripts` eklendi (önceden yalnızca `src/` kopyalanıyordu,
  script çalışamazdı). Doğrulama: hem lokal `npm run build` hem `docker build --target build`
  ile `dist/modules/demo-templates/assets/modern-architecture/` altında 6 PNG'nin de oluştuğu
  teyit edildi.
- **`ecommerce-pro` şablonu (PNG + PDF varlıkları) — `dist`/Docker imajı kapsamı genişletildi
  (2026-09-03, `.claude/architect-scope-ecommerce-pro-template.md` §9.10)**:
  `backend/src/modules/demo-templates/assets/ecommerce-pro/**` altına 20 PNG + 2 PDF
  (`tech-doc-1.pdf`, `tech-doc-2.pdf` — §2.2 teknik döküman kartları) eklendi.
  `copy-static-assets.js`'in `STATIC_ASSET_EXTENSIONS` seti **yalnızca görsel uzantıları**
  kapsıyordu, `.pdf` dahil DEĞİLDİ — bu, PDF'lerin `dist/`e (ve dolayısıyla Docker runtime
  imajına) hiç kopyalanmaması, prod'da PDF import'unun "varlık bulunamadı" hatasıyla
  patlaması anlamına gelirdi. **Düzeltme**: `.pdf`, `STATIC_ASSET_EXTENSIONS`'a eklendi (tek
  satırlık genişletme, script'in geri kalanı DEĞİŞMEDİ — hâlâ genel amaçlı, dosya adına göre
  DEĞİL uzantıya göre çalışıyor). `_source/*.svg` dosyaları bilinçli olarak bu listeye dahil
  edilmedi (çalışma zamanında hiçbir kod onları okumaz — [DTI] §4.4) ama zaten `.svg` bir
  görsel format değil, çalışma zamanı varlığı da değil; imaja girmemesinin bir zararı yok.
  **Doğrulama (gerçekten çalıştırıldı)**: lokal `npm run build` → `dist/modules/demo-templates/
  assets/ecommerce-pro/` altında 20 PNG + 2 PDF (toplam 22 dosya) oluştu; `docker build -f
  backend/Dockerfile backend` ile tam imaj build edildi ve `docker run --rm <imaj> ls
  /app/dist/modules/demo-templates/assets/ecommerce-pro/` ile `tech-doc-1.pdf`/`tech-doc-2.pdf`
  runtime imajında (doğru `nodejs` kullanıcı sahipliğiyle) **mevcut** olduğu teyit edildi.

## S3/CDN depolama başlıkları — bilinen sınırlama (`X-Content-Type-Options: nosniff`)

**Durum: dokümante edilmiş bilinen sınırlama, düzeltilmedi — yeni bir CDN/Response Headers
Policy altyapısı bu turda İCAT EDİLMEDİ** (security-agent bulgusu, 2026-09-03).

`backend/src/lib/storage/s3.storage.ts` (`STORAGE_DRIVER=s3`), PDF gibi görsel-olmayan medya
için `PutObjectCommand`'a `ContentDisposition: "attachment"` metadata'sını başarıyla yazıyor —
bu S3'ün native desteklediği bir alan. Ancak `plugins/uploads.ts`'in yerel (`STORAGE_DRIVER=
local`) sürücüde `/uploads/*` için eklediği `X-Content-Type-Options: nosniff` HTTP yanıt
başlığının **S3 tarafında bir karşılığı yoktur** — `PutObjectCommand`, whitelist'li birkaç
metadata alanı (`ContentType`, `ContentDisposition`, `CacheControl` vb.) dışında keyfi HTTP
yanıt başlığı ayarlamaya izin vermez; `nosniff`, S3'ün nesne meta verisi olarak
saklayabileceği/objeye eklenip her `GetObject` yanıtında geri döneceği bir alan DEĞİLDİR.

**Bu turda projede zaten mevcut bir CloudFront/CDN/Terraform/CDK yapılandırması bulunmadığı**
doğrulandı (`INFRA.md`, kök `docker-compose.yml`, `backend/docker-compose.yml` içinde
CloudFront/CDN/Response-Headers-Policy referansı yok) — bu yüzden devops-agent bu turda **yeni
bir CDN katmanı kurmadı** (görev kapsamı: mevcut altyapıyı genişletmek, yeni bulut kaynağı
icat etmemek).

**Risk değerlendirmesi**: düşük. `ContentDisposition: attachment` zaten tarayıcının dosyayı
satır içi render etmesini (ve dolayısıyla MIME-sniffing tabanlı bir XSS/phishing yüzeyini)
engelliyor — `nosniff` burada **ikinci bir savunma katmanı** (defense-in-depth), tek başına
kritik değil.

**İleride bir CDN katmanı eklenirse (mimari karar/backlog maddesi)**: `S3_PUBLIC_URL` zaten bir
CloudFront/CDN önü destekliyor (`s3.storage.ts::buildUrl`) — CloudFront kullanılacaksa, bir
**Response Headers Policy** (`X-Content-Type-Options: nosniff` dahil, mevcut AWS-managed
`SecurityHeadersPolicy` veya özel bir policy) o dağıtıma eklenmelidir. Bu iş mimari bir karardır
(hangi CDN, hangi IaC aracı — Terraform/CDK/console) ve **architect**'in onayı olmadan
devops-agent tarafından tek taraflı açılmayacaktır; şimdilik yalnızca bu not backlog'a
düşülmüştür.

## İçe aktarma dosya deposu (`storage/imports`)

backend-agent, §10.8.5 Toplu İçe Aktarma özelliği için `backend/src/lib/import-storage.ts`'de
yeni, **private** bir yerel dosya deposu ekledi (`<cwd>/storage/imports/<uuid>`,
`STORAGE_DRIVER=local` iken). Bu, `lib/storage/*` (MediaStorage → `uploads/`, auth'suz
`/uploads/*` ile public servis edilir) ile **karıştırılmamalıdır** — WXR/CSV kaynak dosyaları
e-posta adresi/yayınlanmamış taslak içeriği barındırabileceği için asla public olamaz.

devops-agent tarafında yapılan/kontrol edilen değişiklikler:

- **`backend/.gitignore`**: `storage/imports/` zaten backend-agent tarafından eklenmiş —
  doğrulandı, ek değişiklik gerekmedi.
- **`backend/Dockerfile`**: runtime stage'e `uploads/` ile aynı pattern'de
  `RUN mkdir -p /app/storage/imports && chown -R nodejs:nodejs /app/storage` eklendi. Kod
  tarafında zaten `LocalImportStorage` constructor'ı `fs.mkdirSync(..., {recursive:true})`
  ile dizini garanti ediyor (`ensureLocalDir()`), ama Dockerfile'da önceden oluşturmak diğer
  storage dizinleriyle (uploads) tutarlılık sağlıyor ve doğru sahiplik/izin (nodejs kullanıcısı)
  ilk yazmadan önce garantileniyor.
- **Volume kararı: KASITLI OLARAK volume EKLENMEDİ** (`saas_uploads` gibi bir
  `saas_import_storage` named volume yok, ne kök `docker-compose.yml`'de ne de production
  hedefinde önerilir). Gerekçe:
  - Bu dosyalar tanım gereği **geçici**dir: bir import job'ı bittiğinde (başarılı/başarısız
    fark etmeksizin) kaynak dosya silinir (`importStorage.remove`, bkz. import-storage.ts).
    Kalıcılığın hiçbir faydası yok — kalıcı olması gereken şey job'ın SONUCU (DB'deki
    `ImportJob` kaydı ve oluşturulan `Post`/`Media` satırları), kaynak dosyanın kendisi değil.
  - Container yeniden başlarsa (deploy, crash, restart) yarım kalmış importlar zaten
    ARCHITECTURE.md §10.8'deki `onReady` recovery hook'u tarafından `FAILED` durumuna
    çekiliyor — kullanıcı dosyayı yeniden yükleyip job'ı tekrar başlatmak zorunda kalıyor,
    ki bu kabul edilebilir bir davranış (yarım kalmış bir import'u "kaldığı yerden devam
    ettirmek" zaten desteklenmiyor).
  - Volume eklemek burada sadece gereksiz operasyonel yük (yönetilecek ek bir disk/volume,
    yedekleme kapsamına girip girmeyeceği sorusu vb.) getirir, hiçbir dayanıklılık faydası
    sağlamaz.
  - **Ancak**: dizin container ÇALIŞIRKEN mevcut ve yazılabilir olmalı (yukarıdaki Dockerfile
    değişikliği bunu garanti eder) ve yeterli disk alanı olmalı — büyük bir WXR/ZIP importu
    sırasında container'ın ephemeral (overlay fs) disk kotası dolabilir. Production hedefi
    seçildiğinde (bkz. "CD" bölümü) hedef platformun container disk/ephemeral-storage
    limitinin (K8s `emptyDir`/`ephemeral-storage` request-limit, ECS task disk vb.) beklenen
    maksimum import dosyası boyutuna göre ayarlanması **architect/devops-agent**'ın
    sorumluluğundadır — şu an bir limit tanımlı değil (backend-agent'ın import boyut
    limitini nerede uyguladığı ayrı bir kontrol konusu, bu devops-agent görev kapsamı dışında).
  - S3 sürücüsünde (`STORAGE_DRIVER=s3`) bu tartışma zaten geçersiz — dosya container'ın
    dışında, S3 bucket'ında tutulur, container'ın kendisi stateless kalır.

## Bağımlılık politikası — `allowScripts` (backend)

backend-agent, içe aktarma özelliği için şu bağımlılıkları ekledi: `saxes`, `csv-parse`,
`sanitize-html`, `yauzl` (+ dev: `@types/yauzl`, `@types/sanitize-html`, `yazl`,
`@types/yazl`). `backend/package.json`'daki `allowScripts` bloğu yalnızca **native
build/postinstall/preinstall gerektiren** paketleri (`@prisma/client`, `@prisma/engines`,
`argon2`, `esbuild`, `prisma` — hepsi native binary indirir/derler) listeleyen bir
allow-list'tir; listede olmayan paketlerin lifecycle script'i çalıştırmaması beklenir.

Kontrol: yukarıdaki 8 paketin kendi `package.json`'ları (`node_modules/<paket>/package.json`)
**doğrudan** incelendi — hiçbirinde `preinstall`/`install`/`postinstall` script'i YOK (sadece
`build`/`test`/`lint` gibi paket-geliştirme script'leri var, bunlar `npm ci` sırasında
çalışmaz). Transitif bağımlılıkları da (`xmlchars`, `pend`, `buffer-crc32`, `htmlparser2`,
`deepmerge`, `escape-string-regexp`, `is-plain-object`, `parse-srcset`, `postcss`, `launder`)
aynı şekilde kontrol edildi: tek istisna `is-plain-object`'in bir `prepare: "rollup -c"`
script'i var, ancak `prepare` script'leri npm tarafından yalnızca **git kaynaklı**
bağımlılıklarda veya paketin kendi kök dizininde (`npm install` doğrudan o pakette
çalıştırıldığında) tetiklenir — registry'den (npm tarball) kurulan bir bağımlılık için
`npm ci`/`npm install` sırasında ÇALIŞMAZ. Dolayısıyla:

**Karar: `allowScripts`'e hiçbir ekleme yapılmadı.** Yeni bağımlılıkların hiçbiri kurulum
sırasında script çalıştırmıyor, allow-list'in mevcut (native-only) kapsamı bozulmadı.

## Ortam değişkenleri

`backend/.env.example` ve `frontend/.env.local.example` (+ `frontend/.env.local`) gerçek
`.env`/`.env.local` dosyalarıyla karşılaştırıldı — **eksik/yeni değişken bulunmadı**,
`.env.example` zaten güncel (SMTP_*, STORAGE_DRIVER/S3_*, quota değişkenleri dahil).

CI/Docker'a özgü ek değişkenler (repoya girmez, sadece CI job'larında/derleme argümanlarında
kullanılır):

| Değişken | Kullanıldığı yer | Değer (CI/local Docker) |
|---|---|---|
| `DATABASE_URL` | backend CI job'ının "Prisma migrate deploy (sanity check)" adımı | `postgresql://postgres:postgres@localhost:5432/postgres?schema=public` |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` | frontend Docker build ARG'ları | docker-compose.yml → `frontend.build.args` |

Production/staging secret'ları (GitHub Environment secrets, repoya asla girmez — bkz. "CD" bölümü):
`DATABASE_URL`, `REGISTRY_URL`, `REGISTRY_USERNAME`, `REGISTRY_PASSWORD`,
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` ve backend'in `.env.example`'ında listelenen tüm
üretim secret'ları (JWT anahtarları, `ENCRYPTION_KEY`, `STRIPE_*`, `SMTP_*` vb.).

## CI (`.github/workflows/ci.yml`)

- Tetikleyici: `master`/`main`/`release`'e push ve bu branch'lere açılan PR + `workflow_call`
  (deploy.yml tarafından yeniden kullanılır).
- `backend` ve `frontend` job'ları **paralel** çalışır (birbirine `needs` bağımlılığı yok).
- `backend` job'ı bir Postgres 16 service container'ı ayağa kaldırır
  (`postgres`/`postgres`/`postgres`, port 5432) — `backend/tests/setup/global-setup.ts` bu
  servise bağlanıp kendi `saas_test` veritabanını oluşturup migrate eder.
- `docker-build` job'ı (matrix: backend/frontend) her iki Dockerfile'ı push ETMEDEN build eder
  — bir Dockerfile regresyonu PR'da hemen yakalanır.
- **İçe aktarma testleri** (`backend/tests/unit/import-*.test.ts`,
  `backend/tests/integration/import.test.ts`, `backend/tests/integration/media.test.ts`):
  `backend/vitest.config.ts`'de özel bir `include`/`exclude` deseni YOK (varsayılan
  `**/*.{test,spec}.*` glob'u kullanılıyor) — bu yüzden yeni test dosyaları herhangi bir CI
  konfigürasyon değişikliği gerekmeden mevcut `npm test` (backend job'ının "Test" adımı)
  tarafından otomatik olarak toplanıp çalıştırılıyor. **Doğrulandı, ekstra değişiklik
  gerekmedi.**
- **`ecommerce-pro` migration + `demo-templates-ecommerce-pro.test.ts` (2026-09-03,
  `.claude/architect-scope-ecommerce-pro-template.md` §9.10)**: yeni
  `20260903085735_add_product_variants_documents_shipping/migration.sql` standart
  `backend/prisma/migrations/` klasöründe — `prisma migrate deploy` klasördeki tüm migration'ları
  timestamp sırasına göre otomatik uygular, CI'da ayrıca listelenmesi/adlandırılması GEREKMEZ.
  `demo-templates-ecommerce-pro.test.ts` da `vitest.config.ts`'in varsayılan glob'una girer,
  gerçek DB'ye (global-setup'ın oluşturduğu `saas_test`) karşı çalışır — yukarıdaki maddeyle
  AYNI mekanizma. **Doğrulama (gerçekten çalıştırıldı)**: geçici, boş bir `postgres:16-alpine`
  container'ı (CI'daki `postgres` service container'ıyla birebir aynı imaj/kimlik bilgileri)
  ayağa kaldırılıp `DATABASE_URL=postgresql://postgres:postgres@localhost:15432/postgres
  ?schema=public npx prisma migrate deploy` çalıştırıldı — yeni migration dahil TÜM migration'lar
  ("All migrations have been successfully applied.") hatasız uygulandı. Bu, CI'ın "Prisma
  migrate deploy (sanity check)" adımının aynen geçeceğini doğrular; **hiçbir yeni env
  değişkeni/secret veya CI YAML değişikliği gerekmedi.**

### Branch protection (manuel — GitHub UI, sen açmalısın)

1. GitHub'da repo → **Settings → Branches → Branch protection rules → Add rule**.
2. Branch name pattern: `master` (gerekirse `main`/`release` için de ayrı kural ekleyin).
3. **Require a pull request before merging** işaretleyin.
4. **Require status checks to pass before merging** işaretleyin, ardından şu check
   isimlerini arayıp seçin (bunlar `ci.yml`'deki job `name:` alanlarıdır, en az bir CI çalışması
   geçtikten sonra listede görünürler):
   - `backend`
   - `frontend`
   - `docker-build (backend)`
   - `docker-build (frontend)`
5. **Require branches to be up to date before merging** önerilir.
6. Kaydedin.

### İlk push/PR sonrası kontrol edilecekler

- GitHub reposunda **Actions** sekmesine gidin, `CI` workflow'unun çalıştığını görün.
- 4 job'un da (backend, frontend, docker-build×2) yeşil olduğunu doğrulayın.
- Backend job loglarında "Test" adımında `Test Files  20 passed`, `Tests  124 passed` gibi bir
  özet olmalı (bu sayılar bu değişiklik anında lokal doğrulamada elde edilen sonuçlarla
  aynıdır — bkz. aşağıdaki "Lokal doğrulama" bölümü).
- Frontend job loglarında `Test Files  18 passed`, `Tests  71 passed` beklenir.
- Herhangi bir job kırmızıysa **merge etmeyin**, hatayı düzeltip yeni bir commit/PR ile tekrar
  deneyin (branch protection zaten bunu zorunlu kılacaktır).

## CD (`.github/workflows/deploy.yml`)

**Durum: iskelet/şablon.** Migration, image build/push, CI-before-deploy zinciri ve
branch/onay kısıtlaması **üretime hazırdır**; ancak gerçek hosting hedefi (Kubernetes / AWS
ECS / Fly.io / VM + SSH vb.) henüz **architect tarafından karara bağlanmadığı** için `deploy`
job'ındaki asıl rollout komutu bir placeholder'dır (`TODO` yorumu ile işaretli). Hedef
belirlendiğinde devops-agent bu adımı doldurmalı.

Akış: `ci` (lint/typecheck/test/build'i yeniden çalıştırır, ci.yml'i `workflow_call` ile
yeniden kullanır) → `migrate` (`npx prisma migrate deploy`, **kod deploy'undan önce**) →
`build-and-push` (Docker image, tag = git SHA + `latest`) → `deploy` (rolling/zero-downtime,
hedef platforma göre doldurulacak).

- Tetikleyici: `master`/`release`'e push, `v*.*.*` tag'i, veya manuel `workflow_dispatch`.
- Her job `environment: production` (veya `workflow_dispatch` girdisiyle `staging`) kullanır —
  bu, GitHub'ın **Environment protection rules** (manuel onay/required reviewers) özelliğiyle
  eşleşir.

### Manuel adım — GitHub Environment onayı (sen açmalısın)

GitHub Actions workflow YAML'ı tek başına "bir insan onaylamadan devam etme" davranışını
tanımlayamaz — bu, bir **Environment**'a bağlı bir korumadır ve sadece repo ayarlarından
açılabilir:

1. Repo → **Settings → Environments → New environment** → adı `production` (staging için ayrı
   bir environment daha oluşturun: `staging`).
2. **Required reviewers** işaretleyin, en az bir kişi/takım ekleyin (bu kişi onaylamadan
   `migrate`/`build-and-push`/`deploy` job'ları başlamaz).
3. (Opsiyonel ama önerilir) **Deployment branches** → "Selected branches" → `master` ve
   `release` ile sınırlayın (ekstra bir güvenlik katmanı, workflow'daki `on.push.branches`
   kısıtlamasının üzerine).
4. Bu environment'a yukarıdaki "CI/Docker'a özgü ek değişkenler" tablosundaki production
   secret'larını **Environment secrets** olarak ekleyin (repo-level Secrets değil — environment
   scope'u tercih edilir ki sadece onaylı deploy'lar erişebilsin).

### Rollback planı {#rollback}

Her deploy image'ı immutable bir tag ile (`git SHA`) push edilir — `latest` sadece kolaylık
içindir, gerçek rollback her zaman **belirli bir SHA tag'ine** döner:

1. **Tespit**: `deploy` job'ı başarısız olursa veya deploy sonrası health check/monitoring
   (bkz. "Health check & monitoring") alarm verirse, kritik hata sayılır.
2. **Bildirim**: `deploy.yml`'deki `if: failure()` adımı architect'e bildirim göndermek üzere
   işaretlenmiştir (Slack/e-posta webhook entegrasyonu observability-agent/devops-agent
   tarafından doldurulmalı — şu an placeholder). Manuel olarak da mimarı derhal bilgilendirin.
3. **Geri alma**: Bir önceki başarılı SHA/tag ile `deploy.yml` workflow'u `workflow_dispatch`
   üzerinden yeniden tetiklenir (image zaten registry'de mevcut olduğundan `build-and-push`
   adımı atlanabilir/tekrar çalıştırılabilir — image tag'i değişmez). Hedef platforma göre:
   - Kubernetes: `kubectl rollout undo deployment/backend` / `deployment/frontend`
   - AWS ECS: önceki task definition revizyonuna `update-service`
   - Docker Swarm: `docker service update --rollback backend`
   - VM + docker compose: önceki image tag'iyle `docker compose up -d --no-deps <servis>`
4. **DB migration rollback**: Prisma migration'ları varsayılan olarak geri alınabilir DEĞİLDİR
   (`prisma migrate deploy` "forward-only"). Bu yüzden db-agent'ın migration'ları **geriye
   dönük uyumlu** (additive, örn. önce nullable kolon eklenir, kod her iki şemayı da destekler,
   sonra ayrı bir migration'la eski kolon kaldırılır) yazması ZORUNLUDUR — kod rollback'i asla
   bir DB migration rollback'i gerektirmemelidir. Gerçekten geri alınması gereken bir migration
   varsa, db-agent yeni bir **ileri** migration (eski migration'ı geri alan) yazmalıdır, asıl
   migration dosyası elle geri alınmaz.
5. **Doğrulama**: Rollback sonrası her iki servisin health check'i (`/api/v1/healthz`,
   `/api/health`) yeşile döndüğü teyit edilene kadar deploy tamamlanmış sayılmaz.

## Zero-downtime / rolling deploy stratejisi

- Her iki container da Docker `HEALTHCHECK` tanımlar; hedef orkestratör (K8s readiness probe,
  ECS health check grace period, Swarm `update-order: start-first`, veya basit bir
  reverse-proxy + "yeni container sağlıklı olana kadar trafiği eskiye yönlendir" scripti) bu
  health check'i **trafiği yeni sürüme yönlendirmeden önce** beklemelidir.
- `migrate` job'ı her zaman `build-and-push`'tan ÖNCE çalışır — yeni kod, henüz migrate
  edilmemiş bir şemaya karşı asla çalıştırılmaz. Migration'lar backward-compatible olmalı (bkz.
  "Rollback planı" madde 4) ki eski container'lar (rollout tamamlanana kadar) yeni şemaya karşı
  da çalışabilsin.
- Gerçek "rolling"/"blue-green" mekanizması hedef platforma bağlıdır — `deploy` job'ındaki
  placeholder'da örnekler var, seçim architect'e aittir.

## Monitoring / observability önerisi

Şu an repoda log takibi/hata izleme entegrasyonu yok (backend `pino` ile yapılandırılmış JSON
log üretiyor, ama merkezi bir toplayıcıya gönderilmiyor). Öneriler (observability-agent'ın
kapsamı):
- **Hata takibi**: Sentry (hem backend Fastify hem frontend Next.js için resmi SDK'ları var).
- **Uptime/log**: Grafana + Loki (pino JSON logları doğrudan Loki'ye push edilebilir) veya
  basit bir uptime monitörü (UptimeRobot/BetterStack) `/api/v1/healthz` ve `/api/health`
  uçlarını periyodik kontrol edecek şekilde.
- Container health check'leri (bu PR'da eklendi) zaten orkestratör seviyesinde bir ilk
  savunma hattı sağlıyor; yukarıdakiler bunun üzerine "insan görebilir" bir katmandır.

## Bilinen sınırlamalar / takip gerektiren notlar

- **Backend'de eslint yoktu** — CI'daki `lint` adımını çalıştırabilmek için minimal bir
  `typescript-eslint` `recommended` config'i eklendi (`backend/eslint.config.mjs`,
  `npm run lint`). Mevcut kod tabanına karşı çalıştırıldığında **0 hata, 2 uyarı** (zararsız,
  `Unused eslint-disable directive`) verdi — kural seti bilinçli olarak gevşek tutuldu. Kural
  setinin nihai halini/stil tercihlerini **code-quality-agent** devralmalı.
- **`npm audit` bulguları (backend)**: `fastify@4.28.1` → `find-my-way` üzerinden yüksek
  önem dereceli bir DDoS güvenlik açığı bildiriyor (HTTP/2 ile). Düzeltmesi `fastify@5.x`'e
  breaking-change bir major upgrade gerektiriyor (route/plugin API'sinde değişiklikler) — bu
  **backend-agent/security-agent**'ın kapsamına giriyor, devops-agent burada sadece tespit
  etti, düzeltmedi.
- **`saas-backend` imajı ~528MB** — büyük kısmı `geoip-lite` paketinin gömülü GeoIP veritabanı
  (~110MB) ve `@prisma`/`@aws-sdk` paketleri. Fonksiyonel olarak gerekli bağımlılıklar
  (bağımlılık seçimi backend-agent'ın kapsamında) — devops-agent tarafında yapılabilecek
  optimizasyon (prisma CLI'nin runtime'dan silinmesi) zaten uygulandı.
- **frontend devDependencies bazı paketler Node 22+ istiyor** (`jsdom`, `@testing-library/jest-dom`
  vb. — `npm ci` sırasında `EBADENGINE` uyarısı verir, Node 20 ile build/test yine de başarılı
  oluyor). İleride Node 22 LTS'e geçiş düşünülebilir, şu an engelleyici değil.
- **`deploy.yml` bir şablondur** — gerçek hosting hedefi seçilmeden production'a fiilen deploy
  edilemez (bkz. yukarıdaki "CD" bölümü).

## Lokal doğrulama (bu değişiklik kapsamında gerçekten çalıştırıldı)

- `backend`: `npm run lint` (0 hata/2 uyarı), `npm run typecheck` (temiz), `npm test`
  (20 dosya / 124 test geçti, gerçek Postgres'e karşı — `backend-db-1` container'ı, `saas_test`
  DB'si), `npm run build` (temiz).
- `frontend`: `npm run lint` (temiz), `npm run typecheck` (temiz), `npm test` (18 dosya / 71
  test geçti). `next build` lokalde ÇALIŞTIRILMADI (çalışan `next dev` sunucusuyla `.next`
  dizinini paylaştığı için çakışma riski vardı) — bunun yerine Docker build'i içinde
  doğrulandı (aşağıya bakın).
- **Docker**: `docker build` hem `backend/Dockerfile` hem `frontend/Dockerfile` için başarıyla
  tamamlandı. Her iki image de geçici, farklı host portlarında (`4001`, `3001` — çalışan dev
  sunucularına dokunmadan) `docker run` ile ayağa kaldırıldı, health endpoint'leri `curl` ile
  200 döndüğü doğrulandı, ve Docker `HEALTHCHECK`'in `healthy` durumuna geçtiği teyit edildi.
  Bu süreçte **frontend'de gerçek bir üretim hatası bulundu ve düzeltildi**: standalone
  server.js, Docker'ın otomatik atadığı `HOSTNAME` env değişkeni yüzünden container'ın dahili
  IP'sine bind oluyordu (bkz. yukarıdaki Dockerfile notu) — `ENV HOSTNAME=0.0.0.0` eklenerek
  giderildi.
- **`docker compose up`**: `docker compose config` ile kök `docker-compose.yml`'in
  sözdizimsel/semantik olarak geçerli olduğu ve `backend/.env`'i doğru okuyup interpolate
  ettiği doğrulandı. Tam `docker compose up` (üç servis birden, gerçek portlarda) ÇALIŞTIRILMADI
  çünkü backend/frontend'in varsayılan portları (4000/3000) çalışan dev sunucularıyla çakışırdı
  — **qa-agent'ın bunu ayrı bir ortamda (veya dev sunucuları durdurularak) doğrulaması önerilir**.
- GitHub Actions workflow'ları (`ci.yml`, `deploy.yml`) gerçekten GitHub'da TETİKLENEMEDİ (bu
  push yapmayı gerektirir, bu oturumun yetkisinde değil) — bunun yerine `js-yaml` ile YAML
  sözdizimi doğrulandı (ikisi de geçerli) ve backend/frontend job'larındaki tüm komutlar
  (lint/typecheck/test/build) yukarıda açıklandığı gibi lokalde ayrı ayrı çalıştırılıp
  gerçekten geçtiği doğrulandı — CI'daki adımların pratikte başarılı olacağına dair yüksek
  güven var, ama **ilk gerçek push/PR sonrası Actions sekmesinin kontrol edilmesi gerekir**
  (bkz. yukarıdaki "İlk push/PR sonrası kontrol edilecekler").

## Tam `docker compose up` doğrulaması (2026-08-17 — gerçekten çalıştırıldı)

Bu oturumda kök `docker-compose.yml` ile üç servis (db + backend + frontend) birlikte, gerçek
portlarda (3000/4000/5432) lokalde ayağa kaldırıldı ve **healthy** durumuna geçtiği doğrulandı
(bir önceki "Lokal doğrulama" bölümünde bu adım "ÇALIŞTIRILMADI" olarak not düşülmüştü — artık
tamamlandı). Süreçte üç ayrı sorunla karşılaşıldı, hepsi çözüldü:

1. **Backend'de otomatik migration YOK.** `backend/Dockerfile`'ın `CMD`'si doğrudan
   `node dist/server.js` çalıştırıyor, `prisma migrate deploy` gibi bir startup adımı yok
   (`backend/src/server.ts` içinde de böyle bir çağrı yok — kontrol edildi). Daha kötüsü:
   startup'taki `recoverStuckImportJobs` recovery hook'u (`app.js:248` → içe aktarma
   modülü, bkz. yukarıdaki "İçe aktarma dosya deposu" bölümü) şema henüz migrate
   edilmemişse (`relation "import_jobs" does not exist`) **yakalanmamış bir Prisma hatası
   fırlatıp tüm process'i çökertiyor** — container `restart: unless-stopped` sayesinde
   sürekli yeniden başlayıp aynı hatayla tekrar çöküyor (crash-loop), `depends_on:
   condition: service_healthy` zinciri yüzünden frontend de hiç başlamıyor. **Bu bir
   uygulama kodu sağlamlık sorunu (backend-agent'ın kapsamı) — devops-agent burada
   sadece tespit etti/geçici olarak migration'ı manuel uyguladı, `recoverStuckImportJobs`'un
   şema eksikken sessizce/loglayarak devam etmesi (crash yerine) backend-agent'a
   yönlendirilmeli.**
   - **Geçici/manuel çözüm (bu oturumda uygulandı)**: host'tan, `backend/node_modules`
     içindeki Prisma CLI ile (runtime image'ında CLI yok, bkz. Dockerfile notu — bu yüzden
     `docker compose exec backend npx prisma ...` ÇALIŞMAZ, `prisma` paketi runtime'dan
     silinmiş durumda):
     ```
     cd backend
     DATABASE_URL="postgresql://postgres:postgres@localhost:5432/saas_dev?schema=public" npx prisma migrate deploy
     ```
     (compose'un `db` servisi `5432:5432` ile host'a expose edildiği için host'tan doğrudan
     erişilebiliyor). Migration sonrası crash-loop'taki backend container'ı bir sonraki
     otomatik restart denemesinde kendi kendine `healthy` oldu (ekstra bir `docker compose
     restart` gerekmedi).
   - **Kalıcı öneri**: `docker-compose.yml`'e migration'ları backend başlamadan önce
     çalıştıran ayrı bir `migrate` servisi (`depends_on: db: condition: service_healthy`,
     backend'in kendisi bu servise `depends_on: condition: service_completed_successfully`
     ile bağlanır) eklemek — bu, CD pipeline'ındaki (`deploy.yml`) "migrate → deploy"
     sırasını lokal compose'da da tutarlı hale getirir. Henüz eklenmedi (bu oturumun
     kapsamı acil olarak lokal ortamı ayağa kaldırmaktı), ileride devops-agent tarafından
     eklenebilir.
2. **Port 5432 çakışması**: `backend/docker-compose.yml` (db-only, sadece backend
   geliştirmesi için) ile başlatılmış eski bir `backend-db-1` container'ı (2 hafta önce
   oluşturulmuş, `saas_test` DB'si için kullanılıyordu, dev server'lar bu oturumda
   durdurulmadan önce hâlâ host port 5432'yi tutuyordu) kök `docker-compose.yml`'in kendi
   `db` servisiyle çakıştı (`port is already allocated`). **Çözüm**: `docker stop
   backend-db-1` ile durduruldu (**silinmedi**, volume'u da dokunulmadı) — iki compose
   dosyası aynı anda, aynı host portunda çalışamaz, hangisi kullanılacaksa diğeri
   durdurulmalı. `backend-db-1` container'ı hâlâ diskte duruyor, istenirse
   `docker start backend-db-1` ile (kök compose stack'i durdurulduktan sonra, port
   çakışmaması için) geri getirilebilir.
3. **Docker Desktop network glitch (Windows)**: (2) numaralı port çakışması yüzünden
   başarısız olan ilk `docker compose up --build -d` denemesi, `db`/`backend`
   container'larını "Created" durumunda bıraktı; port serbest bırakılıp `docker compose up
   -d` tekrar çalıştırıldığında container'lar "healthy" raporlandı ama gerçekte network
   endpoint'leri hiç programlanmamıştı (`docker inspect ... NetworkSettings.Networks` boş
   `{}` dönüyordu, container'lar arası DNS çözümü tamamen başarısız oluyordu — backend
   `Can't reach database server at db:5432` hatasıyla sürekli çöküyordu, `db` container'ı
   kendi içinde `pg_isready` ile sağlıklı görünmesine rağmen). **Çözüm**: `docker compose
   down` (volume'lara DOKUNULMADI, sadece container+network silindi) ardından `docker
   compose up -d` ile temiz bir network'ten yeniden oluşturuldu — bu sefer IP adresleri
   doğru atandı. Kök neden muhtemelen başarısız olan ilk `up` denemesinin yarım kalmış
   network state'i bırakması (Docker Desktop/Windows'a özgü bir sınır durumu) — tekrar
   görülürse aynı `docker compose down && docker compose up -d` çözümü uygulanmalı.

**Sonuç**: `saas_pgdata`/`saas_uploads` volume'ları **silinmedi/resetlenmedi** (kullanıcı
kısıtlaması korundu) — kök `docker-compose.yml` kendi `claudecodeproje_saas_pgdata` adlı
YENİ bir volume kullandığı için (proje adı dizin adından türetiliyor, `backend_saas_pgdata`
ile karışmıyor), zaten sıfırdan boş bir DB'ydi, migration'lar buna baştan uygulandı — hiçbir
mevcut veri riske atılmadı.
