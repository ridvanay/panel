import type { SliderLayer } from "../../sliders/lib/layers";
import { buildSpecialtySlugHrefRefToken } from "../lib/asset-tokens";
import { REQUIRED_DEMO_DOCTOR_BIO_SENTENCE, type DemoTemplateDefinition, type DemoTemplateDoctor, type DemoTemplateSpecialty, type PageNode } from "../types";

/**
 * "Global TeleHealth & Clinic" — üçüncü demo şablonu.
 *
 * BAĞLAYICI karar dokümanı: `.claude/architect-scope-telehealth-template.md` (bundan sonra
 * [TCT]), üst dokümanlar [DTI]/[EPT] ile birlikte. Bu dosya YALNIZCA `telehealth` modülünün
 * (`modules/telehealth/**`, `.claude/architect-scope-telehealth-template.md` §2.2) İÇİNE hiçbir
 * şey yazmaz — `Specialty`/`DoctorProfile`/`DoctorAvailability` VERİSİ üretir; modülün kendisi
 * bu şablondan TAMAMEN BAĞIMSIZ çalışır (§2.2 bağlayıcı sınır).
 *
 * Palet — [TCT] §6.4'ün BAŞLANGIÇ önerisi DEĞİL, `.claude/design-notes-telehealth.md`
 * (ui-designer, WCAG AA doğrulanmış NİHAİ karar) §1.2/Özet tablosu BİREBİR kullanılır:
 * `#0D9488`/`#0284C7` ham değerleri REDDEDİLDİ, `#0F766E`/`#0369A1` ile DEĞİŞTİRİLDİ.
 *
 * Doktor adları **kurgusal**, tanınmış/gerçek bir hekimle ÇAKIŞMAYACAK şekilde jenerik olarak
 * seçilmiştir ([TCT] §7.2 madde 2 — compliance-agent'ın taraması BUNU denetleyecektir, bu
 * yalnızca İLK tarama). `isVerified` DAİMA `false` (madde 1), her `bio`'nun İLK CÜMLESİ
 * `REQUIRED_DEMO_DOCTOR_BIO_SENTENCE`'tır (madde 3) — `assertDemoTemplateCaps` bunu ÇALIŞMA
 * ZAMANINDA zorlar (types.ts). Bu şablon **örnek/sahte randevu üretmez** ([TCT] §3.6 — bu
 * dosyada `appointment` yazan HİÇBİR satır YOKTUR, importer da bunu yazmaz) ve **hiçbir `User`
 * satırı üretmez** (§2.5 — `DoctorProfile.userId` DAİMA `null`).
 */

const ZERO_SPACING = { top: 0, right: 0, bottom: 0, left: 0 };

// `.claude/design-notes-telehealth.md` §1.2/Özet — WCAG AA doğrulanmış NİHAİ hex'ler.
const PRIMARY = "#0F766E"; // teal-700
const SECONDARY = "#0F172A";
const BUTTON = "#0369A1"; // sky-700 — `linkColor` ile AYNI ("tek aksiyon mavisi", §1.2)
const ACCENT = "#0F766E"; // `primaryColor` ile AYNI (mimari tablo zaten eşitlemişti)
const BACKGROUND = "#F8FAFC";
const SURFACE = "#FFFFFF";
const TEXT = "#0F172A";
const MUTED_TEXT = "#64748B";

/* ---------------------------------------------------------------------------------------------
 * Hero Studio slider katmanları — `bgType: GRADIENT` (teal → okyanus mavisi, [TCT] §6.3 madde 2:
 * hero için varlık YOK, sıfır varlık maliyeti). Gradyan uçları design-notes §1.4 ile BİREBİR:
 * `#0F766E → #0369A1`, sol-üst → sağ-alt (CSS `135deg` konvansiyonu).
 * ------------------------------------------------------------------------------------------- */

