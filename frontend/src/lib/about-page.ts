import type { DoctorProfile, SitePage } from "@/lib/api/types";
import type { AboutStrings } from "@/lib/i18n/site-dictionaries";
import { withLocalePrefix } from "@/lib/i18n/site-path";

/**
 * "Hakkımızda" (About Us) şablonu — `about-page` blok tipi.
 *
 * Şablon ayrı bir `Page` kolonu DEĞİLDİR: `slug = "about"` olan CMS sayfasının `blocks` dizisinde
 * (tr) ve `translations.<locale>.blocks`'ta TEK kök düğüm olarak duran bir `about-page` bloğudur.
 * Tasarım kodda sabittir; blok yalnızca İÇERİK taşır.
 *
 * **Ayna (backend):** `backend/src/lib/about-page-template.ts` — `ABOUT_ICON_KEYS` ve sınırlar
 * BİREBİR aynı olmak ZORUNDADIR (asıl doğrulama backend'dedir, `pages.schemas.ts`).
 *
 * **Geriye dönük güvenlik (bağlayıcı):** kayıt yoksa, yayında değilse, silinmişse ya da bir alan
 * boş/bozuksa sayfa KODDAKİ sözlük metinlerini (`site-dictionaries/<lang>/about.ts`) gösterir —
 * `resolveAboutContent` asla hata fırlatmaz.
 */
export const ABOUT_PAGE_BLOCK_TYPE = "about-page";
export const ABOUT_PAGE_SLUG = "about";

export const ABOUT_ICON_KEYS = [
  "Scale",
  "Ribbon",
  "Baby",
  "Smile",
  "Scissors",
  "Sparkles",
  "Stethoscope",
  "ClipboardCheck",
  "Globe",
  "HeartPulse",
  "Heart",
  "Brain",
  "Bone",
  "Eye",
  "Activity",
  "ShieldCheck",
  "ShieldPlus",
  "Syringe",
  "Pill",
  "Microscope",
  "Hospital",
  "Users",
  "Handshake",
  "Plane",
  "MapPin",
  "Award",
  "Clock",
  "MessageCircle",
  "Languages",
  "BadgeCheck",
] as const;
export type AboutIconKey = (typeof ABOUT_ICON_KEYS)[number];

export const ABOUT_MAX_TREATMENT_ITEMS = 12;
export const ABOUT_MAX_APPROACH_ITEMS = 6;
export const ABOUT_MIN_DOCTORS = 1;
export const ABOUT_MAX_DOCTORS = 6;
export const ABOUT_DEFAULT_DOCTORS_COUNT = 3;
/** Hero'daki ikincil CTA'nın varsayılan hedefi — doktor bölümünün `id`'si. */
export const ABOUT_DOCTORS_ANCHOR = "#doctors";

export interface AboutCta {
  label: string;
  href: string;
}

export interface AboutTreatmentItem {
  id: string;
  name: string;
  icon: AboutIconKey;
}

export interface AboutApproachItem {
  id: string;
  title: string;
  body: string;
  icon: AboutIconKey;
}

export interface AboutPageContent {
  hero: {
    eyebrow: string;
    title: string;
    body: string;
    primaryCta: AboutCta;
    secondaryCta: AboutCta;
    imageUrl: string;
    imageAlt: string;
    locationTitle: string;
    locationSubtitle: string;
  };
  treatments: { enabled: boolean; eyebrow: string; title: string; body: string; items: AboutTreatmentItem[] };
  approach: { enabled: boolean; eyebrow: string; title: string; items: AboutApproachItem[] };
  doctors: {
    enabled: boolean;
    eyebrow: string;
    title: string;
    ctaLabel: string;
    count: number;
    founderDoctorId: string | null;
    founderLabel: string;
  };
  closing: { title: string; primaryCta: AboutCta; secondaryCta: AboutCta };
}

/** Bir `about-page` bloğu — `Page.blocks` / `translations.<locale>.blocks` içindeki şekil. */
export interface AboutPageBlock {
  id: string;
  type: typeof ABOUT_PAGE_BLOCK_TYPE;
  data: AboutPageContent;
}

export const ABOUT_PAGE_BLOCK_ID = "about-page-root";

