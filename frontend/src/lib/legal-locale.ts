/**
 * Paket L (2026-10-23) — yasal sayfaların (`isLegalDocument`) dile göre gösterimi. Bağlayıcı
 * sürümler Türkçe ve İngilizcedir: bu dillerde çeviri yoksa §5.1 bildirimi (gövde boş) gösterilir;
 * diğer dillerde (es/de/ar/ru…) kanonik metne düşülür ve başta "bağlayıcı sürümler TR ve EN" notu
 * yer alır. Backend karşılığı: `pages.routes.ts::LEGAL_BINDING_LOCALES` (aynı küme).
 */
export const LEGAL_BINDING_LOCALES: readonly string[] = ["tr", "en"];

export type LegalDisplayMode = "content" | "notice" | "binding-fallback";

export function legalDisplayMode(input: {
  isLegalDocument: boolean;
  lang: string;
  defaultLocaleCode: string | undefined;
  translated: boolean | undefined;
}): LegalDisplayMode {
  if (!input.isLegalDocument || input.lang === input.defaultLocaleCode || input.translated !== false) return "content";
  return LEGAL_BINDING_LOCALES.includes(input.lang) ? "notice" : "binding-fallback";
}
