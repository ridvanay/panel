import type { FastifyInstance } from "fastify";
import { SETTINGS_ID } from "../../settings/settings.routes";

/**
 * Bir slider'ın hangi sayfalarda kullanıldığını tarayan mantık — bkz.
 * `.claude/architect-scope-advanced-slider.md` §4.3, §9.2.7 ve openapi.yaml
 * `GET /admin/sliders/{sliderId}/usage` açıklaması. İki referans TÜRÜ vardır
 * (`SliderUsageType`): (1) `Page.blocks` içinde bir `advanced-slider` düğümü
 * (`data.sliderId` eşleşmesi) → `usageType: "block"`; (2) bir `text`/`custom-html`
 * düğümünün `data.html`'ine gömülü `[slider id="<uuid>"]` kısa kodu (bkz. frontend
 * `lib/sliders/shortcode.ts::SLIDER_SHORTCODE_RE` ile BİREBİR AYNI desen) →
 * `usageType: "shortcode"`.
 *
 * İKİ AŞAMALI:
 * (1) Postgres `blocks::text ILIKE '%<uuid>%'` — YALNIZCA ADAY DARALTMA. Ham `LIKE`
 *     sonucuna GÜVENİLMEZ (ör. `sliderId` başka bir alanda/metinde de geçebilir), yalnızca
 *     tüm `pages` tablosunu tek tek uygulama içinde taramaktan kaçınmak için kullanılır.
 *     Kısa kod da uuid'yi `blocks::text` içinde taşıdığı için bu ön filtre İKİ türü de yakalar
 *     — DEĞİŞMEZ (§9.2.7).
 * (2) Aday sayfaların `blocks` ağacı, İTERATİF (explicit stack, ÖZYİNELEME YOK) olarak
 *     taranır — `lib/page-blocks.ts::scanPageNodeStructure` ile AYNI yaklaşım/güvenlik
 *     gerekçesi (zaten şemadan geçmiş/normalize edilmiş veri olsa da, tarihsel kayıtlara
 *     karşı defense-in-depth).
 *
 * Kapsam sınırı (bağlayıcı, §9.2.7): tarama YALNIZCA `pages` tablosunu kapsar.
 * `BlogPost.contentHtml`/`PortfolioItem.contentHtml`/`Product.descriptionHtml` bu
 * taramanın DIŞINDADIR.
 */

export interface SliderUsageEntry {
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  blockId: string;
  usageType: "block" | "shortcode";
  isHomePage: boolean;
  pageDeletedAt: string | null;
}

/** Patolojik/elle üretilmiş girdide döngünün mutlak tavanı (bkz. lib/page-blocks.ts::ABSOLUTE_VISIT_CAP). */
const ABSOLUTE_VISIT_CAP = 100_000;

/**
 * Kısa kod deseni — frontend `frontend/src/lib/sliders/shortcode.ts::SLIDER_SHORTCODE_RE`
 * ile BİREBİR AYNI (§2.6/§9.2.3 disiplini: aynı desen birden fazla yerde tanımlanabilir ama
 * BİREBİR aynı kalmak zorundadır, kopyalanıp ayrışması YASAK). Açılış/kapanış tırnağı AYNI
 * olmak zorunda (`\1` geri referansı); dört tırnak varyantı (`"`, `'`, `&quot;`, `&#39;`)
 * kabul edilir.
 */
const SHORTCODE_QUOTE = `"|'|&quot;|&#39;`;
const SHORTCODE_UUID = `[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`;
export const SLIDER_SHORTCODE_RE = new RegExp(
  `\\[slider\\s+id\\s*=\\s*(${SHORTCODE_QUOTE})(${SHORTCODE_UUID})\\1\\s*\\]`,
  "g"
);

export interface SliderReference {
  blockId: string;
  usageType: "block" | "shortcode";
}