function buildHeroLayers(): SliderLayer[] {
  return [
    {
      id: "badge",
      type: "badge",
      content: { text: "Görüntülü Sağlık Danışmanlığı" },
      position: { xPercent: 8, yPercent: 50, origin: "bottom-left", offsetX: 0, offsetY: 0 },
      style: {
        color: "#FFFFFF",
        backgroundColor: "#FFFFFF",
        backgroundOpacity: 20,
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
      responsive: {
        tablet: { position: { yPercent: 24 } },
        mobile: { position: { yPercent: 26 }, style: { fontSize: 11, padding: { top: 6, right: 14, bottom: 6, left: 14 } } },
      },
    },
    {
      id: "heading",
      type: "heading",
      content: { text: "Uzman Doktorlarla Görüntülü Görüşün", level: 1 },
      position: { xPercent: 8, yPercent: 68, origin: "bottom-left", widthPercent: 55, offsetX: 0, offsetY: 0 },
      style: {
        color: "#FFFFFF",
        fontFamily: "heading",
        fontSize: 46,
        fontWeight: 700,
        lineHeight: 1.15,
        textAlign: "left",
        maxWidthPx: 640,
        padding: ZERO_SPACING,
      },
      animation: { inEffect: "fade-up", delayMs: 150, durationMs: 600, easing: "ease-out" },
      responsive: {
        tablet: { position: { yPercent: 50, widthPercent: 82 }, style: { fontSize: 34, maxWidthPx: 960 } },
        mobile: { position: { yPercent: 54, widthPercent: 92 }, style: { fontSize: 26, lineHeight: 1.1, maxWidthPx: 960 } },
      },
    },
    {
      id: "text",
      type: "text",
      content: {
        text: "Randevunuzu birkaç tıkla alın, doktorunuzla güvenli bir görüntülü görüşmede buluşun — evinizden çıkmadan.",
      },
      position: { xPercent: 8, yPercent: 81, origin: "bottom-left", widthPercent: 42, offsetX: 0, offsetY: 0 },
      style: { color: "#E2E8F0", fontFamily: "body", fontSize: 16, lineHeight: 1.6, fontWeight: 400, opacity: 92 },
      animation: { inEffect: "fade-up", delayMs: 300, durationMs: 600, easing: "ease-out" },
      responsive: {
        tablet: { position: { yPercent: 68, widthPercent: 70 } },
        mobile: { position: { yPercent: 74, widthPercent: 90 }, style: { fontSize: 12, lineHeight: 1.4 } },
      },
    },
    {
      id: "button",
      type: "button",
      content: { label: "Doktorları Keşfet", href: "/doctors", variant: "solid", size: "lg" },
      position: { xPercent: 8, yPercent: 95, origin: "bottom-left", offsetX: 0, offsetY: 0 },
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
      responsive: {
        tablet: { position: { yPercent: 86 } },
        mobile: { position: { yPercent: 90 }, style: { fontSize: 13, padding: { top: 8, right: 20, bottom: 8, left: 20 } } },
      },
    },
  ];
}

/* ---------------------------------------------------------------------------------------------
 * [TCT] §7.4/§6.6 — tele-sağlığa özgü, ZORUNLU acil durum uyarısı. Hem ana sayfada (burada,
 * hero'nun hemen altında) hem her yasal yer tutucu sayfada (aşağıda `buildLegalPageBlocks`)
 * TEKRAR EDER. Doktor detay sayfasındaki (`/doctors/[slug]`) tekrar frontend-agent'ın sitewide
 * banner bileşenine aittir (`.claude/design-notes-telehealth.md` §9.1) — demo-templates bu
 * sayfayı ÜRETMEZ (§2.2 bağlayıcı sınır, bu şablon `telehealth` modülünün rota/bileşenlerine
 * dokunmaz).
 * ------------------------------------------------------------------------------------------- */

const EMERGENCY_WARNING_HTML =
  "<p><strong>Bu platform acil tıbbi durumlar için KULLANILAMAZ. Acil durumda 112'yi arayın.</strong></p>";

const emergencyWarningSection: PageNode = {
  id: "th-emergency-warning",
  type: "container",
  settings: {
    layout: "boxed",
    direction: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    padding: { top: 20, right: 24, bottom: 20, left: 24 },
    margin: ZERO_SPACING,
    background: { type: "color", value: "#FEF3C7" },
  },
  children: [{ id: "th-emergency-warning-text", type: "text", data: { html: EMERGENCY_WARNING_HTML } }],
};

/* ---------------------------------------------------------------------------------------------
 * Sayfa bölümleri — [TCT] §6.5 kompozisyon tablosu, MEVCUT bloklarla (yeni blok tipi YOK).
 * ------------------------------------------------------------------------------------------- */

// §6.5 satır 3 — Güven bandı: container(row) → 3 × icon-box.
const trustBandSection: PageNode = {
  id: "th-trust-band",
  type: "container",
  settings: {
    layout: "boxed",
    direction: "row",
    justifyContent: "evenly",
    alignItems: "start",
    gap: 32,
    padding: { top: 64, right: 24, bottom: 64, left: 24 },
    margin: ZERO_SPACING,
    // `.claude/design-notes-telehealth.md` §10 — "7/24 erişim" motifi, neredeyse düz zemin
    // üzerinde ince bir iz bırakacak şekilde ağır beyaz overlay ile kullanılır (`ecommerce-pro`
    // kategori kartlarındaki "%15-25 opaklık ince motif" felsefesiyle AYNI, [DTI] §4.4 emsali).
    background: { type: "image", value: "asset:support-access", position: "center", size: "cover", repeat: "no-repeat", overlay: { color: SURFACE, opacity: 88 } },
  },
  children: [
    {
      id: "th-trust-1",
      type: "icon-box",
      data: { icon: "Clock", heading: "7/24 Erişim", description: "İstediğiniz saatte müsait bir doktor bulup randevu oluşturabilirsiniz." },
    },
    {
      id: "th-trust-2",
      type: "icon-box",
      data: { icon: "ShieldCheck", heading: "Şifreli Görüşme", description: "Görüntülü konsültasyonlar uçtan uca şifreli bağlantı üzerinden yapılır." },
    },
    {
      id: "th-trust-3",
      type: "icon-box",
      data: { icon: "BadgeCheck", heading: "Doğrulanmış Profiller", description: "Yayına alınan gerçek doktor profilleri kimlik/diploma doğrulamasından geçer." },
    },
  ],
};

// §6.5 satır 4 — Uzmanlık ızgarası (6): container(row) → 6 × icon-box, href: ref:specialty-slug:<slug>.
const SPECIALTIES: DemoTemplateSpecialty[] = [
  { name: "Kardiyoloji", slug: "kardiyoloji", icon: "HeartPulse", description: "Kalp ve damar sağlığı üzerine görüntülü danışmanlık.", order: 0 },
  { name: "Dermatoloji", slug: "dermatoloji", icon: "Sparkles", description: "Cilt, saç ve tırnak sağlığı üzerine görüntülü danışmanlık.", order: 1 },
  { name: "Nöroloji", slug: "noroloji", icon: "Brain", description: "Sinir sistemi sağlığı üzerine görüntülü danışmanlık.", order: 2 },
  { name: "Psikiyatri", slug: "psikiyatri", icon: "BrainCog", description: "Ruh sağlığı üzerine görüntülü danışmanlık.", order: 3 },
  { name: "Aile Hekimliği", slug: "aile-hekimligi", icon: "Users", description: "Genel sağlık takibi üzerine görüntülü danışmanlık.", order: 4 },
  { name: "Çocuk Sağlığı", slug: "cocuk-sagligi", icon: "Baby", description: "Çocuk sağlığı ve gelişimi üzerine görüntülü danışmanlık.", order: 5 },
];

const specialtyGridSection: PageNode = {
  id: "th-specialty-grid",
  type: "container",
  settings: {
    layout: "boxed",
    direction: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 40,
    padding: { top: 96, right: 24, bottom: 96, left: 24 },
    margin: ZERO_SPACING,
    background: { type: "color", value: BACKGROUND },
  },
  children: [
    { id: "th-specialty-grid-heading", type: "heading", data: { text: "Branşlar", level: 2, align: "center", underline: false } },
    {
      id: "th-specialty-grid-row",
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
      children: SPECIALTIES.map(
        (specialty): PageNode => ({
          id: `th-specialty-${specialty.slug}`,
          type: "icon-box",
          data: {
            icon: specialty.icon,
            heading: specialty.name,
            description: specialty.description ?? "",
            href: buildSpecialtySlugHrefRefToken(specialty.slug),
          },
        })
      ),
    },
  ],
};

// §6.5 satır 5 — "Nasıl çalışır?" (3 adım): container → heading + 3 × icon-box.
const howItWorksSection: PageNode = {
  id: "th-how-it-works",
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
    { id: "th-how-it-works-heading", type: "heading", data: { text: "Nasıl Çalışır?", level: 2, align: "center", underline: false } },
    {
      id: "th-how-it-works-row",
      type: "container",
      settings: {
        layout: "full-width",
        direction: "row",
        justifyContent: "center",
        alignItems: "start",
        gap: 32,
        padding: ZERO_SPACING,
        margin: ZERO_SPACING,
        background: { type: "none" },
      },
      children: [
        {
          id: "th-how-1",
          type: "icon-box",
          data: { icon: "UserSearch", heading: "1. Doktorunuzu Seçin", description: "Branş veya dile göre filtreleyerek size uygun doktoru bulun." },
        },
        {
          id: "th-how-2",
          type: "icon-box",
          data: { icon: "CalendarCheck", heading: "2. Uygun Saati Seçin", description: "Doktorun müsaitlik takviminden size uygun bir randevu saati seçin." },
        },
        {
          id: "th-how-3",
          type: "icon-box",
          data: { icon: "Video", heading: "3. Görüşmeye Katılın", description: "Randevu saatinde bağlantıya tıklayın, görüntülü görüşmeye başlayın." },
        },
      ],
    },
  ],
};

