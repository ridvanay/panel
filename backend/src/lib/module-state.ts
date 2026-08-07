import type { FastifyInstance } from "fastify";
import { getModuleDefinition } from "./module-registry";

/**
 * §10.9 Eklenti/Modül Yönetimi — bir modülün şu an aktif olup olmadığını okur.
 * `SiteModule` tablosunda satır varsa oradaki `enabled` değeri esas alınır; satır YOKSA
 * (henüz hiç toggle edilmemiş) `MODULE_REGISTRY`'deki `defaultEnabled` fallback olur —
 * `settings.routes.ts::DEFAULTS` ile AYNI lazy-upsert paterni (satır ilk PATCH'te oluşur).
 *
 * Bilinçli olarak süreç-içi memoizasyon YOK — Faz 1'de gerek yok, her istekte DB okunur.
 */
export async function isModuleEnabled(app: FastifyInstance, key: string): Promise<boolean> {
  const definition = getModuleDefinition(key);
  if (!definition) return false;

  const row = await app.prisma.siteModule.findUnique({ where: { key } });
  return row ? row.enabled : definition.defaultEnabled;
}
