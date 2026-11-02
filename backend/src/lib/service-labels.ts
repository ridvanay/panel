/**
 * Paket AI - hizmet adlarini "meslek unvani"ndan hizmet adina cevirir (`scripts/rename-service-labels.ts`):
 * ad (EN kanonik + 7 dil), hizmet grubu, ikon ve tek satir kisa aciklama (EN + 7 dil). Ek olarak (`--cta`) header
 * birincil CTA etiketini "Book a consultation" yapar.
 *
 * Guvenlik: kuru calisma varsayilan; yazma `--confirm=rename-service-labels --operator=...`; yazmadan once etkilenen
 * satirlarin onceki degerleri JSON yedege alinir, `--restore=<dosya>` ile geri yuklenir. Idempotent; hicbir kayit
 * SILINMEZ, slug/URL DEGISMEZ. Bulunamayan slug uyarisi (hata kodu yok). `translations` icinde yalnizca `name` ve
 * `shortDescription` anahtarlari yazilir (mevcut `description` ve diger anahtarlar korunur). Alt uzmanlik
 * (ercp/esd/poem) satirlarina DOKUNULMAZ (grup ustten miras alinir).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { CACHE_TAGS, triggerTagRevalidation } from "./revalidate";
import { SERVICE_GROUP_KEYS, SHORT_DESCRIPTION_MAX, type ServiceGroupKey } from "./service-groups";

export const RENAME_SERVICE_LABELS_CONFIRM_KEY = "rename-service-labels";
export const RENAME_SERVICE_LABELS_AUDIT_ACTION = "specialty.service_labels_renamed";
export const RENAME_SERVICE_LABELS_RESTORE_AUDIT_ACTION = "specialty.service_labels_restored";

export const SERVICE_LANGS = ["en", "de", "ar", "ru", "fr", "es", "ro", "sr-latn"] as const;
export type ServiceLang = (typeof SERVICE_LANGS)[number];
type Labels = Record<ServiceLang, string>;

export interface ServiceLabelEntry {
  slug: string;
  group: ServiceGroupKey;
  icon: string;
  name: Labels;
  shortDescription: Labels;
}

/** Ikonlar frontend `icon-box` sozlugunun (lib/page-builder/icon-options.ts) izinli anahtarlaridir; hicbiri tekrarlanmaz. */
export const SERVICE_LABEL_MAP: readonly ServiceLabelEntry[] = [
  {
    slug: "obesity-and-metabolic-surgery",
    group: "surgery-oncology",
    icon: "Target",
    name: { en: "Obesity & Metabolic Surgery", de: "Adipositas- & Stoffwechselchirurgie", ar: "جراحة السمنة والتمثيل الغذائي", ru: "Хирургия ожирения и метаболическая хирургия", fr: "Chirurgie de l'obésité et métabolique", es: "Cirugía de la obesidad y metabólica", ro: "Chirurgia obezității și metabolică", "sr-latn": "Hirurgija gojaznosti i metabolička hirurgija" },
    shortDescription: {
      en: "Weight-loss and metabolic surgery at authorized facilities",
      de: "Adipositas- und Stoffwechselchirurgie in zugelassenen Einrichtungen",
      ar: "جراحة إنقاص الوزن والتمثيل الغذائي في منشآت مرخّصة",
      ru: "Бариатрическая и метаболическая хирургия в лицензированных учреждениях",
      fr: "Chirurgie de perte de poids et métabolique dans des établissements agréés",
      es: "Cirugía de pérdida de peso y metabólica en centros autorizados",
      ro: "Chirurgie bariatrică și metabolică în unități autorizate",
      "sr-latn": "Bariatrijska i metabolička hirurgija u ovlašćenim ustanovama",
    },
  },
  {
    slug: "surgical-oncology",
    group: "surgery-oncology",
    icon: "ShieldCheck",
    name: { en: "Surgical Oncology", de: "Chirurgische Onkologie", ar: "الجراحة الأورامية", ru: "Хирургическая онкология", fr: "Oncologie chirurgicale", es: "Oncología quirúrgica", ro: "Oncologie chirurgicală", "sr-latn": "Hirurška onkologija" },
    shortDescription: {
      en: "Surgical cancer care at authorized healthcare facilities",
      de: "Chirurgische Krebsbehandlung in zugelassenen Gesundheitseinrichtungen",
      ar: "رعاية جراحية لعلاج الأورام في منشآت صحية مرخّصة",
      ru: "Хирургическое лечение онкологических заболеваний в лицензированных клиниках",
      fr: "Chirurgie du cancer dans des établissements de santé agréés",
      es: "Cirugía oncológica en centros sanitarios autorizados",
      ro: "Chirurgie oncologică în unități sanitare autorizate",
      "sr-latn": "Hirurško lečenje karcinoma u ovlašćenim zdravstvenim ustanovama",
    },
  },
  {
    slug: "thoracic-surgery",
    group: "surgery-oncology",
    icon: "Wind",
    name: { en: "Thoracic Surgery", de: "Thoraxchirurgie", ar: "جراحة الصدر", ru: "Торакальная хирургия", fr: "Chirurgie thoracique", es: "Cirugía torácica", ro: "Chirurgie toracică", "sr-latn": "Torakalna hirurgija" },
    shortDescription: {
      en: "Chest and lung surgery at authorized healthcare facilities",
      de: "Brust- und Lungenchirurgie in zugelassenen Gesundheitseinrichtungen",
      ar: "جراحة الصدر والرئة في منشآت صحية مرخّصة",
      ru: "Хирургия грудной клетки и лёгких в лицензированных клиниках",
      fr: "Chirurgie du thorax et du poumon dans des établissements agréés",
      es: "Cirugía de tórax y pulmón en centros sanitarios autorizados",
      ro: "Chirurgie toracică și pulmonară în unități sanitare autorizate",
      "sr-latn": "Hirurgija grudnog koša i pluća u ovlašćenim zdravstvenim ustanovama",
    },
  },
  {
    slug: "neurosurgery",
    group: "surgery-oncology",
    icon: "Brain",
    name: { en: "Neurosurgery", de: "Neurochirurgie", ar: "جراحة الدماغ والأعصاب", ru: "Нейрохирургия", fr: "Neurochirurgie", es: "Neurocirugía", ro: "Neurochirurgie", "sr-latn": "Neurohirurgija" },
    shortDescription: {
      en: "Brain and spine surgery at authorized healthcare facilities",
      de: "Gehirn- und Wirbelsäulenchirurgie in zugelassenen Einrichtungen",
      ar: "جراحة الدماغ والعمود الفقري في منشآت صحية مرخّصة",
      ru: "Хирургия головного мозга и позвоночника в лицензированных клиниках",
      fr: "Chirurgie du cerveau et du rachis dans des établissements agréés",
      es: "Cirugía de cerebro y columna en centros sanitarios autorizados",
      ro: "Chirurgie cerebrală și spinală în unități sanitare autorizate",
      "sr-latn": "Hirurgija mozga i kičme u ovlašćenim zdravstvenim ustanovama",
    },
  },
  {
    slug: "gastroenterology",
    group: "digestive-interventional",
    icon: "Layers",
    name: { en: "Gastroenterology", de: "Gastroenterologie", ar: "أمراض الجهاز الهضمي", ru: "Гастроэнтерология", fr: "Gastroentérologie", es: "Gastroenterología", ro: "Gastroenterologie", "sr-latn": "Gastroenterologija" },
    shortDescription: {
      en: "Digestive care and endoscopic procedures at authorized facilities",
      de: "Verdauungsmedizin und endoskopische Verfahren in zugelassenen Einrichtungen",
      ar: "رعاية الجهاز الهضمي وإجراءات المنظار في منشآت مرخّصة",
      ru: "Лечение органов пищеварения и эндоскопические процедуры в лицензированных клиниках",
      fr: "Soins digestifs et procédures endoscopiques dans des établissements agréés",
      es: "Atención digestiva y procedimientos endoscópicos en centros autorizados",
      ro: "Îngrijire digestivă și proceduri endoscopice în unități autorizate",
      "sr-latn": "Lečenje digestivnog sistema i endoskopske procedure u ovlašćenim ustanovama",
    },
  },
  {
    slug: "interventional-radiology-specialist",
    group: "digestive-interventional",
    icon: "Zap",
    name: { en: "Interventional Radiology", de: "Interventionelle Radiologie", ar: "الأشعة التداخلية", ru: "Интервенционная радиология", fr: "Radiologie interventionnelle", es: "Radiología intervencionista", ro: "Radiologie intervențională", "sr-latn": "Interventna radiologija" },
    shortDescription: {
      en: "Image-guided, minimally invasive procedures at authorized facilities",
      de: "Bildgesteuerte, minimalinvasive Verfahren in zugelassenen Einrichtungen",
      ar: "إجراءات موجّهة بالتصوير وطفيفة التوغل في منشآت مرخّصة",
      ru: "Малоинвазивные процедуры под визуальным контролем в лицензированных клиниках",
      fr: "Procédures mini-invasives guidées par l'image dans des établissements agréés",
      es: "Procedimientos mínimamente invasivos guiados por imagen en centros autorizados",
      ro: "Proceduri minim invazive ghidate imagistic în unități autorizate",
      "sr-latn": "Minimalno invazivne procedure vođene snimanjem u ovlašćenim ustanovama",
    },
  },
  {
    slug: "plastic-and-aesthetic-surgery",
    group: "aesthetic-dental-hair",
    icon: "Sparkles",
    name: { en: "Plastic & Aesthetic Surgery", de: "Plastische & Ästhetische Chirurgie", ar: "الجراحة التجميلية والترميمية", ru: "Пластическая и эстетическая хирургия", fr: "Chirurgie plastique et esthétique", es: "Cirugía plástica y estética", ro: "Chirurgie plastică și estetică", "sr-latn": "Plastična i estetska hirurgija" },
    shortDescription: {
      en: "Reconstructive and aesthetic surgery at authorized facilities",
      de: "Rekonstruktive und ästhetische Chirurgie in zugelassenen Einrichtungen",
      ar: "الجراحة الترميمية والتجميلية في منشآت مرخّصة",
      ru: "Реконструктивная и эстетическая хирургия в лицензированных клиниках",
      fr: "Chirurgie reconstructrice et esthétique dans des établissements agréés",
      es: "Cirugía reconstructiva y estética en centros autorizados",
      ro: "Chirurgie reconstructivă și estetică în unități autorizate",
      "sr-latn": "Rekonstruktivna i estetska hirurgija u ovlašćenim ustanovama",
    },
  },
  {
    slug: "dentalcare",
    group: "aesthetic-dental-hair",
    icon: "Smile",
    name: { en: "Dental Care", de: "Zahnmedizin", ar: "رعاية الأسنان", ru: "Стоматология", fr: "Soins dentaires", es: "Cuidado dental", ro: "Îngrijire dentară", "sr-latn": "Stomatološka nega" },
    shortDescription: {
      en: "Dental treatments at authorized dental facilities",
      de: "Zahnbehandlungen in zugelassenen Zahnkliniken",
      ar: "علاجات الأسنان في منشآت أسنان مرخّصة",
      ru: "Стоматологическое лечение в лицензированных клиниках",
      fr: "Soins dentaires dans des établissements dentaires agréés",
      es: "Tratamientos dentales en clínicas dentales autorizadas",
      ro: "Tratamente dentare în clinici dentare autorizate",
      "sr-latn": "Stomatološki tretmani u ovlašćenim stomatološkim ustanovama",
    },
  },
  {
    slug: "orthodontist",
    group: "aesthetic-dental-hair",
    icon: "Gem",
    name: { en: "Orthodontics", de: "Kieferorthopädie", ar: "تقويم الأسنان", ru: "Ортодонтия", fr: "Orthodontie", es: "Ortodoncia", ro: "Ortodonție", "sr-latn": "Ortodoncija" },
    shortDescription: {
      en: "Teeth alignment and bite correction at authorized dental facilities",
      de: "Zahnkorrektur und Bisskorrektur in zugelassenen Zahnkliniken",
      ar: "تقويم الأسنان وتصحيح الإطباق في منشآت أسنان مرخّصة",
      ru: "Выравнивание зубов и исправление прикуса в лицензированных клиниках",
      fr: "Alignement dentaire et correction de l'occlusion dans des établissements agréés",
      es: "Alineación dental y corrección de la mordida en clínicas autorizadas",
      ro: "Aliniere dentară și corectarea ocluziei în clinici autorizate",
      "sr-latn": "Ispravljanje zuba i korekcija zagrižaja u ovlašćenim ustanovama",
    },
  },
  {
    slug: "hair-transplantation",
    group: "aesthetic-dental-hair",
    icon: "Star",
    name: { en: "Hair Transplantation", de: "Haartransplantation", ar: "زراعة الشعر", ru: "Трансплантация волос", fr: "Greffe de cheveux", es: "Trasplante capilar", ro: "Transplant de păr", "sr-latn": "Transplantacija kose" },
    shortDescription: {
      en: "Hair restoration treatments at authorized facilities",
      de: "Haarrestaurationsbehandlungen in zugelassenen Einrichtungen",
      ar: "علاجات استعادة الشعر في منشآت مرخّصة",
      ru: "Восстановление волос в лицензированных клиниках",
      fr: "Traitements de restauration capillaire dans des établissements agréés",
      es: "Tratamientos de restauración capilar en centros autorizados",
      ro: "Tratamente de restaurare a părului în unități autorizate",
      "sr-latn": "Tretmani obnove kose u ovlašćenim ustanovama",
    },
  },
  {
    slug: "ivf-and-reproductive-health",
    group: "fertility",
    icon: "Heart",
    name: { en: "IVF & Reproductive Health", de: "IVF & Reproduktionsmedizin", ar: "أطفال الأنابيب والصحة الإنجابية", ru: "ЭКО и репродуктивное здоровье", fr: "FIV et santé reproductive", es: "FIV y salud reproductiva", ro: "FIV și sănătate reproductivă", "sr-latn": "VTO i reproduktivno zdravlje" },
    shortDescription: {
      en: "Fertility and reproductive health services at authorized facilities",
      de: "Kinderwunsch- und Reproduktionsleistungen in zugelassenen Einrichtungen",
      ar: "خدمات الخصوبة والصحة الإنجابية في منشآت مرخّصة",
      ru: "Услуги по лечению бесплодия и репродуктивному здоровью в лицензированных клиниках",
      fr: "Services de fertilité et de santé reproductive dans des établissements agréés",
      es: "Servicios de fertilidad y salud reproductiva en centros autorizados",
      ro: "Servicii de fertilitate și sănătate reproductivă în unități autorizate",
      "sr-latn": "Usluge plodnosti i reproduktivnog zdravlja u ovlašćenim ustanovama",
    },
  },
];

