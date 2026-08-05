import sanitizeHtml from "sanitize-html";

/**
 * Zengin metin/HTML olarak DB'ye yazılan HER alan (blog `contentHtml`, sayfa `blocks[].data.html`,
 * ve bunların yerelleştirme (`translations`) karşılıkları DAHİL, ayrıca içe aktarma modülünün WXR/
 * CSV/JSON `contentHtml` alanları) DB'ye yazılmadan ÖNCE burada temizlenir.
 *
 * Bu, `detectImageMimeType`'ın media+import arasında paylaşılan hale getirilmesiyle AYNI desen
 * (bkz. `lib/mime-detect.ts`) — tek bir temizleme yolundan geçilmesi, modüller arasında
 * sürüklenme (drift) olmamasını garanti eder. Önceden yalnızca içe aktarma modülüne özeldi
 * (`modules/import/lib/sanitize.ts`); artık blog/sayfa yazma yollarının (create/update/revision
 * restore) TAMAMI da bunu kullanır — bkz. ARCHITECTURE.md güvenlik notu: "tek yazar admin/editor
 * güvenilir" varsayımı kırılgandır (EDITOR, ADMIN'den daha az güvenilir bir rol; ele geçirilmiş/
 * kötü niyetli bir EDITOR hesabı stored-XSS payload'ı yerleştirip public site ziyaretçilerini
 * etkileyebilir).
 *
 * İzin listesi (allow-list) yaklaşımı: `sanitize-html`'in varsayılanları zaten `<script>`,
 * `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`'u DIŞLAR ve `on*` özniteliklerini/
 * `javascript:`-`data:` şemalarını taşımaz (bkz. node_modules/sanitize-html — `defaults.
 * allowedTags`, `defaults.allowedSchemes`). Burada SADECE `img`'i (varsayılanda YOK) açıkça
 * ekliyoruz — blog/sayfa içeriğinde gömülü görseller olağan; `data:`/`javascript:` şeması
 * yine de KABUL EDİLMEZ (allowedSchemes değiştirilmedi).
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    img: ["src", "srcset", "alt", "title", "width", "height", "loading"],
    "*": ["id", "class"],
  },
  // Varsayılan: http/https/ftp/mailto/tel — `javascript:`/`data:` bilerek İZİN LİSTESİNDE DEĞİL.
  allowedSchemes: sanitizeHtml.defaults.allowedSchemes,
  allowedSchemesByTag: { img: ["http", "https"] },
  // script/style/iframe/object/embed/form zaten allowedTags'te yok → etiket VE içeriği atılır
  // (bkz. sanitize-html `nonTextTags` varsayılanı: script/style/textarea/option/xmp).
  disallowedTagsMode: "discard",
};

/** Ham HTML'i güvenli hâle getirir. `null`/boş girdi olduğu gibi (boş string) döner. */
export function sanitizeRichHtml(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}