/**
 * Sözlük metinlerinden TAM içerik — hem public sayfanın alan bazlı varsayılanı hem de veri
 * migration'ının (`*_add_about_page_content`) ürettiği kaydın kaynağıdır (eşitlik birim testle
 * korunur). Bağlantılar dil öneksizdir; render sırasında aktif dile göre öneklenir.
 */
export function buildDefaultAboutContent(dict: AboutStrings): AboutPageContent {
  return {
    hero: {
      eyebrow: dict.heroEyebrow,
      title: dict.heroTitle,
      body: dict.heroBody,
      primaryCta: { label: dict.bookConsultationCta, href: "/doctors" },
      secondaryCta: { label: dict.meetDoctorsCta, href: ABOUT_DOCTORS_ANCHOR },
      imageUrl: "",
      imageAlt: "",
      locationTitle: dict.locationTitle,
      locationSubtitle: dict.locationSubtitle,
    },
    treatments: {
      enabled: true,
      eyebrow: dict.treatmentEyebrow,
      title: dict.treatmentTitle,
      body: dict.treatmentBody,
      items: [
        { id: "treatment-1", name: dict.treatmentObesity, icon: "Scale" },
        { id: "treatment-2", name: dict.treatmentOncology, icon: "Ribbon" },
        { id: "treatment-3", name: dict.treatmentIvf, icon: "Baby" },
        { id: "treatment-4", name: dict.treatmentDental, icon: "Smile" },
        { id: "treatment-5", name: dict.treatmentHair, icon: "Scissors" },
        { id: "treatment-6", name: dict.treatmentPlastic, icon: "Sparkles" },
      ],
    },
    approach: {
      enabled: true,
      eyebrow: dict.approachEyebrow,
      title: dict.approachTitle,
      items: [
        { id: "approach-1", title: dict.approach1Title, body: dict.approach1Body, icon: "Stethoscope" },
        { id: "approach-2", title: dict.approach2Title, body: dict.approach2Body, icon: "ClipboardCheck" },
        { id: "approach-3", title: dict.approach3Title, body: dict.approach3Body, icon: "Globe" },
      ],
    },
    doctors: {
      enabled: true,
      eyebrow: dict.doctorsEyebrow,
      title: dict.doctorsTitle,
      ctaLabel: dict.viewAllDoctorsCta,
      count: ABOUT_DEFAULT_DOCTORS_COUNT,
      founderDoctorId: null,
      founderLabel: dict.founderBadge,
    },
    closing: {
      title: dict.closingTitle,
      primaryCta: { label: dict.bookConsultationCta, href: "/doctors" },
      secondaryCta: { label: dict.contactCta, href: "/contact" },
    },
  };
}

export function buildDefaultAboutBlock(dict: AboutStrings): AboutPageBlock {
  return { id: ABOUT_PAGE_BLOCK_ID, type: ABOUT_PAGE_BLOCK_TYPE, data: buildDefaultAboutContent(dict) };
}

// --- savunmacı birleştirme -------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function optionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cta(value: unknown, fallback: AboutCta): AboutCta {
  const raw = asRecord(value);
  return { label: text(raw.label, fallback.label), href: text(raw.href, fallback.href) };
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function isAboutIconKey(value: unknown): value is AboutIconKey {
  return typeof value === "string" && (ABOUT_ICON_KEYS as readonly string[]).includes(value);
}

function icon(value: unknown, fallback: AboutIconKey): AboutIconKey {
  return isAboutIconKey(value) ? value : fallback;
}

function itemId(value: unknown, index: number, prefix: string): string {
  return typeof value === "string" && value.length > 0 ? value : `${prefix}-${index + 1}`;
}

/**
 * Ham blok verisini (DB'den, tip güvencesi YOK) sözlük varsayılanlarıyla ALAN BAZINDA birleştirir.
 * Kurallar: boş/eksik/yanlış tipli alan → varsayılan; adı/başlığı boş liste öğesi atlanır; liste
 * tamamen boş kalırsa varsayılan liste gösterilir; `enabled` yalnızca gerçek bir boolean ise
 * dikkate alınır. ASLA hata fırlatmaz.
 */