export const CTA_LABEL: Labels = {
  en: "Book a consultation",
  de: "Beratung buchen",
  ar: "احجز استشارة",
  ru: "Записаться на консультацию",
  fr: "Réserver une consultation",
  es: "Reservar una consulta",
  ro: "Programează o consultație",
  "sr-latn": "Zakažite konsultaciju",
};
export const CTA_HREF = "/request";

export class RenameServiceLabelsError extends Error {}

type Db = Pick<PrismaClient, "specialty" | "siteSettings" | "auditLog" | "$transaction">;
type Json = Prisma.InputJsonValue;

export interface SpecialtyState {
  name: string;
  icon: string;
  serviceGroup: string | null;
  shortDescription: string | null;
  translations: Record<string, Record<string, unknown>>;
}

export interface CtaState {
  headerCtaLabel: string | null;
  headerCtaHref: string | null;
  translations: Record<string, Record<string, unknown>>;
}

function asTranslations(value: unknown): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, Record<string, unknown>>;
}

function mergeTranslations(existing: unknown, patch: (lang: ServiceLang) => Record<string, string>): Record<string, Record<string, unknown>> {
  const out = asTranslations(existing);
  for (const lang of SERVICE_LANGS) out[lang] = { ...(out[lang] ?? {}), ...patch(lang) };
  return out;
}

