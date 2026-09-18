# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# frontend/Dockerfile — Next.js (App Router), `output: "standalone"` ile
# multi-stage build. Runtime katmanı yalnızca standalone server + statik
# dosyaları içerir (tam node_modules kopyalanmaz).
# ---------------------------------------------------------------------------

ARG NODE_VERSION=20-alpine

# ---- deps ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# Trivy CRITICAL/HIGH Alpine paket yamaları — base imajın apk paketlerini güncel güvenlik
# yamalarına getirir (her stage ayrı bir dosya sistemi katmanıdır, bu yüzden her `FROM
# node:...` stage'inde AYRICA çalıştırılması gerekir).
RUN apk update && apk upgrade --no-cache
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder ----
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
RUN apk update && apk upgrade --no-cache
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* değişkenleri build-time'da tarayıcı bundle'ına gömülür — bu
# yüzden ENV değil, build ARG olarak verilir (bkz. docker-compose.yml build.args).
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
# Hekim portalı (`/doctor/**`) subdomain izolasyonu — NEXT_PUBLIC_SITE_URL ile AYNI desen
# (build-time inline edilir, runtime `environment:` YETMEZ). TANIMSIZ bırakılırsa
# `isDoctorHostname()` (src/lib/doctor-host.ts) her zaman false döner ve özelliğin tamamı
# devre dışı kalır (geriye dönük uyumluluk) — bkz. docker-compose.yml frontend.build.args.
ARG NEXT_PUBLIC_DOCTOR_URL=
# next/image'in KENDİ sunucu-taraflı optimize fetch'i (frontend container'ının İÇİNDE çalışır)
# NEXT_PUBLIC_API_URL'in (tarayıcı-taraflı, ör. localhost:4000) host'una ULAŞAMAZ — bkz.
# docker-compose.yml frontend.build.args ve frontend/src/lib/env.ts::INTERNAL_MEDIA_ORIGIN yorumu.
# Docker DIŞINDA (bu ARG boş bırakıldığında) no-op kalır, mevcut davranış BOZULMAZ.
ARG NEXT_PUBLIC_INTERNAL_MEDIA_URL=
ARG NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS=
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_DOCTOR_URL=${NEXT_PUBLIC_DOCTOR_URL}
ENV NEXT_PUBLIC_INTERNAL_MEDIA_URL=${NEXT_PUBLIC_INTERNAL_MEDIA_URL}
ENV NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS=${NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---- runtime ----
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# ÖNEMLİ: standalone server.js `process.env.HOSTNAME`'i okur; Docker container'ın kendi
# hostname'ini (container ID) otomatik olarak HOSTNAME env değişkenine yazar — bu yüzden
# açıkça override edilmezse Next.js sunucusu 0.0.0.0/127.0.0.1 yerine container'ın dahili
# IP'sine bind olur ve host'tan/healthcheck'ten erişilemez hale gelir.
ENV HOSTNAME=0.0.0.0
WORKDIR /app

RUN apk update && apk upgrade --no-cache \
  && addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# /api/health — src/app/api/health/route.ts
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