// §6.5 satır 6 — Öne çıkan doktorlar: container(row) → 4 × (image + heading + text) — STATİK
// ([TCT] §5.3 — dinamik `featured-doctors` bloğu İCAT EDİLMEZ), tek bir CTA `/doctors`e yönlendirir.
function buildDoctorCard(doctor: DemoTemplateDoctor): PageNode {
  return {
    id: `th-doctor-card-${doctor.slug}`,
    type: "container",
    settings: {
      layout: "full-width",
      direction: "column",
      justifyContent: "start",
      alignItems: "center",
      gap: 12,
      padding: ZERO_SPACING,
      margin: ZERO_SPACING,
      background: { type: "none" },
    },
    children: [
      {
        id: `th-doctor-card-${doctor.slug}-image`,
        type: "image",
        data: { url: `asset:${doctor.avatarAssetKey}`, alt: `${doctor.title} ${doctor.fullName} — monogram avatarı (yer tutucu)`, radius: "full" },
      },
      { id: `th-doctor-card-${doctor.slug}-heading`, type: "heading", data: { text: `${doctor.title} ${doctor.fullName}`, level: 4, align: "center", underline: false } },
      { id: `th-doctor-card-${doctor.slug}-text`, type: "text", data: { html: `<p style="text-align:center">${SPECIALTIES.find((s) => s.slug === doctor.specialtySlug)?.name ?? ""}</p>` } },
    ],
  };
}

