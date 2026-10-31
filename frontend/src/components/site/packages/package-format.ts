import type { PackageCategory } from "@/lib/api/types";
import type { PackagesStrings } from "@/lib/i18n/site-dictionaries/en/packages";

const CATEGORY_KEYS: Record<PackageCategory, keyof PackagesStrings> = {
  "check-up": "categoryCheckUp",
  aesthetic: "categoryAesthetic",
  wellness: "categoryWellness",
  longevity: "categoryLongevity",
  dental: "categoryDental",
  women: "categoryWomen",
  men: "categoryMen",
  other: "categoryOther",
};

export function categoryLabel(t: PackagesStrings, category: PackageCategory): string {
  return t[CATEGORY_KEYS[category]];
}

/** `{ from: 1200, currency: "EUR" }` → "€1,200" (aktif dilin sayı biçimiyle). Geçersiz para birimi kodunda ham biçim. */
export function formatPackagePrice(price: { from: number; currency: string }, intlLocale: string): string {
  try {
    return new Intl.NumberFormat(intlLocale, { style: "currency", currency: price.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(price.from);
  } catch {
    return `${price.from} ${price.currency}`;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** İki tarih alanı → "YYYY-MM-DD – YYYY-MM-DD" (en çok 100 karakter); yalnızca biri doluysa tek tarih; ikisi de boşsa undefined. */
export function buildPreferredDates(from: string, to: string): string | undefined {
  const a = ISO_DATE.test(from) ? from : "";
  const b = ISO_DATE.test(to) ? to : "";
  if (a && b) return a <= b ? `${a} – ${b}` : `${b} – ${a}`;
  return a || b || undefined;
}

/** `{name}` yer tutucularını doldurur (site sözlüğü indeksini istemci paketine çekmemek için yerel kopya). */
export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}