export function resolveAboutContent(raw: unknown, defaults: AboutPageContent): AboutPageContent {
  const data = asRecord(raw);
  const hero = asRecord(data.hero);
  const treatments = asRecord(data.treatments);
  const approach = asRecord(data.approach);
  const doctors = asRecord(data.doctors);
  const closing = asRecord(data.closing);

  const treatmentItems = (Array.isArray(treatments.items) ? treatments.items : [])
    .slice(0, ABOUT_MAX_TREATMENT_ITEMS)
    .map((item, index) => {
      const r = asRecord(item);
      return { id: itemId(r.id, index, "treatment"), name: optionalText(r.name), icon: icon(r.icon, "BadgeCheck") };
    })
    .filter((item) => item.name.length > 0);

  const approachItems = (Array.isArray(approach.items) ? approach.items : [])
    .slice(0, ABOUT_MAX_APPROACH_ITEMS)
    .map((item, index) => {
      const r = asRecord(item);
      return { id: itemId(r.id, index, "approach"), title: optionalText(r.title), body: optionalText(r.body), icon: icon(r.icon, "BadgeCheck") };
    })
    .filter((item) => item.title.length > 0);

  const rawCount = doctors.count;
  const count =
    typeof rawCount === "number" && Number.isInteger(rawCount) && rawCount >= ABOUT_MIN_DOCTORS && rawCount <= ABOUT_MAX_DOCTORS
      ? rawCount
      : defaults.doctors.count;
  const founderDoctorId = typeof doctors.founderDoctorId === "string" && doctors.founderDoctorId.length > 0 ? doctors.founderDoctorId : null;
  const imageUrl = optionalText(hero.imageUrl);

  return {
    hero: {
      eyebrow: text(hero.eyebrow, defaults.hero.eyebrow),
      title: text(hero.title, defaults.hero.title),
      body: text(hero.body, defaults.hero.body),
      primaryCta: cta(hero.primaryCta, defaults.hero.primaryCta),
      secondaryCta: cta(hero.secondaryCta, defaults.hero.secondaryCta),
      imageUrl: imageUrl || defaults.hero.imageUrl,
      imageAlt: text(hero.imageAlt, defaults.hero.imageAlt),
      locationTitle: text(hero.locationTitle, defaults.hero.locationTitle),
      locationSubtitle: text(hero.locationSubtitle, defaults.hero.locationSubtitle),
    },
    treatments: {
      enabled: flag(treatments.enabled, defaults.treatments.enabled),
      eyebrow: text(treatments.eyebrow, defaults.treatments.eyebrow),
      title: text(treatments.title, defaults.treatments.title),
      body: text(treatments.body, defaults.treatments.body),
      items: treatmentItems.length > 0 ? treatmentItems : defaults.treatments.items,
    },
    approach: {
      enabled: flag(approach.enabled, defaults.approach.enabled),
      eyebrow: text(approach.eyebrow, defaults.approach.eyebrow),
      title: text(approach.title, defaults.approach.title),
      items: approachItems.length > 0 ? approachItems : defaults.approach.items,
    },
    doctors: {
      enabled: flag(doctors.enabled, defaults.doctors.enabled),
      eyebrow: text(doctors.eyebrow, defaults.doctors.eyebrow),
      title: text(doctors.title, defaults.doctors.title),
      ctaLabel: text(doctors.ctaLabel, defaults.doctors.ctaLabel),
      count,
      founderDoctorId,
      founderLabel: text(doctors.founderLabel, defaults.doctors.founderLabel),
    },
    closing: {
      title: text(closing.title, defaults.closing.title),
      primaryCta: cta(closing.primaryCta, defaults.closing.primaryCta),
      secondaryCta: cta(closing.secondaryCta, defaults.closing.secondaryCta),
    },
  };
}

/** Bir blok dizisi `about-page` şablonuysa (tek kök `about-page` bloğu) onun ham `data`'sını döner. */
export function findAboutBlockData(blocks: unknown): unknown | null {
  if (!Array.isArray(blocks)) return null;
  const root = blocks.find((node) => asRecord(node).type === ABOUT_PAGE_BLOCK_TYPE);
  return root ? (asRecord(root).data ?? {}) : null;
}