/** Sirali-anahtarli kanonik JSON: anahtar sirasi farki "degisiklik" sayilmasin. */
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)])) : v;
  return JSON.stringify(sort(value));
}

export function desiredSpecialtyState(entry: ServiceLabelEntry, existingTranslations: unknown): SpecialtyState {
  return {
    name: entry.name.en,
    icon: entry.icon,
    serviceGroup: entry.group,
    shortDescription: entry.shortDescription.en,
    translations: mergeTranslations(existingTranslations, (lang) => ({ name: entry.name[lang], shortDescription: entry.shortDescription[lang] })),
  };
}

function sameState(a: SpecialtyState, b: SpecialtyState): boolean {
  return a.name === b.name && a.icon === b.icon && a.serviceGroup === b.serviceGroup && a.shortDescription === b.shortDescription && canonical(a.translations) === canonical(b.translations);
}

/** Haritadaki degerlerin kendi ic tutarliligi (kod hatasini yakalamak icin). */
export function validateServiceLabelMap(map: readonly ServiceLabelEntry[] = SERVICE_LABEL_MAP): string[] {
  const problems: string[] = [];
  const icons = new Set<string>();
  for (const e of map) {
    if (!(SERVICE_GROUP_KEYS as readonly string[]).includes(e.group)) problems.push(`${e.slug}: geçersiz grup`);
    if (icons.has(e.icon)) problems.push(`${e.slug}: ikon tekrar (${e.icon})`);
    icons.add(e.icon);
    for (const lang of SERVICE_LANGS) {
      if (!e.name[lang]?.trim() || e.name[lang].length > 80) problems.push(`${e.slug}: ad (${lang}) boş ya da >80`);
      const sd = e.shortDescription[lang];
      if (!sd?.trim() || sd.length > SHORT_DESCRIPTION_MAX) problems.push(`${e.slug}: kısa açıklama (${lang}) boş ya da >${SHORT_DESCRIPTION_MAX}`);
    }
  }
  return problems;
}

