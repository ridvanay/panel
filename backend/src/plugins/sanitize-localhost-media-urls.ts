import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { stripLoopbackUrlPrefixes } from "../lib/sanitize-localhost-urls";

/**
 * 2026-09-19 (kullanıcı talebi) — savunma derinliği katmanı: `config/env.ts`'teki `PUBLIC_URL`/
 * `FRONTEND_URL` boot guard'ları (production'da `localhost`/`127.0.0.1`/`*.localhost`'u REDDEDER)
 * yalnızca BUGÜNDEN İTİBAREN üretilen `absolutizeMediaUrl` çıktısını korur — `scripts/fix-
 * hardcoded-localhost-media-urls.ts`'in dosya başı yorumunda açıklandığı gibi, admin panelinin
 * MediaPicker'ı geçmişte (`PUBLIC_URL` yanlış yapılandırılmışken) bazı İÇERİK alanlarına (blog/
 * ürün/portföy/sayfa builder blokları/doktor biyografisi vb.) MUTLAK bir loopback URL'yi DOĞRUDAN,
 * DONMUŞ metin olarak yazmış olabilir — DB temizlik script'i BUGÜNE KADAR birikmiş satırları
 * düzeltir, ama YARIN biri (script çalıştıktan SONRA bile) `PUBLIC_URL` geçici olarak yanlışken
 * tekrar bir görsel SEÇERSE aynı sınıf hata TEKRAR oluşabilir. Bu `onSend` hook'u SON bir güvenlik
 * ağıdır: `Content-Type: application/json` olan HER yanıt gövdesinde kalan HERHANGİ bir loopback
 * host+port önekini (regex `lib/sanitize-localhost-urls.ts::LOOPBACK_URL_PREFIX_PATTERN`) SİLER —
 * istemciye ASLA `localhost`/`127.0.0.1`/`*.localhost` içeren bir URL SIZAMAZ, kök neden (DB'deki
 * donmuş veri VEYA `PUBLIC_URL` yanlış yapılandırması) hâlâ AYRICA düzeltilmesi gerekse de.
 *
 * Performans: `stripLoopbackUrlPrefixes` önce ucuz bir `includes()` kontrolü yapar (regex'i
 * yalnızca eşleşme OLASILIĞI varsa çalıştırır) — normal (temiz) bir yanıtta ek maliyet bir substring
 * taramasından İBARETTİR, `JSON.parse`/`stringify` YAPILMAZ (ham metin üzerinde çalışır).
 */
export default fp(async function sanitizeLocalhostMediaUrlsPlugin(app: FastifyInstance) {
  app.addHook("onSend", async (_request, reply, payload) => {
    if (typeof payload !== "string") return payload;
    const contentType = reply.getHeader("content-type");
    if (typeof contentType !== "string" || !contentType.includes("application/json")) return payload;
    return stripLoopbackUrlPrefixes(payload);
  });
});
