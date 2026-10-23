/**
 * Paket L (2026-10-23) — içerik dilinin (`Locale.code`, `[lang]`) yazı yönü. Sağdan sola yazılan
 * diller `dir="rtl"` alır; bölge alt etiketi (ör. "ar-sa") yok sayılır. Admin paneli bu kapsamda
 * DEĞİL (TR/EN, her zaman `ltr`).
 */
const RTL_LANGUAGES = new Set(["ar", "fa", "he", "ur"]);

export type TextDirection = "ltr" | "rtl";

export function localeDirection(code: string | null | undefined): TextDirection {
  const base = (code ?? "").toLowerCase().split("-")[0] ?? "";
  return RTL_LANGUAGES.has(base) ? "rtl" : "ltr";
}
