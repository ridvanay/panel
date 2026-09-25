import type { CreateSitePageRequest, Locale, SitePage } from "@/lib/api/types";
import type { HomeStrings } from "@/lib/i18n/site-dictionaries";
import { homeStrings as enHomeStrings } from "@/lib/i18n/site-dictionaries/en/home";
import { homeStrings as trHomeStrings } from "@/lib/i18n/site-dictionaries/tr/home";
import {
  asRecord,
  cta,
  flag,
  icon,
  itemId,
  optionalText,
  text,
  type AboutCta,
  type AboutIconKey,
} from "@/lib/about-page";

/**
 * "Anasayfa" şablonu — `home-page` blok tipi. `about-page` ile AYNI desen: sayfanın TEK kök bloğu,
 * dil başına `blocks` / `translations.<locale>.blocks`; boş metin = sözlük varsayılanı.
 *
 * **Ayna (backend):** `backend/src/lib/home-page-template.ts` + `pages.schemas.ts::HomePageBlockSchema`
 * — sınırlar BİREBİR aynı olmak ZORUNDADIR. İkonlar Hakkımızda şablonuyla ortaktır (`ABOUT_ICON_KEYS`).
 */
export const HOME_PAGE_BLOCK_TYPE = "home-page";
export const HOME_PAGE_BLOCK_ID = "home-page-root";
export const HOME_MIN_TRUST_ITEMS = 1;
export const HOME_MAX_TRUST_ITEMS = 4;
export const HOME_MIN_STEPS = 2;
export const HOME_MAX_STEPS = 4;
export const HOME_MIN_DOCTORS = 1;
export const HOME_MAX_DOCTORS = 8;
export const HOME_DEFAULT_DOCTORS = 3;
export const HOME_SPECIALTY_COLUMNS = [3, 4, 6] as const;
export type HomeSpecialtyColumns = (typeof HOME_SPECIALTY_COLUMNS)[number];
export const HOME_DEFAULT_SPECIALTY_COLUMNS: HomeSpecialtyColumns = 6;
/** "Nasıl çalışır" bölümünün çapası — hero'nun varsayılan ikinci butonu buraya kayar. */
export const HOME_HOW_ANCHOR = "#how";

export interface HomeItem {
  id: string;
  icon: AboutIconKey;
  title: string;
  text: string;
}

export interface HomePageContent {
  hero: {
    enabled: boolean;
    eyebrow: string;
    title: string;
    body: string;
    primaryCta: AboutCta;
    secondaryCta: AboutCta;
    imageUrl: string;
    imageAlt: string;
    cardTitle: string;
    cardText: string;
  };
  trust: { enabled: boolean; items: HomeItem[] };
  specialties: { enabled: boolean; eyebrow: string; title: string; viewAllLabel: string; columns: HomeSpecialtyColumns };
  how: { enabled: boolean; eyebrow: string; title: string; steps: HomeItem[] };
  doctors: { enabled: boolean; eyebrow: string; title: string; ctaLabel: string; count: number };
  closing: { enabled: boolean; title: string; primaryCta: AboutCta; secondaryCta: AboutCta };
}

export interface HomePageBlock {
  id: string;
  type: typeof HOME_PAGE_BLOCK_TYPE;
  data: HomePageContent;
}