/** Sayfa "Hakkımızda" şablonunu kullanıyor mu? (herhangi bir dilde about bloğu taşıyorsa) */
export function isAboutTemplatePage(page: Pick<SitePage, "blocks" | "translations"> | null | undefined): boolean {
  if (!page) return false;
  if (findAboutBlockData(page.blocks) !== null) return true;
  return Object.values(page.translations ?? {}).some((fields) => findAboutBlockData(asRecord(fields).blocks) !== null);
}

/**
 * Aktif dilin HAM about verisi. Sayfa VARSAYILAN dilde (çeviri uygulanmadan) çekilmiş olmalıdır:
 * varsayılan dil → `page.blocks`; diğer diller → YALNIZCA `page.translations[lang].blocks`. Bir
 * dilin kendi bloğu yoksa `null` döner ve o dilin SÖZLÜĞÜ gösterilir — varsayılan dilin (Türkçe)
 * içeriği başka bir dile ASLA sızmaz.
 */
export function getAboutDataForLocale(
  page: Pick<SitePage, "blocks" | "translations"> | null | undefined,
  lang: string,
  defaultLocaleCode: string
): unknown | null {
  if (!page) return null;
  if (lang === defaultLocaleCode) return findAboutBlockData(page.blocks);
  const translation = asRecord(asRecord(page.translations)[lang]);
  return findAboutBlockData(translation.blocks);
}

export interface AboutDoctorsSelection {
  doctors: DoctorProfile[];
  /** Kurucu listede bulunduysa onun `id`'si, aksi hâlde `null`. */
  founderId: string | null;
}

/**
 * Kurucu (seçilmişse ve aktif doktorlar arasındaysa) başa alınır, ardından kalan doktorlar
 * GELDİKLERİ SIRAYLA eklenir. Public `GET /doctors` listeyi `seq` artan sırada döndürdüğü için bu
 * "seq sırasıyla ilk N aktif doktor (kurucu hariç)" anlamına gelir. Kurucu bulunamazsa hata
 * VERMEZ: etiketsiz ilk `count` doktor döner.
 */
export function selectAboutDoctors(
  doctors: DoctorProfile[],
  founderDoctorId: string | null,
  count: number = ABOUT_DEFAULT_DOCTORS_COUNT
): AboutDoctorsSelection {
  const founder = founderDoctorId ? doctors.find((doctor) => doctor.id === founderDoctorId) : undefined;
  if (!founder) return { doctors: doctors.slice(0, count), founderId: null };

  const others = doctors.filter((doctor) => doctor.id !== founder.id);
  return { doctors: [founder, ...others.slice(0, count - 1)], founderId: founder.id };
}

/**
 * Admin'in girdiği bağlantıyı aktif dile göre çözer: sayfa içi çapa (`#doctors`) ve mutlak/
 * protokol-göreli (`https://`, `//`) bağlantılar OLDUĞU GİBİ kalır; site içi yollar (`/doctors`)
 * aktif dilin önekini alır (`/en/doctors`). Güvenlik doğrulaması backend'dedir (`SafeHrefSchema`).
 */
export function resolveAboutHref(href: string, activeLocaleCode: string, defaultLocaleCode: string): string {
  if (href.startsWith("/") && !href.startsWith("//")) return withLocalePrefix(href, activeLocaleCode, defaultLocaleCode);
  return href;
}

/** Tamamen boş (tüm metinler `""`, listeler boş) içerik — admin formunun başlangıç şekli. */
export function emptyAboutContent(): AboutPageContent {
  const emptyCta = (): AboutCta => ({ label: "", href: "" });
  return {
    hero: {
      eyebrow: "",
      title: "",
      body: "",
      primaryCta: emptyCta(),
      secondaryCta: emptyCta(),
      imageUrl: "",
      imageAlt: "",
      locationTitle: "",
      locationSubtitle: "",
    },
    treatments: { enabled: true, eyebrow: "", title: "", body: "", items: [] },
    approach: { enabled: true, eyebrow: "", title: "", items: [] },
    doctors: { enabled: true, eyebrow: "", title: "", ctaLabel: "", count: ABOUT_DEFAULT_DOCTORS_COUNT, founderDoctorId: null, founderLabel: "" },
    closing: { title: "", primaryCta: emptyCta(), secondaryCta: emptyCta() },
  };
}

