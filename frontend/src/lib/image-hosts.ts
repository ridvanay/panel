/**
 * `next/image`, `next.config.ts`'teki `images.remotePatterns` dışındaki bir host'a verilirse
 * ÇALIŞMA ZAMANINDA hata fırlatır. Medya URL'leri ortama göre değişir (yerel sürücüde
 * `PUBLIC_URL`, S3/CDN'de tamamen farklı bir host — bkz.
 * `.claude/architect-scope-products-catalog.md` §6.1), bu yüzden component'ler `next/image`
 * kullanmadan ÖNCE görsel URL'sinin host'unun izinli listede olup olmadığını burada kontrol
 * eder. `next.config.ts::buildImageRemotePatterns` ile AYNI iki env değişkeninden
 * (`NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_MEDIA_URL`) türer — iki ayrı "izinli host" listesi
 * YAZILMAZ, ikisi de bu dosyadaki `IMAGE_HOST_ENV_KEYS` sabitine bakar.
 *
 * ÖNEMLİ — `process.env[key]` gibi DİNAMİK (computed) erişim KULLANILMAZ: Next.js
 * `NEXT_PUBLIC_*` değişkenlerini client bundle'a yalnızca STATİK `process.env.FOO` üye
 * erişimlerini derleme zamanında (webpack `DefinePlugin`) değere sabitleyerek taşır. Dinamik
 * `process.env[key]` bu sabitlemeye uygun DEĞİLDİR; sunucuda (Node.js runtime, gerçek
 * `process.env`) doğru host listesini üretirken client bundle'ında `process.env` çalışma
 * zamanında boş/eksik kaldığı için host listesi HER ZAMAN boş dönerdi — bu da SSR'de
 * `next/image`, CSR'de düz `<img>` seçilmesine (hydration mismatch) yol açıyordu. Bu yüzden
 * her iki env değişkenine de STATİK olarak erişilir (`next.config.ts::buildImageRemotePatterns`
 * ile AYNI desen).
 */
export const IMAGE_HOST_ENV_KEYS = ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_MEDIA_URL"] as const;

function collectAllowedHosts(): string[] {
  const hosts = new Set<string>();
  // Static erişim ZORUNLU (bkz. yukarıdaki not) — `IMAGE_HOST_ENV_KEYS` sırasıyla eşleşir.
  for (const raw of [process.env.NEXT_PUBLIC_API_URL, process.env.NEXT_PUBLIC_MEDIA_URL]) {
    if (!raw) continue;
    try {
      hosts.add(new URL(raw).hostname);
    } catch {
      // Çözümlenemeyen URL — bu host'u ATLA, `isOptimizableImageUrl` bu görseli next/image
      // dışında bırakır (mevcut <img> davranışına düşer, build/runtime KIRILMAZ).
    }
  }
  return [...hosts];
}

const ALLOWED_IMAGE_HOSTS = collectAllowedHosts();

/** Verilen mutlak görsel URL'sinin host'u `remotePatterns` içinde mi — next/image bunu KABUL EDER mi. */
export function isOptimizableImageUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    return ALLOWED_IMAGE_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
