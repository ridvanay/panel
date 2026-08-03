import { Prisma, type PrismaClient } from "@prisma/client";
import type { ContentCountsDto } from "../schemas/entities";

/**
 * §10.7 İçerik Yönetim Listesi — sekme sayaçları (`meta.counts`). TEK bir sorguyla
 * (Postgres `COUNT(*) FILTER`, tam tablo taraması) hesaplanır; istek filtrelerinden
 * (`trashed`/`status`/`cursor`/`limit`) ETKİLENMEZ. `all` çöp kutusunu HARİÇ tutar
 * (WordPress semantiği: "Tümü" = `published + draft`).
 *
 * Tablo adı yalnızca bu modül içinden sabit birim (`"pages" | "blog_posts"`) olarak
 * geçirilir — kullanıcı girdisiyle asla doldurulmaz, bu yüzden `$queryRaw` + `Prisma.raw`
 * ile tablo adı enterpolasyonu SQL enjeksiyonuna açık DEĞİLDİR.
 */
async function fetchContentCounts(prisma: PrismaClient, table: "pages" | "blog_posts"): Promise<ContentCountsDto> {
  const rows = await prisma.$queryRaw<{ published: bigint; draft: bigint; trashed: bigint }[]>`
    SELECT
      COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND "status" = 'PUBLISHED') AS published,
      COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND "status" = 'DRAFT') AS draft,
      COUNT(*) FILTER (WHERE "deletedAt" IS NOT NULL) AS trashed
    FROM ${Prisma.raw(`"${table}"`)}
  `;

  const row = rows[0] ?? { published: 0n, draft: 0n, trashed: 0n };
  const published = Number(row.published);
  const draft = Number(row.draft);
  const trashed = Number(row.trashed);

  return { all: published + draft, published, draft, trashed };
}

export function getPageContentCounts(prisma: PrismaClient): Promise<ContentCountsDto> {
  return fetchContentCounts(prisma, "pages");
}

export function getBlogPostContentCounts(prisma: PrismaClient): Promise<ContentCountsDto> {
  return fetchContentCounts(prisma, "blog_posts");
}