/** Sözlük metinlerinden TAM içerik — hem render varsayılanı hem "Yeni Sayfa → Anasayfa şablonu"nun başlangıç içeriği. */
export function buildDefaultHomeContent(dict: HomeStrings): HomePageContent {
  return {
    hero: {
      enabled: true,
      eyebrow: dict.heroEyebrow,
      title: dict.heroTitle,
      body: dict.heroBody,
      primaryCta: { label: dict.heroPrimaryCta, href: "/doctors" },
      secondaryCta: { label: dict.heroSecondaryCta, href: HOME_HOW_ANCHOR },
      imageUrl: "",
      imageAlt: "",
      cardTitle: dict.heroCardTitle,
      cardText: dict.heroCardText,
    },
    trust: {
      enabled: true,
      items: [
        { id: "trust-1", icon: "Clock", title: dict.trust1Title, text: dict.trust1Text },
        { id: "trust-2", icon: "ShieldCheck", title: dict.trust2Title, text: dict.trust2Text },
        { id: "trust-3", icon: "BadgeCheck", title: dict.trust3Title, text: dict.trust3Text },
      ],
    },
    specialties: {
      enabled: true,
      eyebrow: dict.specialtiesEyebrow,
      title: dict.specialtiesTitle,
      viewAllLabel: dict.specialtiesViewAll,
      columns: HOME_DEFAULT_SPECIALTY_COLUMNS,
    },
    how: {
      enabled: true,
      eyebrow: dict.howEyebrow,
      title: dict.howTitle,
      steps: [
        { id: "step-1", icon: "Search", title: dict.step1Title, text: dict.step1Text },
        { id: "step-2", icon: "Calendar", title: dict.step2Title, text: dict.step2Text },
        { id: "step-3", icon: "Video", title: dict.step3Title, text: dict.step3Text },
      ],
    },
    doctors: {
      enabled: true,
      eyebrow: dict.doctorsEyebrow,
      title: dict.doctorsTitle,
      ctaLabel: dict.doctorsCta,
      count: HOME_DEFAULT_DOCTORS,
    },
    closing: {
      enabled: true,
      title: dict.closingTitle,
      primaryCta: { label: dict.closingPrimaryCta, href: "/doctors" },
      secondaryCta: { label: dict.closingSecondaryCta, href: "/contact" },
    },
  };
}

function isColumns(value: unknown): value is HomeSpecialtyColumns {
  return typeof value === "number" && (HOME_SPECIALTY_COLUMNS as readonly number[]).includes(value);
}

function validCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= HOME_MIN_DOCTORS && value <= HOME_MAX_DOCTORS ? value : fallback;
}

function readItems(raw: unknown, max: number, prefix: string, fallbackIcon: AboutIconKey): HomeItem[] {
  return (Array.isArray(raw) ? raw : []).slice(0, max).map((item, index) => {
    const r = asRecord(item);
    return { id: itemId(r.id, index, prefix), icon: icon(r.icon, fallbackIcon), title: optionalText(r.title), text: optionalText(r.text) };
  });
}

/**
 * Ham blok verisini (DB'den, tip güvencesi YOK) sözlük varsayılanlarıyla ALAN BAZINDA birleştirir:
 * boş/eksik alan → varsayılan; başlığı boş madde atlanır; liste boş kalırsa (veya en az sayının
 * altına düşerse) varsayılan liste. ASLA hata fırlatmaz.
 */
