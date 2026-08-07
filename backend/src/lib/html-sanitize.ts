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
 *
 * Tablo desteği (TipTap `@tiptap/extension-table`, `resizable: false`): `sanitize-html`'in
 * VARSAYILAN `allowedTags`'i zaten `table`/`thead`/`tbody`/`tfoot`/`tr`/`th`/`td`/`caption`/
 * `col`/`colgroup`'u İÇERİR (yapı zaten güvenli şekilde geçer). Ancak varsayılan
 * `allowedAttributes` `td`/`th` için HİÇBİR öznitelik tanımlamaz — TipTap'in hücre birleştirmede
 * ürettiği `colspan`/`rowspan` bu yüzden `"*": ["id","class"]` global listesine girmediğinden
 * sessizce silinir. Bunları açıkça izin listesine alıyoruz. `resizable: false` olduğu için
 * `colwidth` ÜRETİLMEZ ve bilerek izin listesine ALINMAZ (üretilmeyen bir attribute'a izin
 * vermenin faydası yok, saldırı yüzeyini gereksiz büyütür).
 *
 * `colspan`/`rowspan` DEĞERLERİ `sanitize-html` tarafından doğrulanmaz (sadece attribute ADI
 * izin listesinde kontrol edilir) — bu dosyanın üstteki tehdit modeli notunda belirtildiği gibi
 * ele geçirilmiş/kötü niyetli bir EDITOR hesabı, API'yi doğrudan çağırarak editör UI'sini bypass
 * edip `colspan="999999999"` gibi keyfi bir değer yerleştirebilir. TipTap UI'si zaten mevcut
 * satır/sütun sayısını aşan birleştirmeye izin vermez, ama bu bir istemci tarafı kısıtı olduğu
 * için sunucu tarafında güvenilemez. Savunma derinliği için `transformTags` ile bu iki değeri
 * 1-50 arası bir tam sayıya SIKIŞTIRIYORUZ (reddetmek yerine sıkıştırmak, geçersiz/aşırı bir
 * değer yüzünden tüm hücrenin/satırın kaybolmasını önler; 50, gerçekçi bir editoryal tablo için
 * cömert bir üst sınırdır ve olası bir DoS/aşırı render maliyetini pratik olarak sıfırlar).
 */
const MAX_TABLE_SPAN = 50;

function clampSpanValue(rawValue: string): string {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return "1";
  return String(Math.min(parsed, MAX_TABLE_SPAN));
}

function clampTableSpanAttributes(
  tagName: string,
  attribs: sanitizeHtml.Attributes,
): sanitizeHtml.Tag {
  const nextAttribs = { ...attribs };
  if (nextAttribs.colspan !== undefined) {
    nextAttribs.colspan = clampSpanValue(nextAttribs.colspan);
  }
  if (nextAttribs.rowspan !== undefined) {
    nextAttribs.rowspan = clampSpanValue(nextAttribs.rowspan);
  }
  return { tagName, attribs: nextAttribs };
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    img: ["src", "srcset", "alt", "title", "width", "height", "loading"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
    "*": ["id", "class"],
  },
  // Varsayılan: http/https/ftp/mailto/tel — `javascript:`/`data:` bilerek İZİN LİSTESİNDE DEĞİL.
  allowedSchemes: sanitizeHtml.defaults.allowedSchemes,
  allowedSchemesByTag: { img: ["http", "https"] },
  // script/style/iframe/object/embed/form zaten allowedTags'te yok → etiket VE içeriği atılır
  // (bkz. sanitize-html `nonTextTags` varsayılanı: script/style/textarea/option/xmp).
  disallowedTagsMode: "discard",
  transformTags: {
    td: clampTableSpanAttributes,
    th: clampTableSpanAttributes,
  },
};

/** Ham HTML'i güvenli hâle getirir. `null`/boş girdi olduğu gibi (boş string) döner. */
export function sanitizeRichHtml(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}
