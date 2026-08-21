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

/**
 * §10.16.4 E-posta Şablonu Blok Editörü — `sanitizeRichHtml`'DEN BİLEREK AYRI, DAHA DAR bir
 * allow-list. Yalnızca e-posta bloğu (`type: "text"`) içindeki zengin metin için kullanılır
 * (bkz. `lib/email-renderer.ts`).
 *
 * GEREKÇE (ARCHITECTURE.md §10.16.4 — §10.15.2 ile AYNI SINIF tuzak): yukarıdaki
 * `SANITIZE_OPTIONS.allowedAttributes["*"]` yalnızca `["id","class"]`'a izin verir — `style`
 * özniteliği ALLOW-LIST DIŞIDIR ve sessizce silinir. E-posta HTML'i ise satır-içi (`inline`)
 * `style` OLMADAN çalışmaz (Gmail `<style>` bloğunu, Outlook `class` seçicilerini güvenilir
 * şekilde desteklemez) — ama `style`'ı `sanitizeRichHtml`'de GEVŞETMEK tüm blog/sayfa içeriği
 * için bir CSS enjeksiyon yüzeyi açardı. Bu yüzden İKİ AYRI, birbirinden bağımsız sabit yan yana
 * durur: `SANITIZE_OPTIONS` (blog/sayfa, DEĞİŞTİRİLMEZ) ve `EMAIL_RICH_TEXT_SANITIZE_OPTIONS`
 * (yalnızca e-posta `text` bloğu).
 *
 * Bu allow-list `style`/`class`/`id` DAHİL DEĞİLDİR — e-posta blok editöründe görsel her şey
 * (hizalama/renk/boşluk) `lib/email-renderer.ts` tarafından, doğrulanmış stil token'larından
 * (enum hizalama, `^#[0-9a-fA-F]{6}$` renk, `none|sm|md|lg` boşluk) üretilir; kullanıcı hiçbir
 * koşulda ham CSS yazamaz. Bu yüzden `text` bloğunun zengin metni SADECE metin biçimlendirme
 * (kalın/italik/liste/link) taşır, blok DÜZENİNİ etkileyemez.
 */
/**
 * GÜVENLİK DÜZELTMESİ (security-agent denetimi) — reverse tabnabbing savunması. `a` için
 * `target`/`rel` allow-list'te olsa da (editör TipTap `Link` uzantısı `target="_blank"` +
 * `rel="noopener noreferrer nofollow"`'u VARSAYILAN olarak birlikte üretir), `sanitize-html`
 * bu ikisi arasında bir BAĞ kurmaz — editör UI'sı bypass edilip API doğrudan çağrılırsa
 * `target="_blank"` olan ama `rel` göndermeyen/eksik bırakan bir istek, `window.opener` erişimi
 * bırakan bir bağlantı olarak DB'ye yazılabilirdi (gönderilen e-postada hedef sayfa, açan
 * sekmeyi yönlendirebilir — phishing vektörü). Savunma derinliği: `target="_blank"` olan HER
 * `a` etiketine `rel="noopener noreferrer"` zorunlu kılınır (kullanıcının gönderdiği `rel`
 * değeri neyse üzerine yazılır — burada güven değil, GÜVENLİK öncelenir).
 */
function enforceNoopenerOnBlankTarget(tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Tag {
  const nextAttribs = { ...attribs };
  if (nextAttribs.target === "_blank") {
    nextAttribs.rel = "noopener noreferrer";
  } else {
    delete nextAttribs.rel;
  }
  return { tagName, attribs: nextAttribs };
}

const EMAIL_RICH_TEXT_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "u", "s", "a", "ul", "ol", "li", "span"],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    "*": [],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  disallowedTagsMode: "discard",
  transformTags: {
    a: enforceNoopenerOnBlankTarget,
  },
};

/**
 * E-posta blok editörünün `text` bloğu (`data.html`) için — `sanitizeRichHtml`'den AYRI, DAHA
 * DAR bir allow-list kullanır (bkz. yukarıdaki gerekçe). `null`/boş girdi olduğu gibi (boş
 * string) döner.
 */