export interface ServiceLabelPlanEntry {
  slug: string;
  action: "set" | "skip" | "warn";
  reason?: string;
  id?: string;
  before?: SpecialtyState;
  after?: SpecialtyState;
  changes?: string[];
}

export interface ServiceLabelPlan {
  entries: ServiceLabelPlanEntry[];
  /** Haritada olmayan, aktif, üst seviye ve grubu boş uzmanlıklar ("Other" kalır). */
  otherSlugs: string[];
  cta: { action: "set" | "skip" | "warn"; reason?: string; before?: CtaState; after?: CtaState } | null;
}

function stateOf(row: { name: string; icon: string; serviceGroup: string | null; shortDescription: string | null; translations: unknown }): SpecialtyState {
  return { name: row.name, icon: row.icon, serviceGroup: row.serviceGroup, shortDescription: row.shortDescription, translations: asTranslations(row.translations) };
}

function changedFields(before: SpecialtyState, after: SpecialtyState): string[] {
  const out: string[] = [];
  if (before.name !== after.name) out.push(`ad "${before.name}" -> "${after.name}"`);
  if (before.serviceGroup !== after.serviceGroup) out.push(`grup ${before.serviceGroup ?? "(boş)"} -> ${after.serviceGroup}`);
  if (before.icon !== after.icon) out.push(`ikon ${before.icon} -> ${after.icon}`);
  if (before.shortDescription !== after.shortDescription) out.push("kısa açıklama");
  if (canonical(before.translations) !== canonical(after.translations)) out.push("çeviriler (ad + kısa açıklama, 8 dil)");
  return out;
}

