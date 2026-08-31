/**
 * §10.20 — Şablon modunda ("standart" kullanıcı) hangi alanların düzenlenebilir olduğunun TEK
 * kaynağı (bkz. `.claude/architect-scope-page-editor-roles.md` §3.1/§3.2, BAĞLAYICI karar).
 *
 * `block.settings.editableFields` gibi VERİ-tabanlı bir yaklaşım BİLİNÇLİ olarak REDDEDİLDİ:
 * liste kullanıcı tarafından gönderilen gövdenin bir parçası olsaydı, standart bir kullanıcı
 * listeye `"settings"` ekleyerek KENDİ KENDİNİ yetkilendirebilirdi (§2.2'deki aynı tuzak).
 * Bu yüzden harita KODDA SABİTTİR ve `assertTemplateEditAllowed` (`page-template-guard.ts`)
 * dışında hiçbir yerden okunmaz/yazılmaz.
 *
 * **Ayna (frontend):** `frontend/src/lib/page-builder/template-fields.ts` — içerik BİREBİR aynı
 * olmak ZORUNDADIR (frontend sadece UX için kullanır; asıl uygulama HER ZAMAN backend'dedir).
 *
 * **Fail-closed kural (bağlayıcı):** haritada olmayan HER `type` için düzenlenebilir alan kümesi
 * BOŞTUR — bilinmeyen/gelecek blok tipleri otomatik olarak kilitli gelir. Anahtar yolları
 * `data.` ile başlar (ör. `"data.text"`).
 */
export const TEMPLATE_EDITABLE_FIELDS: Record<string, readonly string[]> = {
  heading: ["data.text"],
  text: ["data.html"],
  image: ["data.url", "data.alt", "data.caption"],
  button: ["data.label", "data.href"],
  hero: ["data.heading", "data.subheading", "data.imageUrl"],
  cta: [
    "data.heading",
    "data.description",
    "data.buttonLabel",
    "data.buttonHref",
    "data.secondaryButtonLabel",
    "data.secondaryButtonHref",
  ],
  "icon-box": ["data.heading", "data.description", "data.href"],
  gallery: ["data.images"],
  video: ["data.provider", "data.url"],
  accordion: ["data.items"],
  tabs: ["data.items"],
  counter: ["data.items"],
  testimonial: ["data.items"],
  "pricing-table": ["data.plans"],
  "latest-posts": ["data.heading", "data.limit"],
  "featured-products": ["data.heading", "data.limit"],
  "featured-portfolio": ["data.heading", "data.limit"],
  "contact-form": ["data.showTitle"],
  "before-after-slider": ["data.beforeUrl", "data.afterUrl", "data.beforeLabel", "data.afterLabel"],
  "logo-marquee": ["data.items"],
  "skill-bar": ["data.items"],
  team: ["data.members"],
  // Saf düzen elemanları — şablon modunda tamamen kilitli.
  divider: [],
  // §3.3 — KESİN istisna: ham HTML yazmak tanım gereği "gelişmiş" bir eylemdir, `data.html`
  // hiçbir koşulda standart kullanıcıya açılmaz.
  "custom-html": [],
  // Konteynerin KENDİSİ içerik alanı taşımaz — `settings` bütünüyle, `children`, `reveal` kilitli
  // (yapısal eşitlik `assertTemplateEditAllowed` içinde AYRICA kontrol edilir).
  container: [],
  // Gelişmiş Slider / Hero Studio — bkz. .claude/architect-scope-advanced-slider.md §3.5.
  // Standart kullanıcı hangi slider'ın gösterileceğini DEĞİŞTİREBİLİR (içerik seçimi), ama
  // slider'ın kendisini düzenleyemez (o /admin/sliders yetkisidir).
  "advanced-slider": ["data.sliderId"],
  // Google Harita — bkz. .claude/architect-scope-google-map-corporate-blocks.md §4.5 (bağlayıcı
  // karar, boş küme AÇIKÇA yazıldı). 3. parti bir iframe kaynağını (`embedUrl`) veya bir adresi
  // belirlemek `custom-html` ile AYNI sınıfta "gelişmiş" bir eylemdir — haritayı standart
  // kullanıcıya açmak, dolaylı olarak ona bir iframe src'si yazma yetkisi verirdi. Fail-closed
  // kural zaten boş küme üretirdi; AÇIKÇA yazılması bunun bir unutkanlık değil karar olduğunu
  // belgeler.
  "google-map": [],
};