function buildFeaturedDoctorsSection(doctors: DemoTemplateDoctor[]): PageNode {
  return {
    id: "th-featured-doctors",
    type: "container",
    settings: {
      layout: "boxed",
      direction: "column",
      justifyContent: "center",
      alignItems: "center",
      gap: 40,
      padding: { top: 96, right: 24, bottom: 64, left: 24 },
      margin: ZERO_SPACING,
      background: { type: "color", value: BACKGROUND },
    },
    children: [
      { id: "th-featured-doctors-heading", type: "heading", data: { text: "Öne Çıkan Doktorlar", level: 2, align: "center", underline: false } },
      {
        id: "th-featured-doctors-row",
        type: "container",
        settings: {
          layout: "full-width",
          direction: "row",
          justifyContent: "center",
          alignItems: "start",
          gap: 24,
          padding: ZERO_SPACING,
          margin: ZERO_SPACING,
          background: { type: "none" },
        },
        children: doctors.map((doctor) => buildDoctorCard(doctor)),
      },
      {
        id: "th-featured-doctors-cta",
        type: "button",
        data: { label: "Tüm Doktorları Gör", href: "/doctors", style: "outline", size: "md", align: "center" },
      },
    ],
  };
}

// §6.5 satır 7 — Sayaç bandı. DEĞERLER şablonun KENDİ verisinden doğrulanabilir olmalıdır
// (§6.5 son paragraf/§7.4) — "10.000+ hasta" gibi doğrulanamayan bir başarı iddiası YASAKTIR.
// Bu yüzden mimari dokümanın örnek listesindeki "ortalama yanıt süresi" (hiçbir kaynağı olmayan
// bir sayı olurdu) BİLİNÇLİ OLARAK kullanılmaz; yerine "standart seans süresi" (doğrudan
// `DoctorProfile.sessionDurationMin`'den okunabilir, tüm doktorlarda aynı) kullanılır.
function buildCounterSection(input: { doctorCount: number; specialtyCount: number; languageCount: number; sessionDurationMin: number }): PageNode {
  return {
    id: "th-counters",
    type: "counter",
    data: {
      items: [
        { id: "th-counter-doctors", value: input.doctorCount, label: "Uzman Doktor" },
        { id: "th-counter-specialties", value: input.specialtyCount, label: "Uzmanlık Alanı" },
        { id: "th-counter-languages", value: input.languageCount, label: "Desteklenen Dil" },
        { id: "th-counter-duration", value: input.sessionDurationMin, suffix: " dk", label: "Standart Seans Süresi" },
      ],
    },
  };
}