export function desiredCtaState(existingTranslations: unknown): CtaState {
  return { headerCtaLabel: CTA_LABEL.en, headerCtaHref: CTA_HREF, translations: mergeTranslations(existingTranslations, (lang) => ({ headerCtaLabel: CTA_LABEL[lang] })) };
}

export async function buildServiceLabelPlan(db: Db, options: { cta?: boolean } = {}): Promise<ServiceLabelPlan> {
  const problems = validateServiceLabelMap();
  if (problems.length > 0) throw new RenameServiceLabelsError(`Harita geçersiz: ${problems.join("; ")}`);
  const rows = await db.specialty.findMany({ where: { slug: { in: SERVICE_LABEL_MAP.map((e) => e.slug) } } });
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const entries: ServiceLabelPlanEntry[] = SERVICE_LABEL_MAP.map((entry) => {
    const row = bySlug.get(entry.slug);
    if (!row) return { slug: entry.slug, action: "warn", reason: "kayıt bulunamadı" };
    const before = stateOf(row);
    const after = desiredSpecialtyState(entry, row.translations);
    if (sameState(before, after)) return { slug: entry.slug, action: "skip", reason: "zaten güncel", id: row.id };
    return { slug: entry.slug, action: "set", id: row.id, before, after, changes: changedFields(before, after) };
  });
  const mapped = new Set(SERVICE_LABEL_MAP.map((e) => e.slug));
  const others = await db.specialty.findMany({ where: { isActive: true, parentId: null, serviceGroup: null }, select: { slug: true }, orderBy: { order: "asc" } });
  const otherSlugs = others.map((o) => o.slug).filter((s) => !mapped.has(s));

  let cta: ServiceLabelPlan["cta"] = null;
  if (options.cta) {
    const settings = await db.siteSettings.findUnique({ where: { id: "singleton" }, select: { headerCtaLabel: true, headerCtaHref: true, translations: true } });
    if (!settings) cta = { action: "warn", reason: "site ayarı satırı yok; CTA atlandı" };
    else {
      const before: CtaState = { headerCtaLabel: settings.headerCtaLabel, headerCtaHref: settings.headerCtaHref, translations: asTranslations(settings.translations) };
      const after = desiredCtaState(settings.translations);
      const same = before.headerCtaLabel === after.headerCtaLabel && before.headerCtaHref === after.headerCtaHref && canonical(before.translations) === canonical(after.translations);
      cta = same ? { action: "skip", reason: "zaten güncel", before } : { action: "set", before, after };
    }
  }
  return { entries, otherSlugs, cta };
}

