import type { Media } from "@/lib/api/types";
import type {
  AdminCover,
  AdminDestination,
  AdminPackage,
  DestinationInput,
  PackageCategory,
  PackageFaqItem,
  PackageInput,
} from "@/lib/api/admin-packages";

/** Paket X — paket ve destinasyon formlarının saf (React'siz) yardımcıları; sözleşme gövdesini üretir ve istemci doğrulamasını yapar. */

export const MAX_TOP_TREATMENTS = 3;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CURRENCY_RE = /^[A-Za-z]{3}$/;

export function linesToArray(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function arrayToLines(items: string[] | undefined): string {
  return (items ?? []).join("\n");
}

/** `MediaSelectField` bir `Media` bekler; yanıttaki kapaktan asgari önizleme nesnesi üretir. */
export function coverAsMedia(coverMediaId: string | null | undefined, cover: AdminCover | null | undefined): Media | null {
  if (!coverMediaId || !cover?.url) return null;
  return {
    id: coverMediaId,
    url: cover.url,
    filename: "",
    mimeType: "",
    sizeBytes: 0,
    altText: cover.alt ?? null,
    width: cover.width ?? null,
    height: cover.height ?? null,
    folderId: null,
    createdAt: "",
  } as Media;
}

function parsePrice(raw: string): number | null | "invalid" {
  const v = raw.trim().replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
}

function parseSort(raw: string): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

// ---------- Paket ----------

export interface PackageLocaleForm {
  title: string;
  summary: string;
  includes: string;
  notIncluded: string;
  duration: string;
  idealFor: string;
  faq: PackageFaqItem[];
}

export interface PackageFormState {
  slug: string;
  category: PackageCategory;
  cover: Media | null;
  locales: Record<string, PackageLocaleForm>;
  priceFrom: string;
  currency: string;
  showPrice: boolean;
  specialtyIds: string[];
  doctorIds: string[];
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: string;
}

export const emptyPackageLocale = (): PackageLocaleForm => ({ title: "", summary: "", includes: "", notIncluded: "", duration: "", idealFor: "", faq: [] });

export function emptyPackageForm(): PackageFormState {
  return {
    slug: "",
    category: "check-up",
    cover: null,
    locales: {},
    priceFrom: "",
    currency: "EUR",
    showPrice: false,
    specialtyIds: [],
    doctorIds: [],
    isActive: false,
    isFeatured: false,
    sortOrder: "0",
  };
}

export function packageToForm(pkg: AdminPackage): PackageFormState {
  const locales: Record<string, PackageLocaleForm> = {};
  for (const [code, t] of Object.entries(pkg.translations ?? {})) {
    locales[code] = {
      title: t.title ?? "",
      summary: t.summary ?? "",
      includes: arrayToLines(t.includes),
      notIncluded: arrayToLines(t.notIncluded),
      duration: t.duration ?? "",
      idealFor: t.idealFor ?? "",
      faq: (t.faq ?? []).map((f) => ({ question: f.question, answer: f.answer })),
    };
  }
  return {
    slug: pkg.slug,
    category: pkg.category,
    cover: coverAsMedia(pkg.coverMediaId, pkg.cover),
    locales,
    priceFrom: pkg.priceFrom == null ? "" : String(pkg.priceFrom),
    currency: pkg.currency || "EUR",
    showPrice: pkg.showPrice,
    specialtyIds: [...(pkg.relatedSpecialtyIds ?? [])],
    doctorIds: [...(pkg.relatedDoctorIds ?? [])],
    isActive: pkg.isActive,
    isFeatured: pkg.isFeatured,
    sortOrder: String(pkg.sortOrder ?? 0),
  };
}

function localeHasContent(l: PackageLocaleForm): boolean {
  return Boolean(
    l.title.trim() ||
      l.summary.trim() ||
      l.includes.trim() ||
      l.notIncluded.trim() ||
      l.duration.trim() ||
      l.idealFor.trim() ||
      l.faq.some((f) => f.question.trim() || f.answer.trim()),
  );
}

export function validatePackageForm(form: PackageFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!SLUG_RE.test(form.slug.trim())) errors.slug = "Slug küçük harf, rakam ve tire içermelidir (ör. executive-check-up).";
  if (!form.locales.en?.title.trim()) errors.title = "EN (kanonik) sekmesinde paket başlığı gerekli.";
  const price = parsePrice(form.priceFrom);
  if (price === "invalid") errors.priceFrom = "Geçerli bir tutar girin.";
  else if (form.showPrice && price === null) errors.priceFrom = "Fiyat gösterimi açıkken “başlangıç fiyatı” zorunludur.";
  if (!CURRENCY_RE.test(form.currency.trim())) errors.currency = "3 harfli para birimi kodu girin (ör. EUR).";
  return errors;
}