export function sanitizeEmailRichText(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, EMAIL_RICH_TEXT_SANITIZE_OPTIONS);
}

/**
 * §Faz 4 "Dinamik & CMS İçerikleri" — Özel HTML / Kod Bloğu (`page-builder` `type: "custom-html"`,
 * bkz. `modules/pages/lib/sanitize-blocks.ts`). `sanitizeRichHtml`'DEN BİLEREK AYRI, DAHA GENİŞ
 * bir izin listesi: AYNI taban (varsayılan `sanitize-html` etiketleri + `img`) ÜZERİNE `iframe`
 * eklenir — bu bloğun TEK var oluş gerekçesi harici widget/harita gömme (video-embed.ts'nin
 * "yapılandırılmış embed" deseninin GENELLEŞTİRİLMİŞ hâli, bkz. o dosyanın başlığındaki öngörü).
 *
 * `script`/`style`/`object`/`embed`/`form`/`link`/`meta`/`base` HİÇBİR KOŞULDA izin listesine
 * ALINMAZ — "sanitize edilmiş güvenli kod alanı" ifadesi bunları KAPSAMAZ, aksi hâlde bu bir Özel
 * HTML bloğu değil KEYFİ KOD ÇALIŞTIRMA birimi olurdu (bkz. dosya başlığındaki EDITOR tehdit
 * modeli — bu blok da AYNI riske tabidir: ele geçirilmiş/kötü niyetli bir EDITOR hesabı, arbitrary
 * `<script>`e izin verilseydi public site ziyaretçilerine karşı sınırsız stored-XSS elde ederdi).
 *
 * `iframe.src` yalnızca http(s) (`allowedSchemesByTag`, `img` ile AYNI desen) — `javascript:`/
 * `data:`/`vbscript:` ASLA. `sandbox` KULLANICI GİRDİSİNDEN NE OLURSA OLSUN sabit, güvenli bir
 * değere ZORLANIR (`enforceIframeSandbox`, aşağıdaki `enforceNoopenerOnBlankTarget` ile AYNI
 * "güvenlik kullanıcı niyetinin üzerindedir" deseni) — `allow-same-origin` KASITLI OLARAK
 * DIŞLANIR (well-known `allow-scripts`+`allow-same-origin` birlikte kullanımı, gömülü içerik
 * kendi site'ımızla AYNI origin'den servis edilirse sandbox'ı fiilen etkisizleştirebilir);
 * `allow-top-navigation` YOK — gömülü içerik üst pencereyi YÖNLENDİREMEZ, yalnızca kendi
 * alt-çerçevesi içinde çalışabilir.
 */
function enforceIframeSandbox(tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Tag {
  return {
    tagName,
    attribs: { ...attribs, sandbox: "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms" },
  };
}

const CUSTOM_HTML_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "iframe"],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    img: ["src", "srcset", "alt", "title", "width", "height", "loading"],
    iframe: ["src", "width", "height", "title", "allow", "allowfullscreen", "loading", "referrerpolicy", "frameborder", "sandbox"],
    "*": ["id", "class"],
  },
  // Varsayılan: http/https/ftp/mailto/tel — `javascript:`/`data:`/`vbscript:` bilerek İZİN LİSTESİNDE DEĞİL.
  allowedSchemes: sanitizeHtml.defaults.allowedSchemes,
  allowedSchemesByTag: { img: ["http", "https"], iframe: ["http", "https"] },
  // script/style/object/embed/form zaten allowedTags'te yok → etiket VE içeriği atılır.
  disallowedTagsMode: "discard",
  transformTags: {
    iframe: enforceIframeSandbox,
  },
};

/**
 * Özel HTML / Kod Bloğunun `data.html`'ini temizler. `null`/boş girdi olduğu gibi (boş string)
 * döner. `modules/pages/lib/sanitize-blocks.ts::sanitizeSinglePageBlock`'un `custom-html` dalı
 * dışında BAŞKA HİÇBİR YERDEN çağrılmamalı — tek temizleme yolu (bkz. dosya başlığı).
 */
export function sanitizeCustomHtmlBlock(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, CUSTOM_HTML_SANITIZE_OPTIONS);
}