// §6.5 satır 8 — SSS/güven CTA: container (koyu) → cta.
const ctaSection: PageNode = {
  id: "th-cta",
  type: "container",
  settings: {
    layout: "full-width",
    direction: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 24,
    padding: { top: 96, right: 24, bottom: 96, left: 24 },
    margin: ZERO_SPACING,
    // "Şifreli görüşme" motifi, koyu zemin üzerinde ağır overlay ile — `modern-architecture`
    // `cta-banner`iyle AYNI desen (§10, [DTI] §4.4 emsali).
    background: { type: "image", value: "asset:support-security", position: "center", size: "cover", repeat: "no-repeat", overlay: { color: SECONDARY, opacity: 85 } },
  },
  children: [
    {
      id: "th-cta-block",
      type: "cta",
      data: {
        style: "soft",
        align: "center",
        heading: "Sağlığınız İçin Bir Sonraki Adım",
        description: "Uygun bir uzman ve zaman aralığı seçerek görüntülü randevunuzu birkaç dakikada oluşturun.",
        buttonLabel: "Randevu Al",
        buttonHref: "/doctors",
      },
    },
  ],
};

// §6.5 satır 9 — İletişim: contact-form (mevcut singleton).
const contactSection: PageNode = {
  id: "th-contact",
  type: "container",
  settings: {
    layout: "boxed",
    direction: "column",
    justifyContent: "center",
    alignItems: "stretch",
    gap: 0,
    padding: { top: 96, right: 24, bottom: 96, left: 24 },
    margin: ZERO_SPACING,
    background: { type: "color", value: SURFACE },
  },
  children: [{ id: "th-contact-form", type: "contact-form", data: { showTitle: true } }],
};

/* ---------------------------------------------------------------------------------------------
 * [TCT] §6.6 — Ek (yasal) sayfalar. Gövde YER TUTUCUDUR, gerçek hukuki metin YAZILMAZ
 * (bağlayıcı, [EPT] §4.3 ZORUNLU ilk cümlesi). Sağlığa özgü acil durum uyarısı HER sayfada
 * tekrar eder (§7.4).
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
        { id: `${idPrefix}-emergency`, type: "text", data: { html: EMERGENCY_WARNING_HTML } },
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
 * [TCT] §7.2 — 4 demo doktor, FARKLI saat dilimlerinde. Adlar kurgusal/jenerik (madde 2).
 * `isVerified: false` (madde 1, tip düzeyinde literal). `bio`'nun İLK CÜMLESİ ZORUNLU
 * (madde 3) — `REQUIRED_DEMO_DOCTOR_BIO_SENTENCE` ile başlar, `assertDemoTemplateCaps` bunu
 * ÇALIŞMA ZAMANINDA zorlar. Müsaitlik: Pzt-Cuma 09:00-17:00 (kendi saat diliminde duvar saati,
 * §3.4 — TEK geniş pencere/gün, saatlerce ayrı satır ÜRETİLMEZ) → 5 satır/doktor, `MAX_TEMPLATE_
 * DOCTOR_AVAILABILITY = 21` tavanının ÇOK altında.
 * ------------------------------------------------------------------------------------------- */

const WEEKDAY_09_17 = [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek: dayOfWeek as 1 | 2 | 3 | 4 | 5, startMinute: 540, endMinute: 1020 }));

