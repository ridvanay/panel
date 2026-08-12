import type { SiteFont } from "@/lib/api/types";

/**
 * §10.12.6 render sözleşmesi (frontend-agent için BAĞLAYICI, ARCHITECTURE.md): kaydedilen
 * `customCss`/`customJs` `(site)` layout'una gömülmeden ÖNCE kapanış etiketi kaçışı ZORUNLUDUR —
 * aksi hâlde metin `</style>`/`</script>` içerirse kendi etiketinden erken çıkıp belgeye keyfi
 * işaretleme enjekte edebilir (XSS/HTML injection). Yalnızca kapanış YÖNÜNÜ kaçırıyoruz (`</script`
 * → `<\/script`), açılış etiketini DEĞİL — bu, tarayıcının kod bloğunu normal şekilde ayrıştırmasını
 * bozmadan enjeksiyonu nötrler (yaygın, güvenli bir kalıp).
 */
export function escapeEmbeddedClosingTags(code: string): string {
  return code.replace(/<\/(script|style)/gi, "<\\/$1");
}

/**
 * Font eşleştirme tablosu (ui-designer kararı, design-notes-appearance-panel.md §7) — `SiteFont`
 * enum'u KAPALI olduğu için (§10.12.3, `next/font/google` derleme-zamanı kısıtı) admin panelindeki
 * mini-önizleme kartları GERÇEK fontu YÜKLEMEZ, yalnızca tarayıcının zaten sahip olduğu en yakın
 * sistem eşleniğini (`cssFallback`) gösterir. Gerçek font SADECE `(site)` layout'unda/canlı
 * önizlemede `next/font/google` üzerinden yüklenir (bkz. `(site)/layout.tsx`, `SITE_FONT_CLASS_MAP`
 * orada tanımlıdır — kapalı enum derleme-zamanı importu gerektirdiği için burada DEĞİL, layout'ta).
 */
export const SITE_FONT_OPTIONS: { value: SiteFont; label: string; cssFallback: string }[] = [
  { value: "SYSTEM", label: "Sistem Yazı Tipi", cssFallback: "ui-sans-serif, system-ui, sans-serif" },
  { value: "INTER", label: "Inter", cssFallback: "Inter, ui-sans-serif, sans-serif" },
  { value: "ROBOTO", label: "Roboto", cssFallback: "Roboto, Arial, sans-serif" },
  { value: "OPEN_SANS", label: "Open Sans", cssFallback: '"Segoe UI", Arial, sans-serif' },
  { value: "MONTSERRAT", label: "Montserrat", cssFallback: "Verdana, Geneva, sans-serif" },
  { value: "POPPINS", label: "Poppins", cssFallback: "Verdana, Geneva, sans-serif" },
  { value: "LORA", label: "Lora", cssFallback: 'Georgia, "Times New Roman", serif' },
  { value: "PLAYFAIR_DISPLAY", label: "Playfair Display", cssFallback: "Georgia, serif" },
  { value: "SOURCE_SERIF_4", label: "Source Serif 4", cssFallback: '"Times New Roman", Times, serif' },
];

export function siteFontLabel(font: SiteFont): string {
  return SITE_FONT_OPTIONS.find((opt) => opt.value === font)?.label ?? font;
}
