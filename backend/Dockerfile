# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# backend/Dockerfile — Fastify + Prisma API, multi-stage build.
# Küçük production image için: build araçları (typescript, prisma CLI, tüm
# devDependencies) sadece ara (builder) katmanlarda kalır, runtime katmanına
# yalnızca derlenmiş `dist/` + production node_modules kopyalanır.
# ---------------------------------------------------------------------------

ARG NODE_VERSION=20-alpine

# ---- deps: tüm bağımlılıklar (build için gerekli devDependencies dahil) ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# Prisma engine'leri musl (alpine) hedefi için openssl'e ihtiyaç duyar.
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate

# ---- build: TypeScript derlemesi ----
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
# `npm run build` = `tsc` + scripts/copy-static-assets.js (statik görsel varlıkları dist/'e
# kopyalar, bkz. o script'in başındaki açıklama) — bu yüzden scripts/ de burada gerekli.
COPY scripts ./scripts
RUN npm run build

# ---- prod-deps: sadece production bağımlılıkları + üretilen Prisma client ----
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
# `prisma` CLI, @prisma/client'ın OPTIONAL peer dependency'si olduğu için (ve kendi
# package.json'umuzda da devDependency olarak listelendiği için) `--omit=dev` tek başına
# onu prod node_modules'tan dışarıda bırakmıyor (~26MB). Runtime'da sadece üretilen
# @prisma/client'a ihtiyaç var, CLI'a değil — generate'ten SONRA siliniyor.
RUN npx prisma generate && rm -rf node_modules/prisma

# ---- runtime: minimal çalışma zamanı image'ı ----
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache openssl \
  && addgroup -S nodejs \
  && adduser -S nodejs -G nodejs

COPY --chown=nodejs:nodejs package.json ./
COPY --from=prod-deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/dist ./dist

# Yerel medya deposu (STORAGE_DRIVER=local) için — production'da kalıcılık için
# volume/S3 kullanılması önerilir, bkz. INFRA.md.
RUN mkdir -p /app/uploads && chown -R nodejs:nodejs /app/uploads

# §10.8.5 Toplu İçe Aktarma — PRIVATE, GEÇİCİ kaynak dosya deposu (lib/import-storage.ts,
# STORAGE_DRIVER=local). `uploads/`'ın aksine kasıtlı olarak volume'e BAĞLANMAZ — bkz.
# INFRA.md "İçe aktarma dosya deposu (storage/imports)" bölümü. Dizin yine de burada
# önceden oluşturulur ki container ilk isteği karşılamadan önce yazma izinleri hazır olsun
# (kod tarafında da `ensureLocalDir()` ile `fs.mkdirSync(..., {recursive:true})` fallback'i var).
RUN mkdir -p /app/storage/imports && chown -R nodejs:nodejs /app/storage

# Tele-Sağlık ÖZEL (private) belge deposu (`PRIVATE_UPLOAD_DIR`, sağlık verisi — şikâyet notu
# eki, reçete/tahlil/radyoloji belgesi). BAĞLAYICI (.claude/compliance-notes-telehealth.md
# "TUR 2" KRİTİK ŞART, .claude/architect-scope-telehealth-template.md §9.7.5 KARAR J): bu dizin
# yukarıdaki `/app/uploads`'ın (satır ~57-59, `@fastify/static` ile kimlik doğrulamasız servis
# edilen public dizin) ALT DİZİNİ DEĞİLDİR — `/app/uploads`ın KARDEŞİDİR. Bu Dockerfile'da
# HİÇBİR YERDE bu dizine `COPY` yapılmaz (kişisel sağlık verisi imaja donmuş biçimde GİRMEZ);
# burada yalnızca boş dizin + doğru sahiplik/izin (yalnızca `nodejs` kullanıcısı — backend
# process) önceden hazırlanır, gerçek içerik yalnızca runtime'da bir Docker volume/bind-mount
# ile buraya gelir (bkz. docker-compose.yml `saas_private_uploads` named volume, INFRA.md).
# `@fastify/static`'in `root` parametresi bu dizini ASLA almamalıdır (backend-agent'ın
# plugins/uploads.ts'i, security-agent doğrular) — aksi halde madde 4/5'in tüm koruması delinir.
RUN mkdir -p /app/storage/private-uploads && chown -R nodejs:nodejs /app/storage/private-uploads

USER nodejs

EXPOSE 4000

# /api/v1/healthz — src/modules/health/health.routes.ts (app.ts'te /api/v1 prefix'i ile kayıtlı).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/healthz || exit 1

CMD ["node", "dist/server.js"]
