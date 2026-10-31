/**
 * Paket AE-ek — Open Graph görseli uyumluluğu. Sunucu her WebP için aynı adda bir `.jpg` kopyası
 * saklar; sosyal ağlar WebP'yi her zaman göstermediğinden og:image/twitter:image bu kopyayı kullanır.
 * Yalnızca `/uploads/<uuid>.webp` desenini dönüştürür (mutlak URL de olur); diğer URL'lere dokunmaz.
 */
const UPLOAD_WEBP = /(\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp(?=$|[?#])/i;

export function ogCompatibleImageUrl(url: string): string;
export function ogCompatibleImageUrl(url: string | null | undefined): string | null | undefined;
export function ogCompatibleImageUrl(url: string | null | undefined): string | null | undefined {
  if (!url) return url;
  return url.replace(UPLOAD_WEBP, "$1.jpg");
}
