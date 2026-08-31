import type { SliderLayer } from "../../sliders/lib/layers";
import type { DemoTemplateDefinition, PageNode } from "../types";

/**
 * "Modern Mimarlık & İnşaat" — ilk demo şablonu.
 *
 * TEK referans kaynağı: `../assets/modern-architecture/DESIGN-NOTES.md` (ui-designer,
 * bağlayıcı). Sayı/hex/px değerleri o dosyadan BİREBİR kopyalanmıştır — bu dosyada rastgele
 * bir tasarım kararı YOKTUR. Bölüm kompozisyonu `.claude/architect-scope-demo-template-import.md`
 * §8 tablosuyla, telif/PII yer tutucuları §9 ile BİREBİR uyumludur (kurgusal firma adı
 * "Kütle Yapı" — compliance-agent §9 madde 4 denetiminde eski adı "Mimarist Yapı"dan değiştirildi,
 * gerekçe: "Mimarist", TMMOB Mimarlar Odası'nın Türkiye'de aktif/tanınan mimarlık dergisiyle
 * aynı sektörde marka karışıklığı riski taşıyordu; e-posta/telefon/adres RFC 2606/atanmamış-
 * santral/jenerik yer tutucular; `socialLinks: []`; gerçek görsel/logo/proje adı YOK).
 */

const HERO_BODY_TEXT =
  "Kütle Yapı; konut, ticari ve endüstriyel projelerde tasarımdan anahtar teslime uzanan bütünsel bir yaklaşım sunar.";

