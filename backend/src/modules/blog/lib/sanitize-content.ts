import { sanitizeRichHtml } from "../../../lib/html-sanitize";

/**
 * §10.5 Çoklu Dil & Yerelleştirme — `translations.<LOCALE>.contentHtml` (varsa) DB'ye yazılmadan
 * ÖNCE AYNI allow-list sanitizer'ından geçirilir; aksi halde `locale=EN` ile public yazı
 * detayında `applyLocale()` üzerinden sanitize edilmemiş HTML sızabilirdi (bkz.
 * blog.routes.ts::applyLocale, ve kanonik `contentHtml` için doğrudan sanitizasyon).
 */
export function sanitizeBlogTranslations(
  translations: Record<string, Record<string, unknown> | null>
): Record<string, Record<string, unknown> | null> {
  return Object.fromEntries(
    Object.entries(translations).map(([locale, fields]) => {
      // §9 backend-agent madde 5 — `null` = bu dilin çevirisini SİL, olduğu gibi geçirilir.
      if (fields === null) return [locale, null];
      if (typeof fields.contentHtml !== "string") return [locale, fields];
      return [locale, { ...fields, contentHtml: sanitizeRichHtml(fields.contentHtml) }];
    })
  );
}
