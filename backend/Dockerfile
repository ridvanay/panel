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

USER nodejs

EXPOSE 4000

# /api/v1/healthz — src/modules/health/health.routes.ts (app.ts'te /api/v1 prefix'i ile kayıtlı).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/healthz || exit 1

CMD ["node", "dist/server.js"]
