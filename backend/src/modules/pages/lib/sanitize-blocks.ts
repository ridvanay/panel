import { sanitizeRichHtml, sanitizeCustomHtmlBlock } from "../../../lib/html-sanitize";
import { MAX_CONTAINER_DEPTH } from "../../../lib/page-blocks";

/**
 * Sayfa builder'ının `blocks` dizisindeki HER `type: "text"` VE `type: "custom-html"` block'unun
 * `data.html` alanını KENDİ paylaşılan allow-list sanitizer'ından (`lib/html-sanitize.ts` —
 * sırasıyla `sanitizeRichHtml`/`sanitizeCustomHtmlBlock`, İKİSİ FARKLI izin listesi) geçirir —
 * DB'ye yazılmadan ÖNCE çağrılmalıdır (bkz. public sitede
 * `frontend/src/components/site/blocks/{text,custom-html}-block.tsx`'in bunu
 * `dangerouslySetInnerHTML` ile DOĞRUDAN render ettiği güvenlik bulgusu).
 *
 * Diğer block türleri (`hero`/`image`/`gallery`/`cta`/`counter`/`testimonial`/`pricing-table`/
 * `latest-posts`/`contact-form` vb.) HTML içermez (bkz. `frontend/src/lib/page-builder/types.ts`)
 * — dokunulmadan olduğu gibi döner. Beklenmedik/bilinmeyen bir şekil (örn. `data.html` string
 * değilse) sessizce atlanır; zod şeması zaten çoğu blok tipini serbest bırakıyor, bu yüzden
 * burada savunmacı davranıyoruz.
 *
 * ---------------------------------------------------------------------------------------------
 * GÜVENLİK DÜZELTMESİ (§10.17.4, stored XSS) — 2026-08-17, backend-agent:
 * Bu fonksiyon ÖNCEDEN yalnızca `blocks.map(...)` ile ÜST SEVİYEYİ dolaşıyordu. §10.17 ile
 * eklenen `type: "columns"` konteyner bloğu, çocuk bloklarını `data.columns[].blocks` içinde
 * TUTAR — bu iç bloklar üst seviye `.map()` döngüsüne HİÇ UĞRAMIYORDU. Sonuç: bir sütunun içine
 * konan `text` bloğunun `data.html`'i `sanitizeRichHtml`'DEN GEÇMEDEN DB'ye yazılıyor ve public
 * sayfada `dangerouslySetInnerHTML` ile OLDUĞU GİBİ basılıyordu → STORED XSS.
 *
 * §10.19 (v3) GÜNCELLEMESİ — hiyerarşik `container` mimarisi (bkz.
 * `.claude/design-notes-page-builder-containers.md` §5.6/§13.5, ZORUNLU/atlanamaz madde):
 * `type: "container"` düğümleri `data.columns[].blocks` YERİNE `children` dizisinde çocuk
 * taşır. Bu dal EKLENMEZSE §10.17.4'teki STORED XSS'İN AYNISI, bu kez `container.children`
 * üzerinden YENİDEN AÇILIR — bir konteynerin içine konan `text` bloğu hiç sanitize edilmeden
 * DB'ye yazılırdı. `type: "columns"` (legacy) dalı da AYNEN KORUNUR — eski `PageRevision`
 * snapshot'ları hâlâ bu şekilde kayıtlı olabilir (bkz. pages.routes.ts:619, restore ENDPOINT'i
 * bu fonksiyonu yeni şemadan HİÇ geçmemiş bir snapshot üzerinde çağırır).
 * ---------------------------------------------------------------------------------------------
 */

/**
 * Savunma amaçlı depth-cutoff (§13.5 — security-agent onayı, ŞARTLI): bu fonksiyon
 * `pages.routes.ts:619`'da bir `PageRevision` SNAPSHOT'ı üzerinde de çağrılır ve o veri YENİ
 * şemadan (dolayısıyla `scanPageNodeStructure`'ın derinlik ≤ `MAX_CONTAINER_DEPTH`
 * garantisinden) HİÇ geçmez — keyfi derinlikte/döngüsel bir snapshot mümkündür. Cutoff, HER
 * çağrının EN BAŞINDA (children üzerinde herhangi bir `.map()`/iterasyon YAPILMADAN ÖNCE)
 * uygulanır — böylece gerçek JS çağrı yığını, veri ne kadar derin/bozuk olursa olsun en fazla
 * `MAX_CONTAINER_DEPTH + 2` kadar büyür (`scanPageNodeStructure`'dan bağımsız, kendi başına
 * stack-safe bir savunma katmanı).
 */
const SANITIZE_DEPTH_CUTOFF = MAX_CONTAINER_DEPTH + 2;

export function sanitizePageBlocks(blocks: unknown[], depth = 1): unknown[] {
  // Depth-cutoff EN BAŞTA — map/iterasyondan ÖNCE (§13.5 zorunlu koşulu).
  if (depth > SANITIZE_DEPTH_CUTOFF) return blocks;
  return blocks.map((block) => sanitizeSinglePageBlock(block, depth));
}

function sanitizeSinglePageBlock(block: unknown, depth: number): unknown {
  if (!block || typeof block !== "object") return block;
  const b = block as Record<string, unknown>;

  if (b.type === "container") {
    if (!Array.isArray(b.children)) return block;
    // ÖZYİNELEME — bu dal olmadan konteyner içi text blokları sanitize edilmeden kalırdı.
    return { ...b, children: sanitizePageBlocks(b.children as unknown[], depth + 1) };
  }

  if (b.type === "columns") {
    if (!b.data || typeof b.data !== "object") return block;
    const data = b.data as Record<string, unknown>;
    if (!Array.isArray(data.columns)) return block;

    const sanitizedColumns = data.columns.map((column) => {
      if (!column || typeof column !== "object") return column;
      const col = column as Record<string, unknown>;
      if (!Array.isArray(col.blocks)) return column;
      // ÖZYİNELEME — bu satır olmadan sütun içi text blokları sanitize edilmeden kalırdı.
      return { ...col, blocks: sanitizePageBlocks(col.blocks as unknown[], depth + 1) };
    });

    return { ...b, data: { ...data, columns: sanitizedColumns } };
  }

  // §Faz 4 "Dinamik & CMS İçerikleri" — Özel HTML / Kod Bloğu. `text` bloğuyla AYNI çift-yollu
  // (container/columns özyinelemesi + üst seviye `.map()`) risk BURADA DA geçerli — bu dal
  // eksik bırakılırsa bir konteynerin/sütunun İÇİNE konan `custom-html` bloğu `sanitizeCustomHtmlBlock`'DAN
  // GEÇMEDEN DB'ye yazılır ve public sayfada `dangerouslySetInnerHTML` ile OLDUĞU GİBİ basılırdı
  // (§10.17.4'teki stored-XSS bulgusunun AYNISI, yeni blok tipiyle YENİDEN AÇILIRDI).
  if (b.type === "custom-html") {
    if (!b.data || typeof b.data !== "object") return block;
    const data = b.data as Record<string, unknown>;
    if (typeof data.html !== "string") return block;
    return { ...b, data: { ...data, html: sanitizeCustomHtmlBlock(data.html) } };
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