export function formatServiceLabelPlan(plan: ServiceLabelPlan): string {
  const lines = plan.entries.map((e) => {
    if (e.action === "set") return `[güncelle] ${e.slug}: ${e.changes!.join("; ")}`;
    if (e.action === "skip") return `[atla] ${e.slug}: ${e.reason}.`;
    return `[uyari] ${e.slug}: ${e.reason}; atlandı.`;
  });
  if (plan.cta) {
    if (plan.cta.action === "set") lines.push(`[güncelle] header CTA: "${plan.cta.before?.headerCtaLabel ?? "(boş)"}" (${plan.cta.before?.headerCtaHref ?? "-"}) -> "${CTA_LABEL.en}" (${CTA_HREF}) + 8 dil etiketi`);
    else lines.push(`[${plan.cta.action === "skip" ? "atla" : "uyari"}] header CTA: ${plan.cta.reason}.`);
  }
  if (!plan.entries.some((e) => e.action === "set") && plan.cta?.action !== "set") lines.push("Güncellenecek kayıt yok.");
  if (plan.otherSlugs.length > 0) lines.push(`[bilgi] haritada olmayan, grubu boş aktif üst uzmanlıklar ("Other" kalır): ${plan.otherSlugs.join(", ")}`);
  return lines.join("\n");
}

export interface ServiceLabelBackup {
  version: 1;
  createdAt: string;
  /** `before`: geri yüklenecek değer; `after`: betiğin yazdığı değer (restore yalnızca satır hâlâ `after` ise geri alır). */
  specialties: { slug: string; id: string; before: SpecialtyState; after: SpecialtyState }[];
  cta: { before: CtaState; after: CtaState } | null;
}

