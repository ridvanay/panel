import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";

/**
 * Paket Z1 — blog tarihleri SUNUCUDA, sabit saat dilimiyle (UTC) ve Miladi takvimle biçimlenir; istemciye
 * hazır metin gider (Intl/tarih SSR–CSR farkı ve hidrasyon uyuşmazlığı olmaz). `ar-SA` varsayılanı Hicri
 * takvimdir; Miladi zorlanır.
 */
export function formatBlogDate(iso: string | null | undefined, lang: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(contentLocaleToIntl(lang), { dateStyle: "long", timeZone: "UTC", calendar: "gregory" }).format(date);
  } catch {
    return iso.slice(0, 10);
  }
}

/** `{param}` yer tutucularını doldurur (sunucu sözlük yardımcısıyla aynı semantik; client'a sunucu modülü çekmemek için). */
export function fillBlogString(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}