/**
 * Tek bir sayfanın `blocks` ağacında, bu slider'a referans veren düğümleri döner. İTERATİF
 * (explicit stack) — özyineleme YOK. Yalnızca kanonik `container.children` içine iner
 * (advanced-slider bloğu bu özellik yayına girdiğinde zaten yalnızca kanonik `container`
 * ağacına yazılabiliyordu, legacy `columns` şekliyle asla üretilmedi — bkz.
 * pages.schemas.ts::legacyColumnsToContainer).
 *
 * `type === "advanced-slider"` düğümlerinde `data.sliderId` eşleşirse `usageType: "block"`;
 * `type === "text" || type === "custom-html"` düğümlerinde `data.html` içinde
 * `SLIDER_SHORTCODE_RE` ile bu slider'a ait bir kısa kod bulunursa `usageType: "shortcode"`
 * (§9.2.7). `String.prototype.matchAll` global regex'i spec gereği İÇSEL OLARAK klonlar,
 * bu yüzden `SLIDER_SHORTCODE_RE.lastIndex` çağrılar arasında SIZINTI yapmaz.
 */
export function findSliderReferences(blocksRaw: unknown, sliderId: string): SliderReference[] {
  if (!Array.isArray(blocksRaw)) return [];

  const result: SliderReference[] = [];
  const stack: unknown[] = [...blocksRaw];
  let visits = 0;

  while (stack.length > 0) {
    if (++visits > ABSOLUTE_VISIT_CAP) break;

    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;

    if (n.type === "advanced-slider" && typeof n.id === "string") {
      const data = n.data && typeof n.data === "object" ? (n.data as Record<string, unknown>) : undefined;
      if (data && data.sliderId === sliderId) {
        result.push({ blockId: n.id, usageType: "block" });
      }
      continue;
    }

    if ((n.type === "text" || n.type === "custom-html") && typeof n.id === "string") {
      const data = n.data && typeof n.data === "object" ? (n.data as Record<string, unknown>) : undefined;
      const html = data?.html;
      if (typeof html === "string") {
        for (const match of html.matchAll(SLIDER_SHORTCODE_RE)) {
          if (match[2] === sliderId) {
            result.push({ blockId: n.id, usageType: "shortcode" });
            break; // Aynı blokta aynı slider'a birden fazla kısa kod olsa da TEK kayıt yeterli.
          }
        }
      }
      continue;
    }

    if (n.type === "container" && Array.isArray(n.children)) {
      for (const child of n.children) stack.push(child);
    }
  }

  return result;
}

/**
 * `GET /admin/sliders/{sliderId}/usage` ve `DELETE /admin/sliders/{sliderId}` (`409`
 * gövdesi) tarafından paylaşılan ana bulucu.
 */
export async function findSliderUsage(app: FastifyInstance, sliderId: string): Promise<SliderUsageEntry[]> {
  // (1) Aday daraltma — kullanıcı girdisi (`sliderId`) Prisma'nın tagged-template
  // parametrizasyonuyla (Prisma.sql/$queryRaw interpolasyonu) GÜVENLE bağlanır, ham string
  // birleştirme (`$queryRawUnsafe`) KULLANILMAZ.
  const candidates = await app.prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM pages WHERE blocks::text ILIKE ${"%" + sliderId + "%"}
  `;
  if (candidates.length === 0) return [];

  const [pages, settings] = await Promise.all([
    app.prisma.page.findMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      select: { id: true, title: true, slug: true, blocks: true, deletedAt: true },
    }),
    app.prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID }, select: { homePageId: true } }),
  ]);

  const homePageId = settings?.homePageId ?? null;
  const usage: SliderUsageEntry[] = [];

  for (const page of pages) {
    const references = findSliderReferences(page.blocks, sliderId);
    for (const reference of references) {
      usage.push({
        pageId: page.id,
        pageTitle: page.title,
        pageSlug: page.slug,
        blockId: reference.blockId,
        usageType: reference.usageType,
        isHomePage: homePageId !== null && homePageId === page.id,
        pageDeletedAt: page.deletedAt ? page.deletedAt.toISOString() : null,
      });
    }
  }

  return usage;
}
