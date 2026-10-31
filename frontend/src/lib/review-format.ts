import type { ReviewItem } from "@/lib/api/types";

/** `anonymous` ya da boş `authorDisplay` → `null` (çağıran sözlükteki "Anonim hasta" metnini gösterir). */
export function reviewAuthorName(review: Pick<ReviewItem, "authorDisplay" | "displayMode">): string | null {
  if (review.displayMode === "anonymous") return null;
  const name = review.authorDisplay?.trim();
  return name ? name : null;
}

/** ISO-2 ülke kodu → aktif dilde ülke adı; çözülemezse kodun kendisi. */
export function countryName(code: string | null, intlLocale: string): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames([intlLocale], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** ISO-639 dil kodu → aktif dilde dil adı; çözülemezse büyük harfli kod. */
export function languageName(code: string, intlLocale: string): string {
  try {
    return new Intl.DisplayNames([intlLocale], { type: "language" }).of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export function formatReviewDate(iso: string, intlLocale: string): string {
  try {
    return new Intl.DateTimeFormat(intlLocale, { year: "numeric", month: "long", day: "numeric" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** `{name}` yer tutucularını doldurur. "use client" dışındadır: sunucu ve istemci bileşenleri ortak kullanır. */
export function fillReview(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