export function resolveHomeContent(raw: unknown, defaults: HomePageContent): HomePageContent {
  const data = asRecord(raw);
  const hero = asRecord(data.hero);
  const trust = asRecord(data.trust);
  const specialties = asRecord(data.specialties);
  const how = asRecord(data.how);
  const doctors = asRecord(data.doctors);
  const closing = asRecord(data.closing);

  const trustItems = readItems(trust.items, HOME_MAX_TRUST_ITEMS, "trust", "BadgeCheck").filter((i) => i.title.length > 0);
  const steps = readItems(how.steps, HOME_MAX_STEPS, "step", "BadgeCheck").filter((i) => i.title.length > 0);

  return {
    hero: {
      enabled: flag(hero.enabled, defaults.hero.enabled),
      eyebrow: text(hero.eyebrow, defaults.hero.eyebrow),
      title: text(hero.title, defaults.hero.title),
      body: text(hero.body, defaults.hero.body),
      primaryCta: cta(hero.primaryCta, defaults.hero.primaryCta),
      secondaryCta: cta(hero.secondaryCta, defaults.hero.secondaryCta),
      imageUrl: optionalText(hero.imageUrl) || defaults.hero.imageUrl,
      imageAlt: text(hero.imageAlt, defaults.hero.imageAlt),
      cardTitle: text(hero.cardTitle, defaults.hero.cardTitle),
      cardText: text(hero.cardText, defaults.hero.cardText),
    },
    trust: {
      enabled: flag(trust.enabled, defaults.trust.enabled),
      items: trustItems.length >= HOME_MIN_TRUST_ITEMS ? trustItems : defaults.trust.items,
    },
    specialties: {
      enabled: flag(specialties.enabled, defaults.specialties.enabled),
      eyebrow: text(specialties.eyebrow, defaults.specialties.eyebrow),
      title: text(specialties.title, defaults.specialties.title),
      viewAllLabel: text(specialties.viewAllLabel, defaults.specialties.viewAllLabel),
      columns: isColumns(specialties.columns) ? specialties.columns : defaults.specialties.columns,
    },
    how: {
      enabled: flag(how.enabled, defaults.how.enabled),
      eyebrow: text(how.eyebrow, defaults.how.eyebrow),
      title: text(how.title, defaults.how.title),
      steps: steps.length >= HOME_MIN_STEPS ? steps : defaults.how.steps,
    },
    doctors: {
      enabled: flag(doctors.enabled, defaults.doctors.enabled),
      eyebrow: text(doctors.eyebrow, defaults.doctors.eyebrow),
      title: text(doctors.title, defaults.doctors.title),
      ctaLabel: text(doctors.ctaLabel, defaults.doctors.ctaLabel),
      count: validCount(doctors.count, defaults.doctors.count),
    },
    closing: {
      enabled: flag(closing.enabled, defaults.closing.enabled),
      title: text(closing.title, defaults.closing.title),
      primaryCta: cta(closing.primaryCta, defaults.closing.primaryCta),
      secondaryCta: cta(closing.secondaryCta, defaults.closing.secondaryCta),
    },
  };
}

/**
 * Admin formu için: ham veriyi tip güvenli şekle getirir, DOLDURMAZ (boş alan boş kalır — formda
 * varsayılan placeholder olarak görünür); başlığı boş maddeler atılmaz (yeni eklenen kart kaybolmasın).
 */
export function toEditableHomeContent(raw: unknown, defaults: HomePageContent): HomePageContent {
  const data = asRecord(raw);
  const hero = asRecord(data.hero);
  const trust = asRecord(data.trust);
  const specialties = asRecord(data.specialties);
  const how = asRecord(data.how);
  const doctors = asRecord(data.doctors);
  const closing = asRecord(data.closing);
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const rawCta = (value: unknown): AboutCta => {
    const r = asRecord(value);
    return { label: str(r.label), href: str(r.href) };
  };
  const items = (value: unknown, max: number, prefix: string) =>
    (Array.isArray(value) ? value : []).slice(0, max).map((item, index) => {
      const r = asRecord(item);
      return { id: itemId(r.id, index, prefix), icon: icon(r.icon, "BadgeCheck"), title: str(r.title), text: str(r.text) };
    });
  const trustItems = items(trust.items, HOME_MAX_TRUST_ITEMS, "trust");
  const steps = items(how.steps, HOME_MAX_STEPS, "step");

  return {
    hero: {
      enabled: flag(hero.enabled, true),
      eyebrow: str(hero.eyebrow),
      title: str(hero.title),
      body: str(hero.body),
      primaryCta: rawCta(hero.primaryCta),
      secondaryCta: rawCta(hero.secondaryCta),
      imageUrl: str(hero.imageUrl),
      imageAlt: str(hero.imageAlt),
      cardTitle: str(hero.cardTitle),
      cardText: str(hero.cardText),
    },
    // Liste hiç kaydedilmemişse form varsayılan maddelerle başlar (kaydedilebilir olsun diye).
    trust: { enabled: flag(trust.enabled, true), items: trustItems.length > 0 ? trustItems : defaults.trust.items },
    specialties: {
      enabled: flag(specialties.enabled, true),
      eyebrow: str(specialties.eyebrow),
      title: str(specialties.title),
      viewAllLabel: str(specialties.viewAllLabel),
      columns: isColumns(specialties.columns) ? specialties.columns : HOME_DEFAULT_SPECIALTY_COLUMNS,
    },
    how: {
      enabled: flag(how.enabled, true),
      eyebrow: str(how.eyebrow),
      title: str(how.title),
      steps: steps.length > 0 ? steps : defaults.how.steps,
    },
    doctors: {
      enabled: flag(doctors.enabled, true),
      eyebrow: str(doctors.eyebrow),
      title: str(doctors.title),
      ctaLabel: str(doctors.ctaLabel),
      count: validCount(doctors.count, HOME_DEFAULT_DOCTORS),
    },
    closing: {
      enabled: flag(closing.enabled, true),
      title: str(closing.title),
      primaryCta: rawCta(closing.primaryCta),
      secondaryCta: rawCta(closing.secondaryCta),
    },
  };
}