export function buildServiceLabelBackup(plan: ServiceLabelPlan, now = new Date()): ServiceLabelBackup {
  return {
    version: 1,
    createdAt: now.toISOString(),
    specialties: plan.entries.filter((e) => e.action === "set").map((e) => ({ slug: e.slug, id: e.id!, before: e.before!, after: e.after! })),
    cta: plan.cta?.action === "set" ? { before: plan.cta.before!, after: plan.cta.after! } : null,
  };
}

export function parseServiceLabelBackup(raw: string): ServiceLabelBackup {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new RenameServiceLabelsError("Yedek dosyası geçerli JSON değil.");
  }
  const b = data as Partial<ServiceLabelBackup> | null;
  const okState = (s: unknown) => !!s && typeof s === "object" && typeof (s as SpecialtyState).name === "string" && typeof (s as SpecialtyState).icon === "string";
  if (!b || b.version !== 1 || !Array.isArray(b.specialties) || b.specialties.some((e) => typeof e?.id !== "string" || typeof e?.slug !== "string" || !okState(e.before) || !okState(e.after))) {
    throw new RenameServiceLabelsError("Geçersiz yedek dosyası biçimi.");
  }
  return { version: 1, createdAt: String(b.createdAt ?? ""), specialties: b.specialties, cta: b.cta ?? null };
}

export interface ApplyOptions {
  confirm?: string | undefined;
  operator: string;
  osUser: string;
  hostname: string;
  revalidate?: boolean;
}

function assertConfirmed(options: ApplyOptions): void {
  if (options.confirm !== RENAME_SERVICE_LABELS_CONFIRM_KEY) throw new RenameServiceLabelsError(`Gerçek yazma için --confirm=${RENAME_SERVICE_LABELS_CONFIRM_KEY} gerekir.`);
  if (!options.operator.trim()) throw new RenameServiceLabelsError('--operator="Ad Soyad" zorunludur.');
}

function appLike(db: unknown): FastifyInstance {
  const log = { warn: (...a: unknown[]) => console.warn(...a), info: () => {}, error: (...a: unknown[]) => console.error(...a) };
  return { prisma: db, log } as unknown as FastifyInstance;
}

const SERIALIZABLE = { isolationLevel: "Serializable" as const };

function specialtyData(s: SpecialtyState) {
  return { name: s.name, icon: s.icon, serviceGroup: s.serviceGroup, shortDescription: s.shortDescription, translations: s.translations as Json };
}

export async function applyServiceLabelPlan(
  db: Db,
  plan: ServiceLabelPlan,
  options: ApplyOptions
): Promise<{ updated: string[]; ctaUpdated: boolean; skipped: { slug: string; reason: string }[] }> {
  assertConfirmed(options);
  const toSet = plan.entries.filter((e) => e.action === "set");
  const ctaSet = plan.cta?.action === "set";
  const updated: string[] = [];
  const skipped: { slug: string; reason: string }[] = [];
  let ctaUpdated = false;
  if (toSet.length === 0 && !ctaSet) return { updated, ctaUpdated, skipped };
  await db.$transaction(async (tx) => {
    updated.length = 0;
    skipped.length = 0;
    ctaUpdated = false;
    for (const e of toSet) {
      // Plan çıkarıldıktan sonra admin değiştirdiyse onun değişikliği ezilmez.
      const current = await tx.specialty.findUnique({ where: { id: e.id! } });
      if (!current) {
        skipped.push({ slug: e.slug, reason: "kayıt kalmamış" });
        continue;
      }
      if (!sameState(stateOf(current), e.before!)) {
        skipped.push({ slug: e.slug, reason: "plandan sonra değişmiş; yeniden kuru çalıştırın" });
        continue;
      }
      const entry = SERVICE_LABEL_MAP.find((m) => m.slug === e.slug)!;
      await tx.specialty.update({ where: { id: e.id! }, data: specialtyData(desiredSpecialtyState(entry, current.translations)) });
      updated.push(e.slug);
    }
    if (ctaSet) {
      const settings = await tx.siteSettings.findUnique({ where: { id: "singleton" }, select: { translations: true } });
      if (settings) {
        const after = desiredCtaState(settings.translations);
        await tx.siteSettings.update({ where: { id: "singleton" }, data: { headerCtaLabel: after.headerCtaLabel, headerCtaHref: after.headerCtaHref, translations: after.translations as Json } });
        ctaUpdated = true;
      }
    }
    if (updated.length === 0 && !ctaUpdated) return;
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: `script:${options.operator}`,
        action: RENAME_SERVICE_LABELS_AUDIT_ACTION,
        targetType: "Specialty",
        targetId: null,
        metadata: { operator: options.operator, osUser: options.osUser, hostname: options.hostname, slugs: updated, skipped: skipped.map((s) => s.slug), cta: ctaUpdated },
      },
    });
  }, SERIALIZABLE);
  if ((updated.length > 0 || ctaUpdated) && options.revalidate !== false) {
    await triggerTagRevalidation(appLike(db), [CACHE_TAGS.specialties, CACHE_TAGS.doctors, CACHE_TAGS.blog, ...(ctaUpdated ? [CACHE_TAGS.settings] : [])]);
  }
  return { updated, ctaUpdated, skipped };
}