/** DESIGN-NOTES.md §5 "Katman stilleri" — üç slaytta AYNI, yalnızca `content` değişir. */
function buildHeroLayers(input: { badge: string; heading: string; buttonLabel: string; buttonHref: string }): SliderLayer[] {
  return [
    {
      id: "badge",
      type: "badge",
      content: { text: input.badge },
      position: { xPercent: 8, yPercent: 62, origin: "bottom-left", offsetX: 0, offsetY: 0 },
      style: {
        color: "#C9A227",
        backgroundColor: "#C9A227",
        backgroundOpacity: 15,
        fontFamily: "body",
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: 1.5,
        textTransform: "uppercase",
        padding: { top: 8, right: 18, bottom: 8, left: 18 },
        borderRadius: 100,
        shadow: "none",
      },
      animation: { inEffect: "fade-down", delayMs: 0, durationMs: 500, easing: "ease-out" },
    },
    {
      id: "heading",
      type: "heading",
      content: { text: input.heading, level: 1 },
      position: { xPercent: 8, yPercent: 70, origin: "bottom-left", widthPercent: 55, offsetX: 0, offsetY: 0 },
      style: {
        color: "#FFFFFF",
        fontFamily: "heading",
        fontSize: 52,
        fontWeight: 700,
        lineHeight: 1.15,
        textAlign: "left",
        maxWidthPx: 640,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      animation: { inEffect: "fade-up", delayMs: 150, durationMs: 600, easing: "ease-out" },
    },
    {
      id: "text",
      type: "text",
      content: { text: HERO_BODY_TEXT },
      position: { xPercent: 8, yPercent: 83, origin: "bottom-left", widthPercent: 42, offsetX: 0, offsetY: 0 },
      style: { color: "#F6F5F2", fontFamily: "body", fontSize: 17, lineHeight: 1.6, fontWeight: 400, opacity: 90 },
      animation: { inEffect: "fade-up", delayMs: 300, durationMs: 600, easing: "ease-out" },
    },
    {
      id: "button",
      type: "button",
      content: { label: input.buttonLabel, href: input.buttonHref, variant: "solid", size: "lg" },
      position: { xPercent: 8, yPercent: 92, origin: "bottom-left", offsetX: 0, offsetY: 0 },
      style: {
        color: "#FFFFFF",
        backgroundColor: "#1F2124",
        borderRadius: 100,
        padding: { top: 16, right: 32, bottom: 16, left: 32 },
        fontWeight: 600,
        fontSize: 16,
        shadow: "md",
      },
      animation: { inEffect: "fade-up", delayMs: 450, durationMs: 600, easing: "ease-out" },
    },
  ];
}

const ZERO_SPACING = { top: 0, right: 0, bottom: 0, left: 0 };

/* ---------------------------------------------------------------------------------------------
 * Sayfa bölümleri — architect §8 tablosu + DESIGN-NOTES.md §6 (satır-satır uygulama)
 * ------------------------------------------------------------------------------------------- */

// §6.2 — 3'lü hizmet kartları.
// SEO düzeltme: hiyerarşi atlaması — sayfada hero'nun tek `H1`inden (Hero Studio katmanı,
// `buildHeroLayers` → level 1) sonra gelen İLK bölüm bu bölümdü ve doğrudan `icon-box`
// bloklarının sabit `<h3>`sine (`icon-box-block.tsx`) düşüyordu (H1 → H3, H2 YOK). Diğer tüm
// bölümler (`portfolioSection`/`differenceSection`/`contactSection`) kendi `H2` başlıklarını
// taşıyor; bu bölüm de AYNI paterne (dış `column` konteyner → `heading` (level 2) → kartları
// taşıyan iç `row` konteyner — bkz. aşağıdaki `differenceSection`) getirildi. Kart konteynerlerinin
// kendisi ve iç `icon-box` verileri DEĞİŞMEDİ, yalnızca bir üst seviye + başlık eklendi.
const servicesSection: PageNode = {
  id: "ma-services",
  type: "container",
  settings: {
    layout: "boxed",
    direction: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 40,
    padding: { top: 96, right: 24, bottom: 96, left: 24 },
    margin: ZERO_SPACING,
    background: { type: "color", value: "#F6F5F2" },
  },
  children: [
    { id: "ma-services-heading", type: "heading", data: { text: "Hizmetlerimiz", level: 2, align: "center", underline: false } },
    {
      id: "ma-services-row",
      type: "container",
      settings: {
        layout: "full-width",
        direction: "row",
        justifyContent: "center",
        alignItems: "stretch",
        gap: 32,
        padding: ZERO_SPACING,
        margin: ZERO_SPACING,
        background: { type: "none" },
      },
      children: [
        {
          id: "ma-service-1",
          type: "container",
          settings: {
            layout: "full-width",
            direction: "column",
            justifyContent: "start",
            alignItems: "center",
            gap: 16,
            padding: { top: 40, right: 32, bottom: 40, left: 32 },
            margin: ZERO_SPACING,
            background: { type: "color", value: "#FFFFFF" },
            widthFr: 1,
          },
          children: [
            {
              id: "ma-service-1-icon",
              type: "icon-box",
              data: {
                icon: "Compass",
                heading: "Mimari Tasarım",
                description: "Konsept tasarımdan uygulama projesine, mekanın ihtiyaçlarına özel bütünsel bir mimari yaklaşım.",
              },
            },
          ],
        },
        {
          id: "ma-service-2",
          type: "container",
          settings: {
            layout: "full-width",
            direction: "column",
            justifyContent: "start",
            alignItems: "center",
            gap: 16,
            padding: { top: 40, right: 32, bottom: 40, left: 32 },
            margin: ZERO_SPACING,
            background: { type: "color", value: "#EFE6CE" },
            widthFr: 1,
          },
          children: [
            {
              id: "ma-service-2-icon",
              type: "icon-box",
              data: {
                icon: "Wrench",
                heading: "İnşaat & Uygulama",
                description: "Sahada disiplinli süreç yönetimi ve kaliteli işçilikle projeyi eksiksiz hayata geçiriyoruz.",
              },
            },
          ],
        },
        {
          id: "ma-service-3",
          type: "container",
          settings: {
            layout: "full-width",
            direction: "column",
            justifyContent: "start",
            alignItems: "center",
            gap: 16,
            padding: { top: 40, right: 32, bottom: 40, left: 32 },
            margin: ZERO_SPACING,
            background: { type: "color", value: "#FFFFFF" },
            widthFr: 1,
          },
          children: [
            {
              id: "ma-service-3-icon",
              type: "icon-box",
              data: {
                icon: "Target",
                heading: "Proje Yönetimi",
                description: "Bütçe ve takvime bağlı kalarak, tasarımdan teslime tüm süreci uçtan uca yönetiyoruz.",
              },
            },
          ],
        },
      ],
    },
  ],
};

// §6.3 — 4 sütunlu proje portföyü.
const portfolioSection: PageNode = {
  id: "ma-portfolio",
  type: "container",
  settings: {
    layout: "boxed",
    direction: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 40,
    padding: { top: 96, right: 24, bottom: 96, left: 24 },
    margin: ZERO_SPACING,
    background: { type: "color", value: "#FFFFFF" },
  },
  children: [
    { id: "ma-portfolio-heading", type: "heading", data: { text: "Öne Çıkan Projelerimiz", level: 2, align: "center", underline: false } },
    { id: "ma-portfolio-grid", type: "featured-portfolio", data: { limit: 8 } },
    {
      id: "ma-portfolio-button",
      type: "button",
      // SEO düzeltme: portföy listeleme rotası `frontend/src/app/[lang]/(site)/portfolio/page.tsx`dir
      // (`/portfolio`) — `/portfoy` DEĞİL. Yanlış href, importer tarafından üretilen sayfada 404
      // üreten kırık bir iç linkti (navigasyon/footer/CTA'daki AYNI hata için dosyanın diğer
      // `/portfolio` referanslarına bkz.).
      data: { label: "Tüm Projeleri Gör", href: "/portfolio", style: "outline", size: "md", align: "center" },
    },
  ],
};

// §6.4 — "Farkımızla Tanışın" paneli.
const differenceSection: PageNode = {
  id: "ma-difference",
  type: "container",
  settings: {
    layout: "full-width",
    direction: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 56,
    padding: { top: 96, right: 24, bottom: 96, left: 24 },
    margin: ZERO_SPACING,
    background: { type: "color", value: "#EFE6CE" },
    topDivider: { type: "curve", color: "#FFFFFF", height: 100, flip: false },
  },
  children: [
    { id: "ma-difference-heading", type: "heading", data: { text: "Farkımızla Tanışın", level: 2, align: "center", underline: false } },
    {
      id: "ma-difference-row",
      type: "container",
      settings: {
        layout: "full-width",
        direction: "row",
        justifyContent: "center",
        alignItems: "stretch",
        gap: 32,
        padding: ZERO_SPACING,
        margin: ZERO_SPACING,
        background: { type: "none" },
      },
      children: [
        {
          id: "ma-diff-1",
          type: "icon-box",
          data: { icon: "Award", heading: "Kalite Güvencesi", description: "Her projede yüksek kalite standartlarını malzeme seçiminden uygulamaya kadar koruyoruz." },
        },
        {
          id: "ma-diff-2",
          type: "icon-box",
          data: { icon: "Clock", heading: "Zamanında Teslim", description: "Planlanan takvime bağlı kalarak projelerinizi zamanında teslim ediyoruz." },
        },
        {
          id: "ma-diff-3",
          type: "icon-box",
          data: { icon: "Handshake", heading: "Şeffaf İşbirliği", description: "Süreç boyunca açık iletişim ve şeffaf raporlamayla yanınızdayız." },
        },
        {
          id: "ma-diff-4",
          type: "icon-box",
          data: { icon: "ShieldCheck", heading: "Güvenilir Uygulama", description: "Mühendislik standartlarına tam uyumla güvenli ve dayanıklı yapılar üretiyoruz." },
        },
      ],
    },
  ],
};

// §6.5 — Sayaç bandı.
const countersSection: PageNode = {
  id: "ma-counters",
  type: "container",
  settings: {
    layout: "boxed",
    direction: "row",
    justifyContent: "evenly",
    alignItems: "center",
    gap: 32,
    padding: { top: 64, right: 24, bottom: 64, left: 24 },
    margin: ZERO_SPACING,
    background: { type: "color", value: "#F6F5F2" },
  },
  children: [
    {
      id: "ma-counter-block",
      type: "counter",
      data: {
        items: [
          { id: "c1", value: 15, suffix: "+", label: "Yıllık Tecrübe" },
          { id: "c2", value: 120, suffix: "+", label: "Tamamlanan Proje" },
          { id: "c3", value: 45, label: "Uzman Ekip Üyesi" },
          { id: "c4", value: 98, prefix: "%", label: "Müşteri Memnuniyeti" },
        ],
      },
    },
  ],
};

// §6.6 — Koyu CTA banner.
const ctaBannerSection: PageNode = {
  id: "ma-cta-banner",
  type: "container",
  settings: {
    layout: "full-width",
    direction: "column",
    justifyContent: "center",
    alignItems: "start",
    gap: 24,
    padding: { top: 96, right: 48, bottom: 96, left: 48 },
    margin: ZERO_SPACING,
    minHeight: { value: 480, unit: "px" },
    background: {
      type: "image",
      value: "asset:cta-banner",
      position: "center",
      size: "cover",
      repeat: "no-repeat",
      overlay: { color: "#1F2124", opacity: 55 },
    },
  },
  children: [
    {
      id: "ma-cta-banner-cta",
      type: "cta",
      data: {
        style: "soft",
        align: "left",
        heading: "Projenizi Birlikte Hayata Geçirelim",
        description: "Fikir aşamasından anahtar teslime, mimarlık ve inşaat süreçlerinizde yanınızdayız.",
        buttonLabel: "Bize Ulaşın",
        buttonHref: "/",
      },
    },
  ],
};

// §6.7 — Bölünmüş iletişim formu.
const contactSection: PageNode = {
  id: "ma-contact",
  type: "container",
  settings: {
    layout: "full-width",
    direction: "row",
    justifyContent: "start",
    alignItems: "stretch",
    gap: 0,
    padding: ZERO_SPACING,
    margin: ZERO_SPACING,
    background: { type: "none" },
  },
  children: [
    {
      id: "ma-contact-left",
      type: "container",
      settings: {
        layout: "full-width",
        direction: "column",
        justifyContent: "center",
        alignItems: "start",
        gap: 24,
        padding: { top: 96, right: 64, bottom: 96, left: 64 },
        margin: ZERO_SPACING,
        background: { type: "color", value: "#F6F5F2" },
        widthFr: 1,
      },
      children: [
        { id: "ma-contact-heading", type: "heading", data: { text: "Bize Ulaşın", level: 2, align: "left", underline: false } },
        {
          id: "ma-contact-intro",
          type: "text",
          data: { html: "<p>Projeniz hakkında konuşmak için formu doldurun, ekibimiz en kısa sürede size dönüş yapsın.</p>" },
        },
        { id: "ma-contact-form", type: "contact-form", data: { showTitle: false } },
      ],
    },
    {
      id: "ma-contact-right",
      type: "container",
      settings: {
        layout: "full-width",
        direction: "column",
        justifyContent: "center",
        alignItems: "start",
        gap: 24,
        padding: { top: 96, right: 64, bottom: 96, left: 64 },
        margin: ZERO_SPACING,
        background: { type: "color", value: "#EFE6CE" },
        widthFr: 1,
      },
      children: [
        {
          id: "ma-contact-office",
          type: "icon-box",
          data: { icon: "Building2", heading: "Ofisimiz", description: "Örnek Mah. Örnek Cad. No: 1, Kadıköy / İstanbul" },
        },
        { id: "ma-contact-details", type: "text", data: { html: "<p>+90 212 000 00 00</p><p>info@example.com</p>" } },
      ],
    },
  ],
};

// §6.8 — Bülten çubuğu (§8.2 gereği gerçek abonelik YOK, iletişim formuna yönlendiren `cta`).
const newsletterSection: PageNode = {
  id: "ma-newsletter",
  type: "container",
  settings: {
    layout: "boxed",
    direction: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    padding: { top: 64, right: 24, bottom: 64, left: 24 },
    margin: ZERO_SPACING,
    background: { type: "color", value: "#FFFFFF" },
  },
  children: [
    {
      id: "ma-newsletter-cta",
      type: "cta",
      data: {
        style: "plain",
        align: "center",
        heading: "Projenizi Konuşalım",
        description: "Uzman ekibimiz, ihtiyaçlarınızı dinlemek ve size özel bir yol haritası sunmak için hazır.",
        buttonLabel: "İletişim Formuna Git",
        buttonHref: "/",
      },
    },
  ],
};

/* ---------------------------------------------------------------------------------------------
 * Şablon tanımı
 * ------------------------------------------------------------------------------------------- */

export const MODERN_ARCHITECTURE_TEMPLATE: DemoTemplateDefinition = {
  key: "modern-architecture",
  version: "1.0.0",
  name: "Modern Mimarlık & İnşaat",
  description: "Koyu antrasit + krem paletli, geniş boşluklu kurumsal mimarlık/inşaat sitesi.",
  // NOT (backend-agent → devir teslim notu, DESIGN-NOTES.md §8): WEBP encoder bu depoda YOK
  // (sharp/resvg bağımlılığı eklenmez). Görev talimatının açık istisnasıyla (mimari doküman §4.5
  // "yol" kararını DEĞİŞTİRMEDEN) ui-designer'ın bıraktığı `preview.svg` DOĞRUDAN kullanılır —
  // `frontend/public/demo-templates/modern-architecture/preview.svg` statik bir dosyadır, Media
  // boru hattından GEÇMEZ, `mime-detect.ts`in SVG reddi BURAYA UYGULANMAZ (yalnızca
  // kullanıcı-yüklenen/backend-servis-edilen dosyalar için geçerlidir).
  previewImageUrl: "/demo-templates/modern-architecture/preview.svg",
  tags: ["mimarlık", "inşaat", "kurumsal"],

  assets: [
    { key: "portfolio-cover-1", file: "portfolio-cover-1.png", altText: "Kütle Yapı — konut projesi kapak görseli, ikiz kule silueti" },
    { key: "portfolio-cover-2", file: "portfolio-cover-2.png", altText: "Kütle Yapı — ticari proje kapak görseli, kademeli yapı silueti" },
    { key: "portfolio-cover-3", file: "portfolio-cover-3.png", altText: "Kütle Yapı — kurumsal proje kapak görseli, kolonat silueti" },
    { key: "portfolio-cover-4", file: "portfolio-cover-4.png", altText: "Kütle Yapı — karma kullanım proje kapak görseli, yapı kümesi silueti" },
    { key: "cta-banner", file: "cta-banner.png", altText: "Kütle Yapı ofis binası siluet illüstrasyonu, koyu zemin üzerinde altın çizgi motif" },
    // DESIGN-NOTES.md §6 bölüm kompozisyonunda BU varlığı hiçbir bloğa BAĞLAMAZ (yalnızca §7
    // varlık tablosunda tanımlanır) — yine de §4.2 gerekçesiyle (kullanıcının medya
    // kütüphanesinde HER paketlenmiş görseli değiştirebilmesi) `assets[]`'te tutulur ve
    // Faz 1/2'de gerçek bir `Media` satırına dönüştürülür; sayfa ağacında REFERANS EDİLMEZ.
    { key: "about-image", file: "about-image.png", altText: "Kütle Yapı — mimari kat planı çizim illüstrasyonu" },
  ],

  appearance: {
    presetKey: null,
    primaryColor: "#1C4B42",
    secondaryColor: "#1F2124",
    buttonColor: "#1F2124",
    buttonTextColor: "#FFFFFF",
    linkColor: "#1C4B42",
    accentColor: "#C9A227",
    backgroundColor: "#F6F5F2",
    surfaceColor: "#FFFFFF",
    textColor: "#1F2124",
    mutedTextColor: "#6B6F76",
    headingFont: "PLUS_JAKARTA_SANS",
    bodyFont: "INTER",
    baseFontSize: 16,
    borderRadius: "MD",
    buttonStyle: "SOLID",
    stickyHeaderEnabled: true,
  },

  settings: {
    siteName: "Kütle Yapı",
    tagline: "Mimarlık ve İnşaatta Bütünsel Çözümler",
    headerCtaLabel: "Bize Ulaşın",
    headerCtaHref: "/",
    footerCopyrightText: "© Kütle Yapı. Tüm hakları saklıdır.",
  },

  // seo-agent bulgusu: v1'de `DemoTemplateDefinition.page` TEKİL bir sayfadır (§0 — "yeni
  // sayfa-builder yeteneği YOK"), ayrı /hakkimizda, /hizmetlerimiz, /iletisim sayfaları
  // ÜRETİLMEZ. Bu üç etiket zaten anasayfadaki (Hizmetlerimiz/Farkımızla Tanışın/İletişim
  // Formu) bölümlere karşılık geldiği için "/" hedefine yönlendirilir — aksi halde importer
  // sonrası ilk tıklamada 404 üretirlerdi. Ayrı sayfalar istenirse şema genişletmesi
  // architect onayı gerektirir (bkz. backlog notu, DESIGN-NOTES.md).
  navigation: [
    { label: "Ana Sayfa", href: "/" },
    { label: "Hakkımızda", href: "/" },
    { label: "Hizmetlerimiz", href: "/" },
    { label: "Projeler", href: "/portfolio" },
    { label: "İletişim", href: "/" },
  ],

  footer: {
    columns: [
      {
        title: "Kurumsal",
        links: [
          { label: "Hakkımızda", href: "/" },
          { label: "Projelerimiz", href: "/portfolio" },
        ],
      },
      {
        title: "Hizmetler",
        links: [
          { label: "Mimari Tasarım", href: "/" },
          { label: "Proje Yönetimi", href: "/" },
        ],
      },
      {
        title: "İletişim",
        links: [
          { label: "Bize Ulaşın", href: "/" },
          { label: "Randevu Talebi", href: "/" },
        ],
      },
      {
        title: "Kütle Yapı",
        links: [
          { label: "Ana Sayfa", href: "/" },
          { label: "Hakkımızda", href: "/" },
        ],
      },
    ],
  },

  // §9 madde 5 — var olmayan hesaplara link YOK, gerçek hesaba link BAŞKASININ hesabını tanıtır.
  socialLinks: [],

  portfolio: {
    categories: [
      { name: "Konut Projeleri", slug: "konut-projeleri" },
      { name: "Ticari Projeler", slug: "ticari-projeler" },
    ],
    items: [
      {
        title: "Konut Kompleksi Projesi",
        slug: "konut-kompleksi-projesi",
        summary: "Aile yaşamına uygun ferah iç mekanlar ve enerji verimli cephe tasarımı.",
        contentHtml:
          "<p>Bu konut kompleksi projesinde, aile yaşamına uygun ferah iç mekanlar ile enerji verimli bir cephe tasarımını bir araya getirdik. Ortak yeşil alanlar ve doğal ışık, tasarımın merkezinde yer aldı.</p>",
        clientName: null,
        categorySlug: "konut-projeleri",
        coverAssetKey: "portfolio-cover-1",
        galleryAssetKeys: [],
        order: 0,
        status: "PUBLISHED",
      },
      {
        title: "Ticari Ofis Binası",
        slug: "ticari-ofis-binasi",
        summary: "Esnek kat planları ve sürdürülebilir malzeme seçimleriyle verimli bir çalışma ortamı.",
        contentHtml:
          "<p>Modern bir ticari ofis binasında, esnek kat planları ve sürdürülebilir malzeme seçimleriyle çalışanlar için verimli bir çalışma ortamı kurguladık.</p>",
        clientName: null,
        categorySlug: "ticari-projeler",
        coverAssetKey: "portfolio-cover-2",
        galleryAssetKeys: [],
        order: 1,
        status: "PUBLISHED",
      },
      {
        title: "Kurumsal Merkez Binası",
        slug: "kurumsal-merkez-binasi",
        summary: "Kolonlu cephe düzeni ve temsil gücü yüksek giriş holüyle kurumsal kimlik.",
        contentHtml:
          "<p>Kurumsal merkez binası, kolonlu cephe düzeni ve temsil gücü yüksek giriş holüyle markanın kurumsal kimliğini yansıtacak şekilde tasarlandı.</p>",
        clientName: null,
        categorySlug: "ticari-projeler",
        coverAssetKey: "portfolio-cover-3",
        galleryAssetKeys: [],
        order: 2,
        status: "PUBLISHED",
      },
      {
        title: "Karma Kullanım Yapı Kompleksi",
        slug: "karma-kullanim-yapi-kompleksi",
        summary: "Konut, ofis ve perakende birimlerini bir arada barındıran dinamik bir siluet.",
        contentHtml:
          "<p>Konut, ofis ve perakende birimlerini bir arada barındıran bu karma kullanım projesinde, farklı yükseklikteki yapı bloklarıyla dinamik bir siluet oluşturduk.</p>",
        clientName: null,
        categorySlug: "konut-projeleri",
        coverAssetKey: "portfolio-cover-4",
        galleryAssetKeys: [],
        order: 3,
        status: "PUBLISHED",
      },
    ],
  },

  slider: {
    name: "Kütle Yapı Hero",
    slug: "kutle-yapi-hero",
    autoplay: true,
    intervalMs: 6000,
    loop: true,
    pauseOnHover: true,
    transitionEffect: "fade",
    transitionDurationMs: 600,
    heightMode: "aspect-ratio",
    heightPx: null,
    aspectRatioWidth: 16,
    aspectRatioHeight: 9,
    widthMode: "full-width",
    showArrows: true,
    showBullets: true,
    showProgressBar: false,
    navigationTheme: "dark",
    slides: [
      {
        label: "Hero 1",
        isActive: true,
        bgType: "gradient",
        bgAssetKey: null,
        bgPositionX: 50,
        bgPositionY: 50,
        bgOverlayColor: null,
        bgOverlayOpacity: 0,
        bgGradientFrom: "#1C4B42",
        bgGradientTo: "#1F2124",
        bgGradientAngle: 135,
        bgKenBurns: false,
        durationMs: null,
        linkHref: null,
        linkNewTab: false,
        layers: buildHeroLayers({
          badge: "Mimarlık & İnşaat",
          heading: "Mekanı Anlamlı Yapıya Dönüştürüyoruz",
          buttonLabel: "Projelerimizi İnceleyin",
          buttonHref: "/portfolio",
        }),
      },
      {
        label: "Hero 2",
        isActive: true,
        bgType: "gradient",
        bgAssetKey: null,
        bgPositionX: 50,
        bgPositionY: 50,
        bgOverlayColor: null,
        bgOverlayOpacity: 0,
        bgGradientFrom: "#1F2124",
        bgGradientTo: "#1C4B42",
        bgGradientAngle: 225,
        bgKenBurns: false,
        durationMs: null,
        linkHref: null,
        linkNewTab: false,
        layers: buildHeroLayers({
          badge: "Proje Yönetimi",
          heading: "Yapısal Bütünlük, Zamanında Teslim",
          buttonLabel: "Süreci Nasıl Yönetiyoruz?",
          buttonHref: "/",
        }),
      },
      {
        label: "Hero 3",
        isActive: true,
        bgType: "gradient",
        bgAssetKey: null,
        bgPositionX: 50,
        bgPositionY: 50,
        bgOverlayColor: null,
        bgOverlayOpacity: 0,
        bgGradientFrom: "#1C4B42",
        bgGradientTo: "#1F2124",
        bgGradientAngle: 315,
        bgKenBurns: false,
        durationMs: null,
        linkHref: null,
        linkNewTab: false,
        layers: buildHeroLayers({
          badge: "Sürdürülebilir Tasarım",
          heading: "Çağdaş ve Sürdürülebilir Mimari",
          buttonLabel: "Bize Ulaşın",
          buttonHref: "/",
        }),
      },
    ],
  },

  page: {
    title: "Ana Sayfa",
    slug: "anasayfa",
    seoTitle: "Kütle Yapı | Modern Mimarlık & İnşaat",
    seoDescription:
      "Kütle Yapı; konut, ticari ve endüstriyel projelerde tasarımdan anahtar teslime bütünsel çözümler sunan bir mimarlık ve inşaat stüdyosudur.",
    blocks: [
      { id: "ma-hero", type: "advanced-slider", data: { sliderId: "ref:slider" } },
      servicesSection,
      portfolioSection,
      differenceSection,
      countersSection,
      ctaBannerSection,
      contactSection,
      newsletterSection,
    ],
    setAsHomePage: true,
  },
};
