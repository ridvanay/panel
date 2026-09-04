import type { SliderLayer } from "../../sliders/lib/layers";
import type { DemoTemplateDefinition, DemoTemplateProduct, PageNode } from "../types";

/**
 * "Modern Storefront / E-Ticaret" — `.claude/architect-scope-ecommerce-pro-template.md` §9.3/§9.6
 * uyarınca yazılmış ikinci demo şablonu. `modern-architecture.ts` ile AYNI kod deseni (helper
 * builder'lar → const bölümler → nihai obje).
 *
 * Kurgusal mağaza adı **"Ferah Ev Yaşam"** — jenerik, tanımlayıcı, gerçek bir markayla
 * çakışmayan iki genel Türkçe sözcükten oluşur (compliance-agent denetimine tabidir, bkz.
 * `modern-architecture.ts` dosya başındaki "Mimarist Yapı" → "Kütle Yapı" emsali). Kategori/ürün
 * adları da jenerik ve tanımlayıcıdır (§7.1) — gerçek marka/model adı YOKTUR.
 *
 * Bu şablon **ürün/kategori/varyasyon/döküman** verisi YAZAR (§4.1 `commerce`), 4 yasal yer
 * tutucu sayfa üretir (§4.3 `extraPages`) ve **örnek sipariş üretmez** (§4.5 — bu dosyada
 * `order`/`orderItem`/`siteUser` yazan HİÇBİR satır YOKTUR, importer da bunu yazmaz).
 */

const ZERO_SPACING = { top: 0, right: 0, bottom: 0, left: 0 };

// Palet — `.claude/design-notes-ecommerce-storefront.md` §9 ile BİREBİR.
const PRIMARY = "#1E3A8A";
const SECONDARY = "#0F172A";
const BUTTON = "#2563EB";
const ACCENT = "#047857";
const SURFACE = "#FFFFFF";
const BACKGROUND = "#F8FAFC";

/* ---------------------------------------------------------------------------------------------
 * Hero Studio slider katmanları — design-notes §9 paletiyle, `modern-architecture.ts::
 * buildHeroLayers` ile AYNI dört katmanlı kompozisyon (badge/heading/text/button).
 * ------------------------------------------------------------------------------------------- */