export function buildPackageBody(form: PackageFormState): PackageInput {
  const translations: PackageInput["translations"] = {};
  for (const [code, l] of Object.entries(form.locales)) {
    if (!localeHasContent(l)) continue;
    translations[code] = {
      title: l.title.trim(),
      summary: l.summary.trim(),
      includes: linesToArray(l.includes),
      notIncluded: linesToArray(l.notIncluded),
      duration: l.duration.trim(),
      idealFor: l.idealFor.trim(),
      faq: l.faq
        .map((f) => ({ question: f.question.trim(), answer: f.answer.trim() }))
        .filter((f) => f.question && f.answer),
    };
  }
  const price = parsePrice(form.priceFrom);
  return {
    slug: form.slug.trim(),
    category: form.category,
    coverMediaId: form.cover?.id ?? null,
    translations,
    priceFrom: price === "invalid" ? null : price,
    currency: form.currency.trim().toUpperCase(),
    showPrice: form.showPrice,
    relatedSpecialtyIds: form.specialtyIds,
    relatedDoctorIds: form.doctorIds,
    isActive: form.isActive,
    isFeatured: form.isFeatured,
    sortOrder: parseSort(form.sortOrder),
  };
}

// ---------- Destinasyon ----------

export interface DestinationLocaleForm {
  title: string;
  summary: string;
  highlights: string;
}

export interface TreatmentForm {
  label: Record<string, string>;
  priceFrom: string;
  currency: string;
}

export interface DestinationFormState {
  slug: string;
  city: string;
  cover: Media | null;
  locales: Record<string, DestinationLocaleForm>;
  treatments: TreatmentForm[];
  patientCount: string;
  dataPeriodLabel: string;
  showPrices: boolean;
  isActive: boolean;
  sortOrder: string;
}

export function emptyDestinationForm(): DestinationFormState {
  return {
    slug: "",
    city: "",
    cover: null,
    locales: {},
    treatments: [],
    patientCount: "",
    dataPeriodLabel: "",
    showPrices: false,
    isActive: false,
    sortOrder: "0",
  };
}

export function destinationToForm(d: AdminDestination): DestinationFormState {
  const locales: Record<string, DestinationLocaleForm> = {};
  for (const [code, t] of Object.entries(d.translations ?? {})) {
    locales[code] = { title: t.title ?? "", summary: t.summary ?? "", highlights: arrayToLines(t.highlights) };
  }
  return {
    slug: d.slug,
    city: d.city,
    cover: coverAsMedia(d.coverMediaId, d.cover),
    locales,
    treatments: (d.topTreatments ?? []).slice(0, MAX_TOP_TREATMENTS).map((t) => ({
      label: { ...t.label },
      priceFrom: t.priceFrom == null ? "" : String(t.priceFrom),
      currency: t.currency || "EUR",
    })),
    patientCount: d.patientCountLastYear == null ? "" : String(d.patientCountLastYear),
    dataPeriodLabel: d.dataPeriodLabel ?? "",
    showPrices: d.showPrices,
    isActive: d.isActive,
    sortOrder: String(d.sortOrder ?? 0),
  };
}

/** En çok 3 tedavi: sınırı aşan ekleme yok sayılır. */
export function addTreatment(treatments: TreatmentForm[]): TreatmentForm[] {
  if (treatments.length >= MAX_TOP_TREATMENTS) return treatments;
  return [...treatments, { label: {}, priceFrom: "", currency: "EUR" }];
}

export function validateDestinationForm(form: DestinationFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.city.trim()) errors.city = "Şehir adı gerekli.";
  if (!SLUG_RE.test(form.slug.trim())) errors.slug = "Slug küçük harf, rakam ve tire içermelidir (ör. istanbul).";
  if (!form.locales.en?.title.trim()) errors.title = "EN (kanonik) sekmesinde başlık gerekli.";
  if (form.treatments.length > MAX_TOP_TREATMENTS) errors.treatments = `En çok ${MAX_TOP_TREATMENTS} tedavi eklenebilir.`;
  if (form.patientCount.trim() && !/^\d+$/.test(form.patientCount.trim())) errors.patientCount = "Hasta sayısı tam sayı olmalıdır (boş bırakılabilir).";
  for (const t of form.treatments) {
    if (parsePrice(t.priceFrom) === "invalid") errors.treatments = "Tedavi fiyatları geçerli bir tutar olmalıdır.";
  }
  return errors;
}

export function buildDestinationBody(form: DestinationFormState): DestinationInput {
  const translations: DestinationInput["translations"] = {};
  for (const [code, l] of Object.entries(form.locales)) {
    if (!l.title.trim() && !l.summary.trim() && !l.highlights.trim()) continue;
    translations[code] = { title: l.title.trim(), summary: l.summary.trim(), highlights: linesToArray(l.highlights) };
  }
  const topTreatments = form.treatments
    .slice(0, MAX_TOP_TREATMENTS)
    .map((t) => {
      const label: Record<string, string> = {};
      for (const [code, v] of Object.entries(t.label)) if (v.trim()) label[code] = v.trim();
      const price = parsePrice(t.priceFrom);
      return { label, priceFrom: price === "invalid" ? null : price, currency: t.currency.trim().toUpperCase() || "EUR" };
    })
    .filter((t) => Object.keys(t.label).length > 0);
  return {
    slug: form.slug.trim(),
    city: form.city.trim(),
    coverMediaId: form.cover?.id ?? null,
    translations,
    topTreatments,
    patientCountLastYear: form.patientCount.trim() ? Number(form.patientCount.trim()) : null,
    dataPeriodLabel: form.dataPeriodLabel.trim() || null,
    showPrices: form.showPrices,
    isActive: form.isActive,
    sortOrder: parseSort(form.sortOrder),
  };
}
