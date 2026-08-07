import type { FastifyReply, FastifyRequest } from "fastify";
import { NotFoundError } from "../lib/errors";
import { isModuleEnabled } from "../lib/module-state";

/**
 * §10.9 Eklenti/Modül Yönetimi — PUBLIC route'larda kullanılacak preHandler factory'si
 * (`middleware/site-rbac.ts::requireSiteRole` İLE AYNI dosya yapısı/imza tarzında).
 *
 * Modül `MODULE_REGISTRY`'de tanımlı DEĞİLSE veya aktif DEĞİLSE `NotFoundError` (404) fırlatır —
 * `ForbiddenError` (403) BİLEREK kullanılmaz: 403, modülün VAR olduğunu ama erişimin engellendiğini
 * sızdırır; kapalı bir modülün varlığı sızdırılmamalı (mimari karar).
 *
 * Faz 1'de `MODULE_REGISTRY` boş olduğundan bu guard henüz hiçbir route'a bağlanmıyor —
 * SONRAKI fazlarda `requireModuleEnabled("products")` gibi kullanılacak altyapı.
 */
export function requireModuleEnabled(key: string) {
  return async function moduleGuard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const enabled = await isModuleEnabled(request.server, key);
    if (!enabled) throw new NotFoundError();
  };
}
