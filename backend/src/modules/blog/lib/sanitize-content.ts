import { sanitizeRichHtml } from "../../../lib/html-sanitize";
import { ValidationError } from "../../../lib/errors";
import { FaqSchema, KeyTakeawaysSchema } from "../blog.schemas";
import { computeReadingMinutes } from "./medical-review";

/**
 * §10.5 Çoklu Dil & Yerelleştirme — `translations.<LOCALE>.contentHtml` (varsa) DB'ye yazılmadan
 * ÖNCE AYNI allow-list sanitizer'ından geçirilir; aksi halde `locale=EN` ile public yazı
 * detayında `applyLocale()` üzerinden sanitize edilmemiş HTML sızabilirdi (bkz.
 * blog.routes.ts::applyLocale, ve kanonik `contentHtml` için doğrudan sanitizasyon).
 *
 * Paket Z1: dil başına `keyTakeaways`/`faq` zod ile doğrulanır (düz metin, sınırlı sayı) ve
 * `contentHtml` varsa o dilin `readingMinutes` değeri otomatik hesaplanır.
 */
export function sanitizeBlogTranslations(
  translations: Record<string, Record<string, unknown> | null>
): Record<string, Record<string, unknown> | null> {
  return Object.fromEntries(
    Object.entries(translations).map(([locale, fields]) => {
      // §9 backend-agent madde 5 — `null` = bu dilin çevirisini SİL, olduğu gibi geçirilir.
      if (fields === null) return [locale, null];
      const next: Record<string, unknown> = { ...fields };

      if (next.keyTakeaways !== undefined) {
        const parsed = KeyTakeawaysSchema.safeParse(next.keyTakeaways);
        if (!parsed.success) {
          throw new ValidationError("Çeviri özet maddeleri geçersiz.", { [`translations.${locale}.keyTakeaways`]: parsed.error.issues.map((i) => i.message) });
        }
        next.keyTakeaways = parsed.data;
      }
      if (next.faq !== undefined) {
        const parsed = FaqSchema.safeParse(next.faq);
        if (!parsed.success) {
          throw new ValidationError("Çeviri SSS alanı geçersiz.", { [`translations.${locale}.faq`]: parsed.error.issues.map((i) => i.message) });
        }
        next.faq = parsed.data;
      }
      if (typeof next.contentHtml === "string") {
        next.contentHtml = sanitizeRichHtml(next.contentHtml);
        next.readingMinutes = computeReadingMinutes(next.contentHtml as string);
      }
      return [locale, next];
    })
  );
}