/**
 * Admin formu için: ham veriyi DEĞİŞTİRMEDEN (varsayılanla DOLDURMADAN) tip güvenli şekle getirir —
 * boş alanlar boş kalır (formda sözlük varsayılanı yalnızca placeholder olarak görünür), adı boş
 * liste öğeleri ATILMAZ (yeni eklenmiş, henüz doldurulmamış bir kart kaybolmasın).
 */
export function toEditableAboutContent(raw: unknown): AboutPageContent {
  const empty = emptyAboutContent();
  const data = asRecord(raw);
  const hero = asRecord(data.hero);
  const treatments = asRecord(data.treatments);
  const approach = asRecord(data.approach);
  const doctors = asRecord(data.doctors);
  const closing = asRecord(data.closing);
  const rawCta = (value: unknown): AboutCta => {
    const r = asRecord(value);
    return { label: typeof r.label === "string" ? r.label : "", href: typeof r.href === "string" ? r.href : "" };
  };
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const rawCount = doctors.count;

  return {
    hero: {
      eyebrow: str(hero.eyebrow),
      title: str(hero.title),
      body: str(hero.body),
      primaryCta: rawCta(hero.primaryCta),
      secondaryCta: rawCta(hero.secondaryCta),
      imageUrl: str(hero.imageUrl),
      imageAlt: str(hero.imageAlt),
      locationTitle: str(hero.locationTitle),
      locationSubtitle: str(hero.locationSubtitle),
    },
    treatments: {
      enabled: flag(treatments.enabled, true),
      eyebrow: str(treatments.eyebrow),
      title: str(treatments.title),
      body: str(treatments.body),
      items: (Array.isArray(treatments.items) ? treatments.items : []).slice(0, ABOUT_MAX_TREATMENT_ITEMS).map((item, index) => {
        const r = asRecord(item);
        return { id: itemId(r.id, index, "treatment"), name: str(r.name), icon: icon(r.icon, "BadgeCheck") };
      }),
    },
    approach: {
      enabled: flag(approach.enabled, true),
      eyebrow: str(approach.eyebrow),
      title: str(approach.title),
      items: (Array.isArray(approach.items) ? approach.items : []).slice(0, ABOUT_MAX_APPROACH_ITEMS).map((item, index) => {
        const r = asRecord(item);
        return { id: itemId(r.id, index, "approach"), title: str(r.title), body: str(r.body), icon: icon(r.icon, "BadgeCheck") };
      }),
    },
    doctors: {
      enabled: flag(doctors.enabled, true),
      eyebrow: str(doctors.eyebrow),
      title: str(doctors.title),
      ctaLabel: str(doctors.ctaLabel),
      count:
        typeof rawCount === "number" && Number.isInteger(rawCount) && rawCount >= ABOUT_MIN_DOCTORS && rawCount <= ABOUT_MAX_DOCTORS
          ? rawCount
          : empty.doctors.count,
      founderDoctorId: typeof doctors.founderDoctorId === "string" && doctors.founderDoctorId ? doctors.founderDoctorId : null,
      founderLabel: str(doctors.founderLabel),
    },
    closing: {
      title: str(closing.title),
      primaryCta: rawCta(closing.primaryCta),
      secondaryCta: rawCta(closing.secondaryCta),
    },
  };
}

/** Admin formunun ürettiği içerikten kaydedilecek TEK kök blok dizisi. */
export function toAboutBlocks(content: AboutPageContent, blockId: string = ABOUT_PAGE_BLOCK_ID): AboutPageBlock[] {
  return [{ id: blockId, type: ABOUT_PAGE_BLOCK_TYPE, data: content }];
}

/** Mevcut kök about bloğunun `id`'si (yoksa varsayılan) — kaydederken aynı kimlik korunur (şablon-modu guard'ı `id` ile eşleştirir). */
export function findAboutBlockId(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ABOUT_PAGE_BLOCK_ID;
  const root = asRecord(blocks.find((node) => asRecord(node).type === ABOUT_PAGE_BLOCK_TYPE));
  return typeof root.id === "string" && root.id.length > 0 ? root.id : ABOUT_PAGE_BLOCK_ID;
}
