import {
  GOOGLE_MAP_DEFAULT_ZOOM,
  GOOGLE_MAP_MAX_ZOOM,
  GOOGLE_MAP_MIN_ZOOM,
  type GoogleMapBlock,
  type GoogleMapStyle,
} from "./types";

/**
 * Google Harita bloğu — URL/stil yardımcıları. `video-embed.ts`'in "yapılandırılmış embed"
 * güvenlik deseninin İKİNCİ uygulaması (mimar §2.1/§3, security-review §2/§3/§4 — BAĞLAYICI,
 * mimarın taslağını SIKILAŞTIRIR/DEĞİŞTİRİR).
 */

/**
 * `embedUrl` beyaz listesi — NİHAİ regex (`.claude/security-review-google-map-corporate-blocks.md`
 * §2). AYNEN, karakter karakter, backend `pages.schemas.ts::GOOGLE_MAP_EMBED_URL_RE` ile UYUMLU
 * olmalıdır — TEK kaynak budur. Case-insensitive DEĞİL (`i` bayrağı YOK) — BİLİNÇLİ, bkz.
 * security-review §2 "Not" bölümü. Yalnızca `google.com`/`www.google.com` host'u, yalnızca
 * `https:`, yalnızca `/maps/embed` (+ 5 sabit `/v1/<mod>` yolu) kabul edilir.
 */
export const GOOGLE_MAP_EMBED_URL_RE =
  /^https:\/\/(?:www\.)?google\.com\/maps\/embed(?:\/v1\/(?:place|view|directions|search|streetview))?\?[^\s"'<>`\\]+$/;

/**
 * Sarmalayıcı/`iframe` elemanının KENDİSİNE uygulanan sabit CSS `filter` tablosu (ui-designer §1.3,
 * security-review §4.3 zorunlu kılıyor) — Google Maps Embed iframe'inin İÇERİĞİ restyle EDİLEMEZ,
 * bu dört "stil" klasik "dark mode iframe" tekniğidir. **Yalnızca anahtar-değer look-up** —
 * `mapStyle` değeri hiçbir zaman bir template-literal'e enterpole EDİLMEZ.
 */
export const MAP_STYLE_FILTER: Record<GoogleMapStyle, string> = {
  standard: "none",
  dark: "invert(90%) hue-rotate(180deg) brightness(95%) contrast(90%)",
  silver: "grayscale(85%) brightness(1.08) contrast(0.95)",
  retro: "sepia(55%) saturate(140%) hue-rotate(-8deg) brightness(1.02) contrast(0.92)",
};

/**
 * iframe `sandbox` niteliği — security-review §4.1 BAĞLAYICI kararı (mimarın "v1'de verilmez"
 * önerisi REDDEDİLDİ). TEK yerde tanımlanır; hem public `google-map-block.tsx` HEM admin
 * kart-içi canlı önizleme BURADAN import eder — kopyalanmaz. İki ayrı kod yolu farklı bir
 * sandbox/referrerPolicy setiyle YAZILAMAZ (tehdit modelinde EDITOR'ün kendisi de hedef olabilir).
 */
export const MAP_IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms";

/** iframe `referrerPolicy` — security-review §4.2 (mimarın `no-referrer-when-downgrade` önerisi
 *  YERİNE). Cross-origin isteklerde yalnızca origin gönderilir, path/query GÖNDERİLMEZ. */
export const MAP_IFRAME_REFERRER_POLICY = "strict-origin-when-cross-origin" as const;

/**
 * `locale`/`hl` parametresi — kapalı bir listeye karşı doğrulanır (security-review §3, savunma
 * derinliği — `getMapEmbedUrl` çağıranın routing katmanına GÜVENMEDEN kendi içinde de doğrular).
 * Desteklenmeyen/boş bir değer sabit bir varsayılana (`"tr"`) düşer.
 */
const SUPPORTED_LOCALES = ["tr", "en"] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
const DEFAULT_LOCALE: SupportedLocale = "tr";

function resolveLocale(locale: string | null | undefined): SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale ?? "") ? (locale as SupportedLocale) : DEFAULT_LOCALE;
}

