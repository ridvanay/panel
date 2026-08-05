import { sanitizeRichHtml } from "../../../lib/html-sanitize";

/**
 * §10.5 Çoklu Dil & Yerelleştirme — `translations.<LOCALE>.contentHtml` (varsa) DB'ye yazılmadan
 * ÖNCE AYNI allow-list sanitizer'ından geçirilir; aksi halde `locale=EN` ile public yazı
 * detayında `applyLocale()` üzerinden sanitize edilmemiş HTML sızabilirdi (bkz.
 * blog.routes.ts::applyLocale, ve kanonik `contentHtml` için doğrudan sanitizasyon).
 */
export function sanitizeBlogTranslations(
  translations: Record<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(translations).map(([locale, fields]) => {
      if (typeof fields.contentHtml !== "string") return [locale, fields];
      return [locale, { ...fields, contentHtml: sanitizeRichHtml(fields.contentHtml) }];
    })
  );
}
