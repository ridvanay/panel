/**
 * `config/env.ts::isLoopbackHostname` İLE AYNI üç host sınıfı (çıplak `localhost`/`127.0.0.1` VE
 * RFC 6761 `*.localhost` alt-alan-adları), burada bir URL ÖNEKİ regex'i olarak. TEK kaynak: hem
 * `plugins/sanitize-localhost-media-urls.ts` (yanıt gövdesi savunma katmanı) hem
 * `scripts/fix-hardcoded-localhost-media-urls.ts` (tek seferlik DB düzeltmesi) AYNI deseni
 * kullanır — ikisi ayrı ayrı YAZILIP birbirinden SAPMASIN diye.
 */
export const LOOPBACK_URL_PREFIX_PATTERN = /https?:\/\/(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)(:[0-9]+)?/gi;

/**
 * Bir metindeki (ham JSON gövdesi dahil) TÜM loopback host+port öneklerini SİLER — mutlak bir
 * `http://localhost:4000/uploads/x.jpg` URL'sini kök-göreceli `/uploads/x.jpg`'ye çevirir (sabit
 * bir domain'e DEĞİL — gerekçe için `scripts/fix-hardcoded-localhost-media-urls.ts` dosya başı
 * yorumuna bkz.). Eşleşme yoksa (olağan durum, HER response'ta) girdiyi OLDUĞU GİBİ döner.
 */
export function stripLoopbackUrlPrefixes(text: string): string {
  if (!text.includes("localhost") && !text.includes("127.0.0.1")) return text;
  return text.replace(LOOPBACK_URL_PREFIX_PATTERN, "");
}
