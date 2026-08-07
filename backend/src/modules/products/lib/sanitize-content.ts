import { sanitizeRichHtml } from "../../../lib/html-sanitize";

/**
 * §10.5 Çoklu Dil & Yerelleştirme — `translations.<LOCALE>.descriptionHtml` (varsa) DB'ye
 * yazılmadan ÖNCE AYNI allow-list sanitizer'ından geçirilir — `modules/blog/lib/sanitize-content.ts
 * ::sanitizeBlogTranslations` İLE BİREBİR AYNI patern, yalnızca alan adı `contentHtml` yerine
 * `descriptionHtml`'dir (bkz. products.routes.ts, prisma/schema.prisma::Product.translations).
 */
export function sanitizeProductTranslations(
  translations: Record<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(translations).map(([locale, fields]) => {
      if (typeof fields.descriptionHtml !== "string") return [locale, fields];
      return [locale, { ...fields, descriptionHtml: sanitizeRichHtml(fields.descriptionHtml) }];
    })
  );
}
