import { sanitizeRichHtml } from "../../../lib/html-sanitize";

/**
 * Sayfa builder'ının `blocks` dizisindeki HER `type: "text"` block'unun `data.html` alanını
 * paylaşılan allow-list sanitizer'ından (`lib/html-sanitize.ts`) geçirir — DB'ye yazılmadan ÖNCE
 * çağrılmalıdır (bkz. public sitede `frontend/src/components/site/blocks/text-block.tsx`'in bunu
 * `dangerouslySetInnerHTML` ile DOĞRUDAN render ettiği güvenlik bulgusu).
 *
 * Diğer block türleri (`hero`/`image`/`gallery`/`cta`) HTML içermez (bkz.
 * `frontend/src/lib/page-builder/types.ts`) — dokunulmadan olduğu gibi döner. Beklenmedik/bilinmeyen
 * bir şekil (örn. `data.html` string değilse) sessizce atlanır; zod şeması zaten `blocks`'u
 * `z.record(z.unknown())[]` olarak serbest bırakıyor, bu yüzden burada savunmacı davranıyoruz.
 */
export function sanitizePageBlocks(blocks: unknown[]): unknown[] {
  return blocks.map((block) => {
    if (!block || typeof block !== "object") return block;
    const b = block as Record<string, unknown>;
    if (b.type !== "text") return block;
    if (!b.data || typeof b.data !== "object") return block;
    const data = b.data as Record<string, unknown>;
    if (typeof data.html !== "string") return block;

    return { ...b, data: { ...data, html: sanitizeRichHtml(data.html) } };
  });
}

/**
 * §10.5 Çoklu Dil & Yerelleştirme — `translations.<LOCALE>.blocks` (varsa) da AYNI şekilde
 * sanitize edilir; aksi halde `locale=EN` ile public sayfada `applyLocale()` üzerinden
 * sanitize edilmemiş HTML sızabilirdi (bkz. pages.routes.ts::applyLocale).
 */
export function sanitizePageTranslations(
  translations: Record<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(translations).map(([locale, fields]) => {
      if (!Array.isArray(fields.blocks)) return [locale, fields];
      return [locale, { ...fields, blocks: sanitizePageBlocks(fields.blocks) }];
    })
  );
}