export async function restoreServiceLabels(
  db: Db,
  backup: ServiceLabelBackup,
  options: ApplyOptions
): Promise<{ restored: string[]; ctaRestored: boolean; missing: string[]; skipped: { slug: string; reason: string }[] }> {
  assertConfirmed(options);
  const restored: string[] = [];
  const missing: string[] = [];
  const skipped: { slug: string; reason: string }[] = [];
  let ctaRestored = false;
  await db.$transaction(async (tx) => {
    restored.length = 0;
    missing.length = 0;
    skipped.length = 0;
    ctaRestored = false;
    for (const e of backup.specialties) {
      const current = await tx.specialty.findUnique({ where: { id: e.id } });
      if (!current) {
        missing.push(e.slug);
        continue;
      }
      if (!sameState(stateOf(current), e.after)) {
        skipped.push({ slug: e.slug, reason: "mevcut değerler yedekteki 'yeni' değerlerle eşleşmiyor (sonradan değişmiş)" });
        continue;
      }
      await tx.specialty.update({ where: { id: e.id }, data: specialtyData(e.before) });
      restored.push(e.slug);
    }
    if (backup.cta) {
      const settings = await tx.siteSettings.findUnique({ where: { id: "singleton" }, select: { headerCtaLabel: true, headerCtaHref: true, translations: true } });
      const now: CtaState | null = settings ? { headerCtaLabel: settings.headerCtaLabel, headerCtaHref: settings.headerCtaHref, translations: asTranslations(settings.translations) } : null;
      const a = backup.cta.after;
      if (now && now.headerCtaLabel === a.headerCtaLabel && now.headerCtaHref === a.headerCtaHref && canonical(now.translations) === canonical(a.translations)) {
        const b = backup.cta.before;
        await tx.siteSettings.update({ where: { id: "singleton" }, data: { headerCtaLabel: b.headerCtaLabel, headerCtaHref: b.headerCtaHref, translations: b.translations as Json } });
        ctaRestored = true;
      } else {
        skipped.push({ slug: "(header CTA)", reason: "mevcut CTA yedekteki 'yeni' değerle eşleşmiyor (sonradan değişmiş)" });
      }
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: `script:${options.operator}`,
        action: RENAME_SERVICE_LABELS_RESTORE_AUDIT_ACTION,
        targetType: "Specialty",
        targetId: null,
        metadata: { operator: options.operator, osUser: options.osUser, hostname: options.hostname, restored, missing, skipped: skipped.map((x) => x.slug), cta: ctaRestored },
      },
    });
  }, SERIALIZABLE);
  if ((restored.length > 0 || ctaRestored) && options.revalidate !== false) {
    await triggerTagRevalidation(appLike(db), [CACHE_TAGS.specialties, CACHE_TAGS.doctors, CACHE_TAGS.blog, ...(ctaRestored ? [CACHE_TAGS.settings] : [])]);
  }
  return { restored, ctaRestored, missing, skipped };
}
