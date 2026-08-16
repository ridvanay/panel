import type { FastifyReply, FastifyRequest } from "fastify";
import type { ApiKeyScope } from "@prisma/client";
import { UnauthorizedError, ForbiddenError } from "../lib/errors";
import { hashToken } from "../lib/tokens";
import { parseApiKey, timingSafeEqualHex, getCachedApiKey, setCachedApiKey, type CachedApiKey } from "../lib/api-key";
import { maskIp } from "../lib/pii-mask";

/** §10.13.4 madde 7 — `lastUsedAt` yalnızca boşsa VEYA bu kadar eskiyse güncellenir. */
const LAST_USED_THROTTLE_MS = 60_000;

/** Hem "anahtar yok" hem "anahtar yanlış" için TEK sabit mesaj — numaralandırma koruması. */
const INVALID_KEY_MESSAGE = "Geçersiz veya eksik API anahtarı.";

/** `lastUsedAt`/`lastUsedIp` güncellemesi — fire-and-forget, hatası isteği ASLA düşürmez (`logAudit` deseni). */
function touchLastUsed(request: FastifyRequest, apiKeyId: string, lastUsedAt: Date | null): void {
  const shouldUpdate = !lastUsedAt || Date.now() - lastUsedAt.getTime() > LAST_USED_THROTTLE_MS;
  if (!shouldUpdate) return;

  void request.server.prisma.apiKey
    .update({
      where: { id: apiKeyId },
      data: { lastUsedAt: new Date(), lastUsedIp: maskIp(request.ip) },
    })
    .catch((err) => {
      request.server.log.error({ err, apiKeyId }, "API anahtarı lastUsedAt güncellenemedi");
    });
}

/**
 * §10.13.4 — `/public/*` uçları için `X-Api-Key` doğrulama preHandler'ı. `Authorization: Bearer`
 * KABUL EDİLMEZ (bağlayıcı karar, ARCHITECTURE.md §10.13.4). Başarıda `request.apiKey` set edilir;
 * `request.user` ASLA set EDİLMEZ.
 */
export function requireApiKey(requiredScope: ApiKeyScope = "READ") {
  return async function apiKeyAuthGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = request.headers["x-api-key"];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) throw new UnauthorizedError(INVALID_KEY_MESSAGE);

    const parsed = parseApiKey(raw);
    if (!parsed) throw new UnauthorizedError(INVALID_KEY_MESSAGE);

    let cached: CachedApiKey | undefined = getCachedApiKey(parsed.keyPrefix);
    let lastUsedAtForTouch: Date | null = null;

    if (!cached) {
      const row = await request.server.prisma.apiKey.findUnique({
        where: { keyPrefix: parsed.keyPrefix },
        select: { id: true, keyHash: true, scope: true, status: true, expiresAt: true, name: true, lastUsedAt: true },
      });
      if (!row) throw new UnauthorizedError(INVALID_KEY_MESSAGE);
      lastUsedAtForTouch = row.lastUsedAt;
      cached = { id: row.id, keyHash: row.keyHash, scope: row.scope, status: row.status, expiresAt: row.expiresAt, name: row.name };
    }

    const candidateHash = hashToken(raw);
    if (!timingSafeEqualHex(candidateHash, cached.keyHash)) {
      throw new UnauthorizedError(INVALID_KEY_MESSAGE);
    }

    if (cached.status !== "ACTIVE") throw new UnauthorizedError(INVALID_KEY_MESSAGE);
    if (cached.expiresAt && cached.expiresAt.getTime() <= Date.now()) throw new UnauthorizedError(INVALID_KEY_MESSAGE);

    // Yalnızca POZİTİF (geçerli+aktif+süresi dolmamış) sonuç önbelleğe alınır.
    setCachedApiKey(parsed.keyPrefix, cached);

    const scopeOrder: Record<ApiKeyScope, number> = { READ: 0, READ_WRITE: 1 };
    if (scopeOrder[cached.scope] < scopeOrder[requiredScope]) {
      throw new ForbiddenError("API anahtarının yetki kapsamı bu işlem için yetersiz.");
    }

    request.apiKey = { id: cached.id, name: cached.name, scope: cached.scope, expiresAt: cached.expiresAt };
    touchLastUsed(request, cached.id, lastUsedAtForTouch);
  };
}