const DOCTORS: DemoTemplateDoctor[] = [
  {
    title: "Dr.",
    fullName: "Elif Aydemir",
    slug: "elif-aydemir",
    bio: `${REQUIRED_DEMO_DOCTOR_BIO_SENTENCE} Görüntülü görüşme yoluyla hastalarına kardiyoloji alanında danışmanlık hizmeti sunar.`,
    languages: ["tr", "en"],
    timeZone: "Europe/Istanbul",
    specialtySlug: "kardiyoloji",
    sessionDurationMin: 30,
    sessionPriceCents: 45000,
    currency: "TRY",
    avatarAssetKey: "avatar-elif-aydemir",
    order: 0,
    isVerified: false,
    availability: WEEKDAY_09_17,
  },
  {
    title: "Dr.",
    fullName: "James Whitfield",
    slug: "james-whitfield",
    bio: `${REQUIRED_DEMO_DOCTOR_BIO_SENTENCE} Görüntülü görüşme yoluyla hastalarına dermatoloji alanında danışmanlık hizmeti sunar.`,
    languages: ["en"],
    timeZone: "Europe/London",
    specialtySlug: "dermatoloji",
    sessionDurationMin: 30,
    sessionPriceCents: 45000,
    currency: "TRY",
    avatarAssetKey: "avatar-james-whitfield",
    order: 1,
    isVerified: false,
    availability: WEEKDAY_09_17,
  },
  {
    title: "Dr.",
    fullName: "Laura Bennett",
    slug: "laura-bennett",
    bio: `${REQUIRED_DEMO_DOCTOR_BIO_SENTENCE} Görüntülü görüşme yoluyla hastalarına nöroloji alanında danışmanlık hizmeti sunar.`,
    languages: ["en", "es"],
    timeZone: "America/New_York",
    specialtySlug: "noroloji",
    sessionDurationMin: 30,
    sessionPriceCents: 45000,
    currency: "TRY",
    avatarAssetKey: "avatar-laura-bennett",
    order: 2,
    isVerified: false,
    availability: WEEKDAY_09_17,
  },
  {
    title: "Dr.",
    fullName: "Felix Braun",
    slug: "felix-braun",
    bio: `${REQUIRED_DEMO_DOCTOR_BIO_SENTENCE} Görüntülü görüşme yoluyla hastalarına psikiyatri alanında danışmanlık hizmeti sunar.`,
    languages: ["de", "en"],
    timeZone: "Europe/Berlin",
    specialtySlug: "psikiyatri",
    sessionDurationMin: 30,
    sessionPriceCents: 45000,
    currency: "TRY",
    avatarAssetKey: "avatar-felix-braun",
    order: 3,
    isVerified: false,
    availability: WEEKDAY_09_17,
  },
];

// Diller birleşimi — sayaç bandındaki "Desteklenen Dil" değerinin KAYNAĞI (§6.5 son paragraf,
// doğrulanabilir olmalı): {tr, en, es, de} = 4.
const DISTINCT_LANGUAGE_COUNT = new Set(DOCTORS.flatMap((doctor) => doctor.languages)).size;

/* ---------------------------------------------------------------------------------------------
 * Şablon tanımı
 * ------------------------------------------------------------------------------------------- */

