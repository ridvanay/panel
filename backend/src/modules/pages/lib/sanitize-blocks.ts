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
 *
 * ---------------------------------------------------------------------------------------------
 * GÜVENLİK DÜZELTMESİ (§10.17.4, stored XSS) — 2026-08-17, backend-agent:
 * Bu fonksiyon ÖNCEDEN yalnızca `blocks.map(...)` ile ÜST SEVİYEYİ dolaşıyordu. §10.17 ile
 * eklenen `type: "columns"` konteyner bloğu, çocuk bloklarını `data.columns[].blocks` içinde
 * TUTAR — bu iç bloklar üst seviye `.map()` döngüsüne HİÇ UĞRAMIYORDU. Sonuç: bir sütunun içine
 * konan `text` bloğunun `data.html`'i `sanitizeRichHtml`'DEN GEÇMEDEN DB'ye yazılıyor ve public
 * sayfada `dangerouslySetInnerHTML` ile OLDUĞU GİBİ basılıyordu → STORED XSS (kötü niyetli/ele
 * geçirilmiş bir EDITOR hesabı sütun içine `<script>`/`onerror=` payload'ı yerleştirip TÜM
 * ziyaretçileri etkileyebilirdi).
 *
 * Düzeltme: `sanitizePageBlocks` artık `type === "columns"` bloklarında her sütunun `blocks`
 * dizisini AYNI fonksiyondan (özyinelemeli) geçirir. Şema derinliği en fazla 1 ile sınırlı olsa
 * da (bir sütunun içine `columns` KONULAMAZ, bkz. `pages.schemas.ts::ColumnsBlockSchema`) bu
 * fonksiyon savunma amaçlı genel/özyinelemeli yazılmıştır.
 * ---------------------------------------------------------------------------------------------
 */
export function sanitizePageBlocks(blocks: unknown[]): unknown[] {
  return blocks.map(sanitizeSinglePageBlock);
}

function sanitizeSinglePageBlock(block: unknown): unknown {
  if (!block || typeof block !== "object") return block;
  const b = block as Record<string, unknown>;

  if (b.type === "columns") {
    if (!b.data || typeof b.data !== "object") return block;
    const data = b.data as Record<string, unknown>;
    if (!Array.isArray(data.columns)) return block;

    const sanitizedColumns = data.columns.map((column) => {
      if (!column || typeof column !== "object") return column;
      const col = column as Record<string, unknown>;
      if (!Array.isArray(col.blocks)) return column;
      // ÖZYİNELEME — bu satır olmadan sütun içi text blokları sanitize edilmeden kalırdı.
      return { ...col, blocks: sanitizePageBlocks(col.blocks) };
    });

    return { ...b, data: { ...data, columns: sanitizedColumns } };
  }

  if (b.type !== "text") return block;
  if (!b.data || typeof b.data !== "object") return block;
  const data = b.data as Record<string, unknown>;
  if (typeof data.html !== "string") return block;

  return { ...b, data: { ...data, html: sanitizeRichHtml(data.html) } };
}

/**
 * §10.5 Çoklu Dil & Yerelleştirme — `translations.<LOCALE>.blocks` (varsa) da AYNI şekilde
 * sanitize edilir; aksi halde `locale=EN` ile public sayfada `applyLocale()` üzerinden
 * sanitize edilmemiş HTML sızabilirdi (bkz. pages.routes.ts::applyLocale).
 */
export function sanitizePageTranslations(
  translations: Record<string, Record<string, unknown> | null>
): Record<string, Record<string, unknown> | null> {
  return Object.fromEntries(
    Object.entries(translations).map(([locale, fields]) => {
      // §9 backend-agent madde 5 — `null` = bu dilin çevirisini SİL; sanitize edilecek
      // içerik yok, olduğu gibi geçirilir (bkz. lib/localization.ts::mergeTranslations).
      if (fields === null) return [locale, null];
      if (!Array.isArray(fields.blocks)) return [locale, fields];
      return [locale, { ...fields, blocks: sanitizePageBlocks(fields.blocks) }];
    })
  );
}