/** `zoom` — okuma/render anında throw ETMEZ, savunma amaçlı clamp eder (security-review §3:
 *  yazma anı = Zod 422 ile reddet, okuma anı = burada sessizce clamp — `video-embed.ts`'in
 *  "hiçbir zaman patlamaz" deseniyle tutarlı). Eski/bozuk kayıt ihtimaline karşıdır. */
function clampZoom(zoom: number | undefined): number {
  const raw = zoom ?? GOOGLE_MAP_DEFAULT_ZOOM;
  return Math.min(GOOGLE_MAP_MAX_ZOOM, Math.max(GOOGLE_MAP_MIN_ZOOM, raw));
}

/**
 * Kullanıcının Google Haritalar → Paylaş → "Haritayı yerleştir" panelinden kopyaladığı TÜM
 * `<iframe src="...">` HTML snippet'inden çıplak embed URL'ini çıkarır. Backend
 * `pages.schemas.ts::extractGoogleMapEmbedUrlFromInput` ile AYNEN, karakter karakter senkron
 * tutulmalıdır — TEK kaynak budur, davranış farklılığı istemci/sunucu arasında tutarsız
 * doğrulamaya yol açar. Bulunan aday yine de yukarıdaki değişmeyen beyaz liste regex'inden
 * geçmek ZORUNDADIR — bu fonksiyon yalnızca çıkarım yapar, doğrulamayı gevşetmez.
 */
export function extractGoogleMapEmbedUrlFromInput(raw: string): string {
  const trimmed = raw.trim();
  if (!/<iframe/i.test(trimmed)) return trimmed;
  const match = trimmed.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
  const srcValue = match?.[1];
  if (!srcValue) return trimmed;
  // Yalnızca `&amp;` çözülür (Google'ın snippet'i çoklu query param'da `&`'yi bu şekilde kaçırır);
  // genel HTML-entity decode'u (`&lt;`, `&quot;`, sayısal varlıklar vb.) yukarıdaki beyaz liste
  // regex'i için yeni bir bypass yüzeyi açar, bu yüzden BİLİNÇLİ olarak yapılmaz.
  return srcValue.replace(/&amp;/g, "&").trim();
}

/**
 * İki kaynak modu (mimar §2.1, bağlayıcı davranış):
 * - `embedUrl` DOLU ve yukarıdaki NİHAİ regex'ten GEÇİYORSA → aynen kullanılır.
 * - Aksi halde `address` DOLU ise → sabit şablon: `https://www.google.com/maps?q=<address>&z=<zoom>&hl=<locale>&output=embed`
 *   (`encodeURIComponent` ile kodlanır — enjeksiyon yüzeyi yok, security-review §3).
 * - İkisi de boş / `embedUrl` beyaz listeyi geçemiyor → `null` (hata fırlatılmaz, hiçbir şey
 *   render EDİLMEZ — `video-embed.ts`'in `null` dönme deseniyle birebir).
 */
export function getMapEmbedUrl(data: GoogleMapBlock["data"], locale?: string | null): string | null {
  const embedUrl = data.embedUrl?.trim();
  if (embedUrl && GOOGLE_MAP_EMBED_URL_RE.test(embedUrl)) {
    return embedUrl;
  }

  const address = data.address?.trim();
  if (!address) return null;

  const resolvedLocale = resolveLocale(locale);
  const zoom = clampZoom(data.zoom);
  // Sabit şablon (mimar §2.1/§3.3) — `address` HİÇBİR ZAMAN ham olarak yazılmaz, `encodeURIComponent`
  // ile kodlanır. `zoom` sayıdır (clamp edilmiş), `locale` kapalı listeye karşı doğrulanmıştır —
  // enjeksiyon yapısal olarak imkânsız.
  return `https://www.google.com/maps?q=${encodeURIComponent(address)}&z=${zoom}&hl=${resolvedLocale}&output=embed`;
}