/** Bir blok dizisi `home-page` şablonuysa onun ham `data`'sını döner. */
export function findHomeBlockData(blocks: unknown): unknown | null {
  if (!Array.isArray(blocks)) return null;
  const root = blocks.find((node) => asRecord(node).type === HOME_PAGE_BLOCK_TYPE);
  return root ? (asRecord(root).data ?? {}) : null;
}

/** Sayfa "Anasayfa" şablonunu kullanıyor mu? (herhangi bir dilde home-page bloğu taşıyorsa) */
export function isHomeTemplatePage(page: Pick<SitePage, "blocks" | "translations"> | null | undefined): boolean {
  if (!page) return false;
  if (findHomeBlockData(page.blocks) !== null) return true;
  return Object.values(page.translations ?? {}).some((fields) => findHomeBlockData(asRecord(fields).blocks) !== null);
}

/** Mevcut kök home bloğunun `id`'si (yoksa varsayılan) — şablon-modu guard'ı `id` ile eşleştirir. */
export function findHomeBlockId(blocks: unknown): string {
  if (!Array.isArray(blocks)) return HOME_PAGE_BLOCK_ID;
  const root = asRecord(blocks.find((node) => asRecord(node).type === HOME_PAGE_BLOCK_TYPE));
  return typeof root.id === "string" && root.id.length > 0 ? root.id : HOME_PAGE_BLOCK_ID;
}

export function toHomeBlocks(content: HomePageContent, blockId: string = HOME_PAGE_BLOCK_ID): HomePageBlock[] {
  return [{ id: blockId, type: HOME_PAGE_BLOCK_TYPE, data: content }];
}

/** Sözlüğü olan diller (EN/TR); diğer dillerde içerik İngilizce varsayılanla gösterilir. */
function homeStringsFor(code: string): HomeStrings {
  return code === "tr" ? trHomeStrings : enHomeStrings;
}

/**
 * "Yeni Sayfa → Anasayfa şablonu" gövdesi: varsayılan dilin bloğu O DİLİN sözlüğüyle, EN/TR'den
 * varsayılan olmayan (ve etkin olan) dil ise `translations.<kod>.blocks` olarak kendi sözlüğüyle
 * DOLU oluşturulur. Varsayılan dilden BAĞIMSIZDIR (prod'da EN, yerelde TR varsayılan olabilir).
 * `editMode: TEMPLATE` — yapılandırılmış form açılır; backend bu alanı yalnızca ADMIN/MANAGER'dan kabul eder.
 */
export function buildHomeTemplateCreatePayload(
  locales: Pick<Locale, "code" | "isDefault" | "enabled">[]
): Pick<CreateSitePageRequest, "blocks" | "translations" | "editMode"> {
  const defaultCode = locales.find((l) => l.isDefault)?.code ?? "en";
  const blocks = toHomeBlocks(buildDefaultHomeContent(homeStringsFor(defaultCode))) as unknown as Record<string, unknown>[];
  const translations: Record<string, { blocks: unknown[] }> = {};
  for (const code of ["en", "tr"]) {
    if (code === defaultCode || !locales.some((l) => l.code === code && l.enabled)) continue;
    translations[code] = { blocks: toHomeBlocks(buildDefaultHomeContent(homeStringsFor(code))) };
  }
  return {
    editMode: "TEMPLATE",
    blocks,
    ...(Object.keys(translations).length > 0 ? { translations: translations as CreateSitePageRequest["translations"] } : {}),
  };
}