export const TELEHEALTH_CLINIC_TEMPLATE: DemoTemplateDefinition = {
  key: "telehealth-clinic",
  version: "1.0.0",
  name: "Global TeleHealth & Clinic",
  description: "Teal + okyanus mavisi paletli, çoklu saat dilimi duyarlı doktor takvimi sunan tele-sağlık / online klinik vitrini.",
  // [TCT] §6.3 — mevcut iki şablonla AYNI uygulama: statik `preview.svg`, `Media` boru
  // hattından GEÇMEZ.
  previewImageUrl: "/demo-templates/telehealth-clinic/preview.svg",
  tags: ["telehealth", "doktor", "canlı-görüşme", "randevu"],

  requiredModules: ["telehealth"],

  // [TCT] §6.3 — 4 doktor avatar monogramı (512×512, fotogerçekçi/AI insan görseli YASAK) + 2
  // destekleyici görsel (1200×900, soyut/geometrik). Hero için varlık YOK (`bgType: GRADIENT`).
  assets: [
    { key: "avatar-elif-aydemir", file: "avatar-elif-aydemir.png", altText: "Dr. Elif Aydemir — soyut monogram avatarı (yer tutucu, gerçek fotoğraf DEĞİL)" },
    { key: "avatar-james-whitfield", file: "avatar-james-whitfield.png", altText: "Dr. James Whitfield — soyut monogram avatarı (yer tutucu, gerçek fotoğraf DEĞİL)" },
    { key: "avatar-laura-bennett", file: "avatar-laura-bennett.png", altText: "Dr. Laura Bennett — soyut monogram avatarı (yer tutucu, gerçek fotoğraf DEĞİL)" },
    { key: "avatar-felix-braun", file: "avatar-felix-braun.png", altText: "Dr. Felix Braun — soyut monogram avatarı (yer tutucu, gerçek fotoğraf DEĞİL)" },
    { key: "support-access", file: "support-access.png", altText: "7/24 erişim — soyut saat kadranı motifli destekleyici görsel" },
    { key: "support-security", file: "support-security.png", altText: "Şifreli görüşme — soyut kilit/kalkan motifli destekleyici görsel" },
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
    textColor: TEXT,
    mutedTextColor: MUTED_TEXT,
    headingFont: "PLUS_JAKARTA_SANS",
    bodyFont: "INTER",
    baseFontSize: 16,
    borderRadius: "LG",
    buttonStyle: "SOLID",
    stickyHeaderEnabled: true,
  },

  settings: {
    siteName: "Global TeleHealth",
    tagline: "Evinizden Uzman Doktorlara Görüntülü Erişim",
    headerCtaLabel: "Randevu Al",
    headerCtaHref: "/doctors",
    footerCopyrightText: "© Global TeleHealth. Tüm hakları saklıdır.",
  },

  navigation: [
    { label: "Ana Sayfa", href: "/" },
    { label: "Doktorlar", href: "/doctors" },
    {
      label: "Branşlar",
      href: "/doctors",
      children: SPECIALTIES.map((specialty) => ({ label: specialty.name, href: `/doctors?specialty=${specialty.slug}` })),
    },
    // Anchor tabanlı bir href (`/#nasil-calisir`) BİLEREK kullanılmaz — page-builder bloklarının
    // `id` alanının HTML `id` attribute'una BİREBİR yansıdığı garanti DEĞİLDİR (bu şablonun
    // sorumluluğu değil, page-builder render katmanının kararıdır); ana sayfa zaten "Nasıl
    // Çalışır?" bölümünü İÇERİR (§6.5 satır 5).
    { label: "Nasıl Çalışır?", href: "/" },
  ],

  footer: {
    columns: [
      {
        title: "Platform",
        links: [
          { label: "Ana Sayfa", href: "/" },
          { label: "Doktorlar", href: "/doctors" },
        ],
      },
      {
        title: "Branşlar",
        links: SPECIALTIES.slice(0, 4).map((specialty) => ({ label: specialty.name, href: `/doctors?specialty=${specialty.slug}` })),
      },
      {
        title: "Yasal",
        links: [
          { label: "KVKK Aydınlatma Metni", href: "/kvkk-aydinlatma-metni" },
          { label: "Açık Rıza Metni", href: "/acik-riza-metni" },
          { label: "Kullanım Koşulları", href: "/kullanim-kosullari" },
          { label: "Mesafeli Hizmet Sözleşmesi", href: "/mesafeli-hizmet-sozlesmesi" },
        ],
      },
    ],
  },

  // [TCT] §9.5/[DTI] §9.5 — var olmayan/gerçek hesaba link YOK.
  socialLinks: [],

  // Bu şablon portföy verisi GETİRMİYOR — alan yine de ZORUNLU olduğu için boş dizilerle doldurulur.
  portfolio: { categories: [], items: [] },

  slider: {
    name: "Global TeleHealth Hero",
    slug: "global-telehealth-hero",
    autoplay: false,
    intervalMs: 6000,
    loop: true,
    pauseOnHover: true,
    transitionEffect: "fade",
    transitionDurationMs: 600,
    heightMode: "aspect-ratio",
    heightPx: null,
    aspectRatioWidth: 16,
    aspectRatioHeight: 9,
    mobileHeightMode: "aspect-ratio",
    mobileHeightPx: null,
    mobileAspectRatioWidth: 4,
    mobileAspectRatioHeight: 5,
    widthMode: "full-width",
    showArrows: false,
    showBullets: true,
    showProgressBar: false,
    navigationTheme: "dark",
    slides: [
      {
        label: "Hero",
        isActive: true,
        // [TCT] §6.3 madde 2 — hero için varlık YOK, sıfır varlık maliyeti + LCP kazancı.
        // Gradyan uçları design-notes §1.4 ile BİREBİR: `#0F766E → #0369A1`.
        bgType: "gradient",
        bgAssetKey: null,
        bgPositionX: 50,
        bgPositionY: 50,
        bgOverlayColor: null,
        bgOverlayOpacity: 0,
        bgGradientFrom: PRIMARY,
        bgGradientTo: BUTTON,
        bgGradientAngle: 135,
        bgKenBurns: false,
        durationMs: null,
        linkHref: null,
        linkNewTab: false,
        layers: buildHeroLayers(),
      },
    ],
  },

  page: {
    title: "Ana Sayfa",
    slug: "anasayfa",
    seoTitle: "Global TeleHealth | Görüntülü Doktor Randevusu",
    seoDescription:
      "Global TeleHealth; kardiyoloji, dermatoloji, nöroloji, psikiyatri, aile hekimliği ve çocuk sağlığı branşlarında görüntülü doktor randevusu sunan bir tele-sağlık platformudur.",
    blocks: [
      { id: "th-hero", type: "advanced-slider", data: { sliderId: "ref:slider" } },
      emergencyWarningSection,
      trustBandSection,
      specialtyGridSection,
      howItWorksSection,
      buildFeaturedDoctorsSection(DOCTORS),
      buildCounterSection({
        doctorCount: DOCTORS.length,
        specialtyCount: SPECIALTIES.length,
        languageCount: DISTINCT_LANGUAGE_COUNT,
        sessionDurationMin: DOCTORS[0]!.sessionDurationMin,
      }),
      ctaSection,
      contactSection,
    ],
    setAsHomePage: true,
  },

  // Bu şablon ticaret verisi GETİRMİYOR — `commerce: null` importer'da hiçbir yeni satır YAZMAZ.
  commerce: null,

  // [TCT] §6.6 — 4 yasal yer tutucu sayfa (sağlık hizmetine özgü "Açık Rıza Metni" dahil),
  // footer'dan bağlanır (yukarıdaki `footer.columns`). Her biri EMERGENCY_WARNING_HTML tekrarlar.
  extraPages: [
    {
      title: "KVKK Aydınlatma Metni",
      slug: "kvkk-aydinlatma-metni",
      seoTitle: null,
      seoDescription: null,
      isLegalDocument: true,
      blocks: buildLegalPageBlocks("th-kvkk", ["Veri Sorumlusu", "İşlenen Kişisel Veriler (Sağlık Verisi Dahil)", "İşleme Amaçları", "Veri Sahibinin Hakları"]),
    },
    {
      title: "Açık Rıza Metni",
      slug: "acik-riza-metni",
      seoTitle: null,
      seoDescription: null,
      isLegalDocument: true,
      blocks: buildLegalPageBlocks("th-acik-riza", [
        "Rızanın Konusu",
        "İşlenecek Özel Nitelikli Veri Kategorileri",
        "Rızanın Geri Alınması",
        "Görüntülü Görüşmenin Kaydedilmediğine İlişkin Beyan",
      ]),
    },
    {
      title: "Kullanım Koşulları",
      slug: "kullanim-kosullari",
      seoTitle: null,
      seoDescription: null,
      isLegalDocument: true,
      blocks: buildLegalPageBlocks("th-kullanim-kosullari", ["Hizmetin Kapsamı", "Kullanıcı Yükümlülükleri", "Acil Durum Sınırlaması", "Sorumluluk Reddi"]),
    },
    {
      title: "Mesafeli Hizmet Sözleşmesi",
      slug: "mesafeli-hizmet-sozlesmesi",
      seoTitle: null,
      seoDescription: null,
      isLegalDocument: true,
      blocks: buildLegalPageBlocks("th-mesafeli-hizmet", ["Taraflar", "Hizmetin Tanımı", "Ücretlendirme", "Cayma Hakkı"]),
    },
  ],

  telehealth: {
    specialties: SPECIALTIES,
    doctors: DOCTORS,
  },
};
