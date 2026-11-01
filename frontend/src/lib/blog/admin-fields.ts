import type { BlogFaqItem, ContentTranslations } from "@/lib/api/types";

/** Paket Z1 (admin) — okuma süresi önizlemesi; backend `computeReadingMinutes` ile AYNI formül (200 kelime/dk, en az 1). */
export const READING_WORDS_PER_MINUTE = 200;

export function computeReadingMinutes(html: string | null | undefined): number {
  if (!html) return 1;
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ");
  const words = text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  return Math.max(1, Math.ceil(words / READING_WORDS_PER_MINUTE));
}

/** `translations.<dil>.keyTakeaways` — dize dizisi (yoksa boş). */
export function getTranslatedTakeaways(translations: ContentTranslations, locale: string): string[] {
  const value = translations[locale]?.keyTakeaways;
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function getTranslatedFaq(translations: ContentTranslations, locale: string): BlogFaqItem[] {
  const value = translations[locale]?.faq;
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is { question: unknown; answer: unknown } => typeof v === "object" && v !== null)
    .map((v) => ({ question: typeof v.question === "string" ? v.question : "", answer: typeof v.answer === "string" ? v.answer : "" }));
}

/**
 * Dil çevirisine liste yazar; liste boşsa anahtar SİLİNİR (boş dizi göndermek yerine temiz kayıt) ve çeviri
 * nesnesi tamamen boşalırsa o dil girdisi de kaldırılır. Girdi değişmez (yeni nesne döner).
 */
export function setTranslatedList(translations: ContentTranslations, locale: string, key: "keyTakeaways" | "faq", list: unknown[]): ContentTranslations {
  const current = { ...(translations[locale] ?? {}) };
  if (list.length === 0) delete current[key];
  else current[key] = list;
  const next = { ...translations };
  if (Object.keys(current).length === 0) delete next[locale];
  else next[locale] = current;
  return next;
}

/** Gönderimden önce boş satırları ayıklar (yalnızca dolu madde/soru/kaynak gider). */
export function cleanTakeaways(list: string[]): string[] {
  return list.map((v) => v.trim()).filter(Boolean);
}

export function cleanFaq(list: BlogFaqItem[]): BlogFaqItem[] {
  return list.map((v) => ({ question: v.question.trim(), answer: v.answer.trim() })).filter((v) => v.question && v.answer);
}

/** Kayıttan önce çeviri nesnesindeki keyTakeaways/faq listelerinin boş satırlarını ayıklar (diğer alanlara dokunmaz). */
export function cleanTranslationLists(translations: ContentTranslations): ContentTranslations {
  let next = translations;
  for (const locale of Object.keys(translations)) {
    const takeaways = getTranslatedTakeaways(next, locale);
    if (translations[locale]?.keyTakeaways !== undefined) next = setTranslatedList(next, locale, "keyTakeaways", cleanTakeaways(takeaways));
    const faq = getTranslatedFaq(next, locale);
    if (translations[locale]?.faq !== undefined) next = setTranslatedList(next, locale, "faq", cleanFaq(faq));
  }
  return next;
}