function buildHeroLayers(input: { badge: string; heading: string; text: string; buttonLabel: string; buttonHref: string }): SliderLayer[] {
  return [
    {
      id: "badge",
      type: "badge",
      content: { text: input.badge },
      position: { xPercent: 8, yPercent: 60, origin: "bottom-left", offsetX: 0, offsetY: 0 },
      style: {
        color: "#FFFFFF",
        backgroundColor: ACCENT,
        backgroundOpacity: 25,
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
      position: { xPercent: 8, yPercent: 68, origin: "bottom-left", widthPercent: 55, offsetX: 0, offsetY: 0 },
      style: {
        color: "#FFFFFF",
        fontFamily: "heading",
        fontSize: 48,
        fontWeight: 700,
        lineHeight: 1.15,
        textAlign: "left",
        maxWidthPx: 640,
        padding: ZERO_SPACING,
      },
      animation: { inEffect: "fade-up", delayMs: 150, durationMs: 600, easing: "ease-out" },
    },
    {
      id: "text",
      type: "text",
      content: { text: input.text },
      position: { xPercent: 8, yPercent: 81, origin: "bottom-left", widthPercent: 42, offsetX: 0, offsetY: 0 },
      style: { color: "#E2E8F0", fontFamily: "body", fontSize: 16, lineHeight: 1.6, fontWeight: 400, opacity: 92 },
      animation: { inEffect: "fade-up", delayMs: 300, durationMs: 600, easing: "ease-out" },
    },
    {
      id: "button",
      type: "button",
      content: { label: input.buttonLabel, href: input.buttonHref, variant: "solid", size: "lg" },
      position: { xPercent: 8, yPercent: 91, origin: "bottom-left", offsetX: 0, offsetY: 0 },
      style: {
        color: "#FFFFFF",
        backgroundColor: BUTTON,
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

/* ---------------------------------------------------------------------------------------------
 * Sayfa bölümleri — `.claude/architect-scope-ecommerce-pro-template.md` §4.2 kompozisyon
 * eşlemesi (bağlayıcı). "Çok Satanlar" sekmesi KAPSAM DIŞI (§4.6/§8) — YAZILMADI.
 * ------------------------------------------------------------------------------------------- */

// §4.2 — "Öne çıkan kategoriler": container(row) → 4 × container → image(asset:) + heading + button.
function buildCategoryCard(input: { slug: string; name: string; assetKey: string; altText: string }): PageNode {
  return {
    id: `ep-category-${input.slug}`,
    type: "container",
    settings: {
      layout: "full-width",
      direction: "column",
      justifyContent: "start",
      alignItems: "stretch",
      gap: 16,
      padding: ZERO_SPACING,
      margin: ZERO_SPACING,
      background: { type: "none" },
    },
    children: [
      { id: `ep-category-${input.slug}-image`, type: "image", data: { url: `asset:${input.assetKey}`, alt: input.altText, radius: "lg" } },
      { id: `ep-category-${input.slug}-heading`, type: "heading", data: { text: input.name, level: 3, align: "center", underline: false } },
      {
        id: `ep-category-${input.slug}-button`,
        type: "button",
        data: { label: "Keşfet", href: `/products?category=${input.slug}`, style: "outline", size: "sm", align: "center" },
      },
    ],
  };
}

const categoriesSection: PageNode = {
  id: "ep-categories",
  type: "container",
  settings: {
    layout: "boxed",
    direction: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 40,
    padding: { top: 96, right: 24, bottom: 96, left: 24 },
    margin: ZERO_SPACING,
    background: { type: "color", value: SURFACE },
  },
  children: [
    { id: "ep-categories-heading", type: "heading", data: { text: "Öne Çıkan Kategoriler", level: 2, align: "center", underline: false } },
    {
      id: "ep-categories-row",
      type: "container",
      settings: {
        layout: "full-width",
        direction: "row",
        justifyContent: "center",
        alignItems: "stretch",
        gap: 24,
        padding: ZERO_SPACING,
        margin: ZERO_SPACING,
        background: { type: "none" },
      },
      children: [
        buildCategoryCard({
          slug: "aydinlatma",
          name: "Aydınlatma",
          assetKey: "category-aydinlatma",
          altText: "Aydınlatma kategorisi — soyut ışın motifli kapak görseli",
        }),
        buildCategoryCard({
          slug: "oturma-grubu",
          name: "Oturma Grubu",
          assetKey: "category-oturma-grubu",
          altText: "Oturma Grubu kategorisi — soyut eğri çizgi motifli kapak görseli",
        }),
        buildCategoryCard({
          slug: "depolama",
          name: "Depolama",
          assetKey: "category-depolama",
          altText: "Depolama kategorisi — soyut raf/ızgara motifli kapak görseli",
        }),
        buildCategoryCard({
          slug: "aksesuar",
          name: "Aksesuar",
          assetKey: "category-aksesuar",
          altText: "Aksesuar kategorisi — soyut nokta/eşkenar dörtgen motifli kapak görseli",
        }),
      ],
    },
  ],
};

// §4.2 — "Ürün ızgaraları": 2 × featured-products (biri categoryId: ref:product-category:<slug>).
// §8 backlog notu (v1): "Yeni Gelenler" (kategori filtresi YOK) + kategori bazlı ikinci ızgara.
const featuredNewSection: PageNode = {
  id: "ep-featured-new",
  type: "container",
  settings: {
    layout: "boxed",
    direction: "column",
    justifyContent: "center",
    alignItems: "stretch",
    gap: 0,
    padding: { top: 80, right: 24, bottom: 80, left: 24 },
    margin: ZERO_SPACING,
    background: { type: "color", value: BACKGROUND },
  },
  children: [{ id: "ep-featured-new-grid", type: "featured-products", data: { heading: "Yeni Gelenler", limit: 8 } }],
};

const featuredCategorySection: PageNode = {
  id: "ep-featured-category",
  type: "container",
  settings: {
    layout: "boxed",
    direction: "column",
    justifyContent: "center",
    alignItems: "stretch",
    gap: 0,
    padding: { top: 80, right: 24, bottom: 80, left: 24 },
    margin: ZERO_SPACING,
    background: { type: "color", value: SURFACE },
  },
  children: [
    {
      id: "ep-featured-category-grid",
      type: "featured-products",
      data: { heading: "Aydınlatma Koleksiyonu", limit: 8, categoryId: "ref:product-category:aydinlatma" },
    },
  ],
};

// §4.2 — "Güvenlik/kargo rozet barı": container(row) → 4 × icon-box. AÇIK zemin (design-notes'ta
// bulunan `icon-box-block.tsx::text-foreground` bulgusu gereği — bkz. bu dosyanın PR notu: koyu
// zeminde `text-foreground` okunmaz hâle gelirdi, bu yüzden AYNI açık `backgroundColor` kullanılır).
const trustBadgeSection: PageNode = {
  id: "ep-trust-badges",
  type: "container",
  settings: {
    layout: "boxed",
    direction: "row",
    justifyContent: "evenly",
    alignItems: "start",
    gap: 32,
    padding: { top: 64, right: 24, bottom: 64, left: 24 },
    margin: ZERO_SPACING,
    background: { type: "color", value: BACKGROUND },
  },
  children: [
    {
      id: "ep-trust-1",
      type: "icon-box",
      data: { icon: "ShieldCheck", heading: "Güvenli Ödeme", description: "Tüm ödemeler şifrelenmiş bağlantı üzerinden güvenle işlenir." },
    },
    {
      id: "ep-trust-2",
      type: "icon-box",
      data: { icon: "Truck", heading: "Hızlı Kargo", description: "Siparişleriniz özenle paketlenir ve hızlıca kargoya teslim edilir." },
    },
    {
      id: "ep-trust-3",
      type: "icon-box",
      data: { icon: "RotateCcw", heading: "Kolay İade", description: "Beğenmediğiniz ürünleri koşullara uygun şekilde kolayca iade edin." },
    },
    {
      id: "ep-trust-4",
      type: "icon-box",
      data: { icon: "Headphones", heading: "7/24 Destek", description: "Sorularınız için müşteri hizmetleri ekibimiz her zaman yanınızda." },
    },
  ],
};

/* ---------------------------------------------------------------------------------------------
 * §4.3 — Ek (yasal) sayfalar. Gövde YER TUTUCUDUR, gerçek hukuki metin YAZILMAZ (bağlayıcı).
 * ------------------------------------------------------------------------------------------- */

const LEGAL_PLACEHOLDER_NOTICE =
  "<p><strong>Bu metin bir <u>yer tutucudur</u> ve hukuki geçerliliği yoktur. Yayına almadan önce hukuk danışmanınızla birlikte doldurmanız zorunludur.</strong></p>";

function buildLegalPageBlocks(idPrefix: string, sectionHeadings: string[]): PageNode[] {
  return [
    {
      id: `${idPrefix}-body`,
      type: "container",
      settings: {
        layout: "boxed",
        direction: "column",
        justifyContent: "start",
        alignItems: "stretch",
        gap: 24,
        padding: { top: 48, right: 24, bottom: 96, left: 24 },
        margin: ZERO_SPACING,
        background: { type: "color", value: SURFACE },
      },
      children: [
        { id: `${idPrefix}-notice`, type: "text", data: { html: LEGAL_PLACEHOLDER_NOTICE } },
        ...sectionHeadings.map(
          (heading, index): PageNode => ({
            id: `${idPrefix}-section-${index}`,
            type: "heading",
            data: { text: heading, level: 3, align: "left", underline: false },
          })
        ),
      ],
    },
  ];
}

/* ---------------------------------------------------------------------------------------------
 * §4.1 `commerce.products` — 8 ürün (§7.1: jenerik/kurgusal ad, `DEMO-` önekli kurgusal SKU).
 * ------------------------------------------------------------------------------------------- */

const PRODUCTS: DemoTemplateProduct[] = [
  {
    title: "Silindirik Metal Masa Lambası",
    slug: "silindirik-metal-masa-lambasi",
    excerpt: "Yuvarlak gövdeli, sıcak ışıklı masa üstü aydınlatma.",
    descriptionHtml:
      "<p>Silindirik metal gövdesi ve yumuşak ışık dağılımıyla çalışma masası veya başucu için sade bir aydınlatma çözümü. Mat kaplama, parmak izi bırakmaz.</p>",
    priceCents: 89900,
    currency: "TRY",
    discountPriceCents: null,
    sku: "DEMO-AYD-001",
    stockQuantity: 0,
    categorySlug: "aydinlatma",
    coverAssetKey: "silindirik-metal-masa-lambasi-cover",
    galleryAssetKeys: ["silindirik-metal-masa-lambasi-gallery-1"],
    variantOptions: [
      {
        name: "Renk",
        type: "SWATCH",
        values: [
          { value: "Siyah", swatchHex: "#111827" },
          { value: "Bakır", swatchHex: "#B45309" },
        ],
      },
    ],
    variants: [
      {
        optionValues: { Renk: "Siyah" },
        sku: "DEMO-AYD-001-SIY",
        priceCents: null,
        discountPriceCents: null,
        stockQuantity: 18,
        imageAssetKey: null,
        isActive: true,
      },
      {
        optionValues: { Renk: "Bakır" },
        sku: "DEMO-AYD-001-BAK",
        priceCents: null,
        discountPriceCents: null,
        stockQuantity: 2,
        imageAssetKey: null,
        isActive: true,
      },
    ],
    documents: [],
    seoTitle: null,
    seoDescription: null,
    status: "PUBLISHED",
  },
  {
    title: "Ayarlanabilir Lambader",
    slug: "ayarlanabilir-lambader",
    excerpt: "Yüksekliği ve baş açısı ayarlanabilir salon lambaderi.",
    descriptionHtml:
      "<p>Okuma köşeleri ve oturma gruplarının yanında kullanılabilecek, teleskopik gövdeli ve açısı ayarlanabilir başlıklı bir lambader. Geniş taban, dengeli duruş sağlar.</p>",
    priceCents: 149900,
    currency: "TRY",
    discountPriceCents: 129900,
    sku: "DEMO-AYD-002",
    stockQuantity: 24,
    categorySlug: "aydinlatma",
    coverAssetKey: "ayarlanabilir-lambader-cover",
    galleryAssetKeys: ["ayarlanabilir-lambader-gallery-1"],
    variantOptions: [],
    variants: [],
    documents: [{ title: "Montaj ve Kullanım Kılavuzu", assetKey: "tech-doc-1" }],
    seoTitle: null,
    seoDescription: null,
    status: "PUBLISHED",
  },
  {
    title: "Kadife Döşemeli Berjer Koltuk",
    slug: "kadife-dosemeli-berjer-koltuk",
    excerpt: "Yumuşak kadife döşemeli, tekli oturma berjeri.",
    descriptionHtml:
      "<p>Ahşap ayaklı iskelet üzerine kadife döşemeli, tekli oturma alanları için tasarlanmış rahat bir berjer koltuk. Oturma gruplarına karakter katar.</p>",
    priceCents: 349900,
    currency: "TRY",
    discountPriceCents: null,
    sku: "DEMO-OTG-001",
    stockQuantity: 0,
    categorySlug: "oturma-grubu",
    coverAssetKey: "kadife-dosemeli-berjer-koltuk-cover",
    galleryAssetKeys: ["kadife-dosemeli-berjer-koltuk-gallery-1"],
    variantOptions: [
      {
        name: "Renk",
        type: "SWATCH",
        values: [
          { value: "Petrol Mavisi", swatchHex: "#0F766E" },
          { value: "Hardal Sarısı", swatchHex: "#CA8A04" },
          { value: "Antrasit", swatchHex: "#1F2937" },
        ],
      },
    ],
    variants: [
      {
        optionValues: { Renk: "Petrol Mavisi" },
        sku: "DEMO-OTG-001-PET",
        priceCents: null,
        discountPriceCents: null,
        stockQuantity: 12,
        imageAssetKey: null,
        isActive: true,
      },
      {
        optionValues: { Renk: "Hardal Sarısı" },
        sku: "DEMO-OTG-001-HAR",
        priceCents: null,
        discountPriceCents: null,
        stockQuantity: 0,
        imageAssetKey: null,
        isActive: true,
      },
      {
        optionValues: { Renk: "Antrasit" },
        sku: "DEMO-OTG-001-ANT",
        priceCents: null,
        discountPriceCents: null,
        stockQuantity: 6,
        imageAssetKey: null,
        isActive: true,
      },
    ],
    documents: [{ title: "Bakım ve Kullanım Kılavuzu", assetKey: "tech-doc-2" }],
    seoTitle: null,
    seoDescription: null,
    status: "PUBLISHED",
  },
  {
    title: "Katlanabilir Bahçe Sandalyesi",
    slug: "katlanabilir-bahce-sandalyesi",
    excerpt: "Hafif, katlanabilir ve depolaması kolay dış mekan sandalyesi.",
    descriptionHtml:
      "<p>Hava koşullarına dayanıklı yüzeyiyle balkon, teras ve bahçeler için pratik bir oturma çözümü. Katlandığında az yer kaplar.</p>",
    priceCents: 59900,
    currency: "TRY",
    discountPriceCents: 49900,
    sku: "DEMO-OTG-002",
    stockQuantity: 0,
    categorySlug: "oturma-grubu",
    coverAssetKey: "katlanabilir-bahce-sandalyesi-cover",
    galleryAssetKeys: ["katlanabilir-bahce-sandalyesi-gallery-1"],
    variantOptions: [
      {
        name: "Renk",
        type: "SWATCH",
        values: [
          { value: "Beyaz", swatchHex: "#F8FAFC" },
          { value: "Yeşil", swatchHex: "#166534" },
        ],
      },
    ],
    variants: [
      {
        optionValues: { Renk: "Beyaz" },
        sku: "DEMO-OTG-002-BEY",
        priceCents: null,
        discountPriceCents: null,
        stockQuantity: 30,
        imageAssetKey: null,
        isActive: true,
      },
      {
        optionValues: { Renk: "Yeşil" },
        sku: "DEMO-OTG-002-YES",
        priceCents: null,
        discountPriceCents: null,
        stockQuantity: 25,
        imageAssetKey: null,
        isActive: true,
      },
    ],
    documents: [],
    seoTitle: null,
    seoDescription: null,
    status: "PUBLISHED",
  },
  {
    title: "Modüler Raf Sistemi",
    slug: "moduler-raf-sistemi",
    excerpt: "İki ölçek seçeneğiyle duvara monte edilebilen modüler raf.",
    descriptionHtml:
      "<p>Kitap, dekoratif eşya ve depolama kutuları için modüler bir raf sistemi. İki farklı genişlik seçeneğiyle küçük veya geniş duvarlara uyum sağlar.</p>",
    priceCents: 219900,
    currency: "TRY",
    discountPriceCents: null,
    sku: "DEMO-DEP-001",
    stockQuantity: 0,
    categorySlug: "depolama",
    coverAssetKey: "moduler-raf-sistemi-cover",
    galleryAssetKeys: ["moduler-raf-sistemi-gallery-1"],
    variantOptions: [
      {
        name: "Renk",
        type: "SWATCH",
        values: [
          { value: "Ceviz", swatchHex: "#78350F" },
          { value: "Beyaz", swatchHex: "#F8FAFC" },
        ],
      },
      {
        name: "Ölçü",
        type: "TEXT",
        values: [{ value: "120 cm" }, { value: "180 cm" }],
      },
    ],
    variants: [
      {
        optionValues: { Renk: "Ceviz", Ölçü: "120 cm" },
        sku: "DEMO-DEP-001-CEV-120",
        priceCents: null,
        discountPriceCents: null,
        stockQuantity: 20,
        imageAssetKey: null,
        isActive: true,
      },
      {
        optionValues: { Renk: "Ceviz", Ölçü: "180 cm" },
        sku: "DEMO-DEP-001-CEV-180",
        priceCents: 259900,
        discountPriceCents: null,
        stockQuantity: 10,
        imageAssetKey: null,
        isActive: true,
      },
      {
        optionValues: { Renk: "Beyaz", Ölçü: "120 cm" },
        sku: "DEMO-DEP-001-BEY-120",
        priceCents: null,
        discountPriceCents: null,
        stockQuantity: 15,
        imageAssetKey: null,
        isActive: true,
      },
      {
        optionValues: { Renk: "Beyaz", Ölçü: "180 cm" },
        sku: "DEMO-DEP-001-BEY-180",
        priceCents: 259900,
        discountPriceCents: null,
        stockQuantity: 5,
        imageAssetKey: null,
        isActive: true,
      },
    ],
    documents: [{ title: "Montaj Şeması", assetKey: "tech-doc-1" }],
    seoTitle: null,
    seoDescription: null,
    status: "PUBLISHED",
  },
  {
    title: "Ahşap Ayakkabılık Dolabı",
    slug: "ahsap-ayakkabilik-dolabi",
    excerpt: "Antre için kapalı gözlü ahşap ayakkabılık.",
    descriptionHtml:
      "<p>Antre veya koridorlarda düzenli bir görünüm sağlayan, kapalı gözlü ahşap ayakkabılık. Üst yüzeyi anahtarlık/dekoratif obje için de kullanılabilir.</p>",
    priceCents: 179900,
    currency: "TRY",
    discountPriceCents: null,
    sku: "DEMO-DEP-002",
    stockQuantity: 3,
    categorySlug: "depolama",
    coverAssetKey: "ahsap-ayakkabilik-dolabi-cover",
    galleryAssetKeys: ["ahsap-ayakkabilik-dolabi-gallery-1"],
    variantOptions: [],
    variants: [],
    documents: [],
    seoTitle: null,
    seoDescription: null,
    status: "PUBLISHED",
  },
  {
    title: "Desenli Dekoratif Yastık Seti",
    slug: "desenli-dekoratif-yastik-seti",
    excerpt: "Üç renk seçeneğiyle koltuk/kanepe yastık kılıfı.",
    descriptionHtml:
      "<p>Kanepe ve koltuklara renk katan, dokulu kumaştan üretilmiş dekoratif yastık kılıfı. Farklı ton seçenekleriyle mevcut dekorasyona kolayca uyum sağlar.</p>",
    priceCents: 39900,
    currency: "TRY",
    discountPriceCents: 29900,
    sku: "DEMO-AKS-001",
    stockQuantity: 0,
    categorySlug: "aksesuar",
    coverAssetKey: "desenli-dekoratif-yastik-seti-cover",
    galleryAssetKeys: ["desenli-dekoratif-yastik-seti-gallery-1"],
    variantOptions: [
      {
        name: "Renk",
        type: "SWATCH",
        values: [
          { value: "Terrakota", swatchHex: "#C2652D" },
          { value: "Zeytin Yeşili", swatchHex: "#556B2F" },
          { value: "Krem", swatchHex: "#F5F0E6" },
        ],
      },
    ],
    variants: [
      {
        optionValues: { Renk: "Terrakota" },
        sku: "DEMO-AKS-001-TER",
        priceCents: null,
        discountPriceCents: null,
        stockQuantity: 40,
        imageAssetKey: null,
        isActive: true,
      },
      {
        optionValues: { Renk: "Zeytin Yeşili" },
        sku: "DEMO-AKS-001-ZEY",
        priceCents: null,
        discountPriceCents: null,
        stockQuantity: 35,
        imageAssetKey: null,
        isActive: true,
      },
      {
        optionValues: { Renk: "Krem" },
        sku: "DEMO-AKS-001-KRE",
        priceCents: null,
        discountPriceCents: null,
        stockQuantity: 28,
        imageAssetKey: null,
        isActive: true,
      },
    ],
    documents: [],
    seoTitle: null,
    seoDescription: null,
    status: "PUBLISHED",
  },
  {
    title: "Cam Aromaterapi Difüzörü",
    slug: "cam-aromaterapi-difuzoru",
    excerpt: "Sade cam gövdeli ultrasonik aromaterapi difüzörü.",
    descriptionHtml:
      "<p>Sade cam gövdesiyle her odaya uyum sağlayan, sessiz çalışan bir ultrasonik aromaterapi difüzörü. Yumuşak ışık modu ile de kullanılabilir.</p>",
    priceCents: 74900,
    currency: "TRY",
    discountPriceCents: null,
    sku: "DEMO-AKS-002",
    stockQuantity: 16,
    categorySlug: "aksesuar",
    coverAssetKey: "cam-aromaterapi-difuzoru-cover",
    galleryAssetKeys: ["cam-aromaterapi-difuzoru-gallery-1"],
    variantOptions: [],
    variants: [],
    documents: [{ title: "Kullanım Kılavuzu", assetKey: "tech-doc-2" }],
    seoTitle: null,
    seoDescription: null,
    status: "PUBLISHED",
  },
];

/* ---------------------------------------------------------------------------------------------
 * Şablon tanımı
 * ------------------------------------------------------------------------------------------- */

export const ECOMMERCE_PRO_TEMPLATE: DemoTemplateDefinition = {
  key: "ecommerce-pro",
  version: "1.0.0",
  name: "Modern Storefront / E-Ticaret",
  description: "Lacivert + mavi CTA paletli, varyasyonlu ürün ve teknik döküman desteği sunan e-ticaret vitrini.",
  // `modern-architecture.ts`teki AYNI devir-teslim notuyla — WEBP encoder depoda YOK, statik
  // `preview.svg` doğrudan kullanılır (Media boru hattından GEÇMEZ).
  previewImageUrl: "/demo-templates/ecommerce-pro/preview.svg",
  tags: ["e-ticaret", "varyasyon", "döküman yönetimi"],

  // `.claude/design-notes-ecommerce-storefront.md` §11 — kategori kartı arka planları (soyut
  // çizgi motif, GERÇEK ürün fotoğrafı DEĞİL) + 8 ürün kapak/galeri görseli + 2 PDF döküman.
  assets: [
    { key: "category-aydinlatma", file: "category-aydinlatma.png", altText: "Aydınlatma kategorisi — soyut ışın motifli kapak görseli" },
    {
      key: "category-oturma-grubu",
      file: "category-oturma-grubu.png",
      altText: "Oturma Grubu kategorisi — soyut eğri çizgi motifli kapak görseli",
    },
    { key: "category-depolama", file: "category-depolama.png", altText: "Depolama kategorisi — soyut raf/ızgara motifli kapak görseli" },
    {
      key: "category-aksesuar",
      file: "category-aksesuar.png",
      altText: "Aksesuar kategorisi — soyut nokta/eşkenar dörtgen motifli kapak görseli",
    },

    { key: "hero-1", file: "hero-1.jpg", altText: "Ferah Ev Yaşam — modern oturma odası, hero görseli 1" },
    { key: "hero-2", file: "hero-2.jpg", altText: "Ferah Ev Yaşam — sıcak/samimi oturma odası, hero görseli 2" },
    { key: "hero-3", file: "hero-3.jpg", altText: "Ferah Ev Yaşam — nötr tonlarda oturma odası, hero görseli 3" },

    { key: "silindirik-metal-masa-lambasi-cover", file: "silindirik-metal-masa-lambasi-cover.png", altText: "Silindirik Metal Masa Lambası — kapak görseli (soyut yer tutucu)" },
    { key: "silindirik-metal-masa-lambasi-gallery-1", file: "silindirik-metal-masa-lambasi-gallery-1.png", altText: "Silindirik Metal Masa Lambası — galeri görseli 1 (soyut yer tutucu)" },
    { key: "ayarlanabilir-lambader-cover", file: "ayarlanabilir-lambader-cover.png", altText: "Ayarlanabilir Lambader — kapak görseli (soyut yer tutucu)" },
    { key: "ayarlanabilir-lambader-gallery-1", file: "ayarlanabilir-lambader-gallery-1.png", altText: "Ayarlanabilir Lambader — galeri görseli 1 (soyut yer tutucu)" },
    { key: "kadife-dosemeli-berjer-koltuk-cover", file: "kadife-dosemeli-berjer-koltuk-cover.png", altText: "Kadife Döşemeli Berjer Koltuk — kapak görseli (soyut yer tutucu)" },
    { key: "kadife-dosemeli-berjer-koltuk-gallery-1", file: "kadife-dosemeli-berjer-koltuk-gallery-1.png", altText: "Kadife Döşemeli Berjer Koltuk — galeri görseli 1 (soyut yer tutucu)" },
    { key: "katlanabilir-bahce-sandalyesi-cover", file: "katlanabilir-bahce-sandalyesi-cover.png", altText: "Katlanabilir Bahçe Sandalyesi — kapak görseli (soyut yer tutucu)" },
    { key: "katlanabilir-bahce-sandalyesi-gallery-1", file: "katlanabilir-bahce-sandalyesi-gallery-1.png", altText: "Katlanabilir Bahçe Sandalyesi — galeri görseli 1 (soyut yer tutucu)" },
    { key: "moduler-raf-sistemi-cover", file: "moduler-raf-sistemi-cover.png", altText: "Modüler Raf Sistemi — kapak görseli (soyut yer tutucu)" },
    { key: "moduler-raf-sistemi-gallery-1", file: "moduler-raf-sistemi-gallery-1.png", altText: "Modüler Raf Sistemi — galeri görseli 1 (soyut yer tutucu)" },
    { key: "ahsap-ayakkabilik-dolabi-cover", file: "ahsap-ayakkabilik-dolabi-cover.png", altText: "Ahşap Ayakkabılık Dolabı — kapak görseli (soyut yer tutucu)" },
    { key: "ahsap-ayakkabilik-dolabi-gallery-1", file: "ahsap-ayakkabilik-dolabi-gallery-1.png", altText: "Ahşap Ayakkabılık Dolabı — galeri görseli 1 (soyut yer tutucu)" },
    { key: "desenli-dekoratif-yastik-seti-cover", file: "desenli-dekoratif-yastik-seti-cover.png", altText: "Desenli Dekoratif Yastık Seti — kapak görseli (soyut yer tutucu)" },
    { key: "desenli-dekoratif-yastik-seti-gallery-1", file: "desenli-dekoratif-yastik-seti-gallery-1.png", altText: "Desenli Dekoratif Yastık Seti — galeri görseli 1 (soyut yer tutucu)" },
    { key: "cam-aromaterapi-difuzoru-cover", file: "cam-aromaterapi-difuzoru-cover.png", altText: "Cam Aromaterapi Difüzörü — kapak görseli (soyut yer tutucu)" },
    { key: "cam-aromaterapi-difuzoru-gallery-1", file: "cam-aromaterapi-difuzoru-gallery-1.png", altText: "Cam Aromaterapi Difüzörü — galeri görseli 1 (soyut yer tutucu)" },

    // §2.2/§4.1 — `kind: "document"`. Birden fazla ürün AYNI PDF'e referans verebilir
    // (`ProductDocument.@@unique([productId, mediaId])` — ürün BAŞINA benzersiz, global DEĞİL).
    { key: "tech-doc-1", file: "tech-doc-1.pdf", altText: "Örnek teknik döküman — yer tutucu PDF 1", kind: "document" },
    { key: "tech-doc-2", file: "tech-doc-2.pdf", altText: "Örnek teknik döküman — yer tutucu PDF 2", kind: "document" },
  ],

  appearance: {
    presetKey: null,
    primaryColor: PRIMARY,
    secondaryColor: SECONDARY,
    buttonColor: BUTTON,
    buttonTextColor: "#FFFFFF",
    linkColor: BUTTON,
    accentColor: ACCENT,
    backgroundColor: BACKGROUND,
    surfaceColor: SURFACE,
    textColor: SECONDARY,
    mutedTextColor: "#64748B",
    headingFont: "MONTSERRAT",
    bodyFont: "INTER",
    baseFontSize: 16,
    borderRadius: "MD",
    buttonStyle: "SOLID",
    stickyHeaderEnabled: true,
  },

  settings: {
    siteName: "Ferah Ev Yaşam",
    tagline: "Evinize Anlam Katan Tasarımlar",
    headerCtaLabel: "Alışverişe Başla",
    headerCtaHref: "/products",
    footerCopyrightText: "© Ferah Ev Yaşam. Tüm hakları saklıdır.",
  },

  navigation: [
    { label: "Ana Sayfa", href: "/" },
    {
      label: "Ürünler",
      href: "/products",
      children: [
        { label: "Aydınlatma", href: "/products?category=aydinlatma" },
        { label: "Oturma Grubu", href: "/products?category=oturma-grubu" },
        { label: "Depolama", href: "/products?category=depolama" },
        { label: "Aksesuar", href: "/products?category=aksesuar" },
      ],
    },
  ],

  footer: {
    columns: [
      {
        title: "Alışveriş",
        links: [
          { label: "Ana Sayfa", href: "/" },
          { label: "Tüm Ürünler", href: "/products" },
        ],
      },
      {
        title: "Kategoriler",
        links: [
          { label: "Aydınlatma", href: "/products?category=aydinlatma" },
          { label: "Oturma Grubu", href: "/products?category=oturma-grubu" },
          { label: "Depolama", href: "/products?category=depolama" },
          { label: "Aksesuar", href: "/products?category=aksesuar" },
        ],
      },
      {
        title: "Yardım",
        links: [
          { label: "Mesafeli Satış Sözleşmesi", href: "/mesafeli-satis-sozlesmesi" },
          { label: "İptal & İade Koşulları", href: "/iptal-iade-kosullari" },
        ],
      },
      {
        title: "Yasal",
        links: [
          { label: "KVKK Aydınlatma Metni", href: "/kvkk-aydinlatma-metni" },
          { label: "Ön Bilgilendirme Formu", href: "/on-bilgilendirme-formu" },
        ],
      },
    ],
  },

  // §9 madde 5 — var olmayan hesaplara link YOK, gerçek hesaba link BAŞKASININ hesabını tanıtır.
  socialLinks: [],

  // Bu şablon portföy verisi GETİRMİYOR (§4.6 tablosu portföyden söz etmez) — alan yine de
  // ZORUNLU olduğu için boş dizilerle doldurulur.
  portfolio: { categories: [], items: [] },

  slider: {
    name: "Ferah Ev Yaşam Hero",
    slug: "ferah-ev-yasam-hero",
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
        // Kapsam genişletmesi (orkestratör yetkisiyle, modern-architecture.ts §5.2/DESIGN-NOTES.md ile
        // AYNI presedan) — mimari dokümanın eski "hero için görsel YOK, gradient" kararı, gerçek/
        // özgür-lisanslı Unsplash fotoğrafı lehine değiştirildi (bkz. hero-1/2/3.jpg).
        bgType: "image",
        bgAssetKey: "hero-1",
        bgPositionX: 50,
        bgPositionY: 50,
        bgOverlayColor: null,
        bgOverlayOpacity: 0,
        bgGradientFrom: null,
        bgGradientTo: null,
        bgGradientAngle: 0,
        bgKenBurns: true,
        durationMs: null,
        linkHref: null,
        linkNewTab: false,
        layers: buildHeroLayers({
          badge: "Yeni Sezon",
          heading: "Evinize Yeni Bir Karakter Katın",
          text: "Aydınlatmadan oturma grubuna, depolamadan aksesuara; tasarım odaklı ürünlerle mekanınızı yenileyin.",
          buttonLabel: "Koleksiyonu Keşfedin",
          buttonHref: "/products",
        }),
      },
      {
        label: "Hero 2",
        isActive: true,
        bgType: "image",
        bgAssetKey: "hero-2",
        bgPositionX: 50,
        bgPositionY: 50,
        bgOverlayColor: null,
        bgOverlayOpacity: 0,
        bgGradientFrom: null,
        bgGradientTo: null,
        bgGradientAngle: 0,
        bgKenBurns: true,
        durationMs: null,
        linkHref: null,
        linkNewTab: false,
        layers: buildHeroLayers({
          badge: "Kampanya",
          heading: "1.500 TL Üzeri Siparişlerde Kargo Bedava",
          text: "Sepetiniz eşiğe ulaştığında kargo bedeli otomatik olarak sıfırlanır — ekstra kod gerekmez.",
          buttonLabel: "Alışverişe Başla",
          buttonHref: "/products",
        }),
      },
      {
        label: "Hero 3",
        isActive: true,
        bgType: "image",
        bgAssetKey: "hero-3",
        bgPositionX: 50,
        bgPositionY: 50,
        bgOverlayColor: null,
        bgOverlayOpacity: 0,
        bgGradientFrom: null,
        bgGradientTo: null,
        bgGradientAngle: 0,
        bgKenBurns: true,
        durationMs: null,
        linkHref: null,
        linkNewTab: false,
        layers: buildHeroLayers({
          badge: "Öne Çıkan Kategori",
          heading: "Oturma Grubunda Yeni Modeller",
          text: "Kadife dokudan hava koşullarına dayanıklı seçeneklere; her mekana uygun bir oturma çözümü.",
          buttonLabel: "Oturma Grubunu İncele",
          buttonHref: "/products?category=oturma-grubu",
        }),
      },
    ],
  },

  page: {
    title: "Ana Sayfa",
    slug: "anasayfa",
    seoTitle: "Ferah Ev Yaşam | Modern Ev Yaşam Mağazası",
    seoDescription:
      "Ferah Ev Yaşam; aydınlatma, oturma grubu, depolama ve aksesuar kategorilerinde tasarım odaklı ürünler sunan bir e-ticaret vitrinidir.",
    blocks: [
      { id: "ep-hero", type: "advanced-slider", data: { sliderId: "ref:slider" } },
      categoriesSection,
      featuredNewSection,
      featuredCategorySection,
      trustBadgeSection,
    ],
    setAsHomePage: true,
  },

  commerce: {
    // design-notes'daki "1.500 TL ve üzeri ücretsiz kargo" örneğiyle tutarlı (§3.3 — arayüzde
    // gösterilen tutar ile checkout'ta tahsil edilen tutar birebir aynı olmalıdır).
    shippingFlatFeeCents: 4990,
    freeShippingThresholdCents: 150000,
    categories: [
      { name: "Aydınlatma", slug: "aydinlatma" },
      { name: "Oturma Grubu", slug: "oturma-grubu" },
      { name: "Depolama", slug: "depolama" },
      { name: "Aksesuar", slug: "aksesuar" },
    ],
    products: PRODUCTS,
  },

  // §4.3 — 4 yasal yer tutucu sayfa, footer'dan bağlanır (yukarıdaki `footer.columns`).
  extraPages: [
    {
      title: "KVKK Aydınlatma Metni",
      slug: "kvkk-aydinlatma-metni",
      seoTitle: null,
      seoDescription: null,
      isLegalDocument: true,
      blocks: buildLegalPageBlocks("ep-kvkk", ["Veri Sorumlusu", "İşlenen Kişisel Veriler", "İşleme Amaçları", "Veri Sahibinin Hakları"]),
    },
    {
      title: "Mesafeli Satış Sözleşmesi",
      slug: "mesafeli-satis-sozlesmesi",
      seoTitle: null,
      seoDescription: null,
      isLegalDocument: true,
      blocks: buildLegalPageBlocks("ep-mesafeli-satis", ["Taraflar", "Sözleşmenin Konusu", "Cayma Hakkı", "Teslimat ve İfa"]),
    },
    {
      title: "Ön Bilgilendirme Formu",
      slug: "on-bilgilendirme-formu",
      seoTitle: null,
      seoDescription: null,
      isLegalDocument: true,
      blocks: buildLegalPageBlocks("ep-on-bilgilendirme", [
        "Satıcı Bilgileri",
        "Ürün ve Fiyat Bilgisi",
        "Ödeme ve Teslimat",
        "Cayma Hakkının Kullanımı",
      ]),
    },
    {
      title: "İptal & İade Koşulları",
      slug: "iptal-iade-kosullari",
      seoTitle: null,
      seoDescription: null,
      isLegalDocument: true,
      blocks: buildLegalPageBlocks("ep-iptal-iade", ["İptal Koşulları", "İade Süreci", "İade Edilemeyecek Ürünler", "İade Bedelinin İadesi"]),
    },
  ],
};
