import type { FastifyInstance } from "fastify";
import { SETTINGS_ID } from "../../settings/settings.routes";

/**
 * Bir slider'ın hangi sayfalarda (`Page.blocks` içinde `advanced-slider` bloğu olarak)
 * kullanıldığını tarayan mantık — bkz. `.claude/architect-scope-advanced-slider.md` §4.3
 * ve openapi.yaml `GET /admin/sliders/{sliderId}/usage` açıklaması.
 *
 * İKİ AŞAMALI:
 * (1) Postgres `blocks::text ILIKE '%<uuid>%'` — YALNIZCA ADAY DARALTMA. Ham `LIKE`
 *     sonucuna GÜVENİLMEZ (ör. `sliderId` başka bir alanda/metinde de geçebilir), yalnızca
 *     tüm `pages` tablosunu tek tek uygulama içinde taramaktan kaçınmak için kullanılır.
 * (2) Aday sayfaların `blocks` ağacı, İTERATİF (explicit stack, ÖZYİNELEME YOK) olarak
 *     taranır — `lib/page-blocks.ts::scanPageNodeStructure` ile AYNI yaklaşım/güvenlik
 *     gerekçesi (zaten şemadan geçmiş/normalize edilmiş veri olsa da, tarihsel kayıtlara
 *     karşı defense-in-depth).
 */

export interface SliderUsageEntry {
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  blockId: string;
  isHomePage: boolean;
  pageDeletedAt: string | null;
}

/** Patolojik/elle üretilmiş girdide döngünün mutlak tavanı (bkz. lib/page-blocks.ts::ABSOLUTE_VISIT_CAP). */
const ABSOLUTE_VISIT_CAP = 100_000;

/**
 * Tek bir sayfanın `blocks` ağacında, `type: "advanced-slider"` VE `data.sliderId ===
 * sliderId` olan düğümlerin `id`'lerini döner. İTERATİF (explicit stack) — özyineleme YOK.
 * Yalnızca kanonik `container.children` içine iner (advanced-slider bloğu bu özellik
 * yayına girdiğinde zaten yalnızca kanonik `container` ağacına yazılabiliyordu, legacy
 * `columns` şekliyle asla üretilmedi — bkz. pages.schemas.ts::legacyColumnsToContainer).
 */
function findAdvancedSliderBlockIds(blocksRaw: unknown, sliderId: string): string[] {
  if (!Array.isArray(blocksRaw)) return [];

  const result: string[] = [];
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
        result.push(n.id);
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
    const blockIds = findAdvancedSliderBlockIds(page.blocks, sliderId);
    for (const blockId of blockIds) {
      usage.push({
        pageId: page.id,
        pageTitle: page.title,
        pageSlug: page.slug,
        blockId,
        isHomePage: homePageId !== null && homePageId === page.id,
        pageDeletedAt: page.deletedAt ? page.deletedAt.toISOString() : null,
      });
    }
  }

  return usage;
}
