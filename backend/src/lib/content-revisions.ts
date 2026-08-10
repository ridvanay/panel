import type { FastifyInstance } from "fastify";
import type { ContentEntityType, ContentRevision, Prisma } from "@prisma/client";
import { NotFoundError } from "./errors";
import { parseCursor, encodeCursor } from "./pagination";

/** Entity başına en fazla tutulacak revizyon sayısı (bkz. ARCHITECTURE.md §10.1). */
const MAX_REVISIONS_PER_ENTITY = 50;

/**
 * `PATCH /admin/pages/{id}` ve `PATCH /admin/blog/{id}` her güncellemeden ÖNCE, mevcut
 * (eski) satırın alan setini `ContentRevision`'a yazar. Entity başına en fazla
 * `MAX_REVISIONS_PER_ENTITY` revizyon tutulur — fazlası en eskiden başlanarak silinir.
 * Revizyon kaybı ile update'in atomik olması şart değil (bkz. görev notu), bu yüzden
 * transaction dışında, update'ten önce çağrılması yeterlidir.
 */
export async function snapshotBeforeUpdate(
  app: FastifyInstance,
  entityType: ContentEntityType,
  entityId: string,
  snapshot: Record<string, unknown>,
  actorId: string
): Promise<void> {
  const actor = await app.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });

  await app.prisma.contentRevision.create({
    data: {
      entityType,
      entityId,
      snapshot: snapshot as Prisma.InputJsonValue,
      editedById: actorId,
      editedByName: actor?.name ?? "Bilinmeyen kullanıcı",
    },
  });

  const excess = await app.prisma.contentRevision.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
    skip: MAX_REVISIONS_PER_ENTITY,
    select: { id: true },
  });

  if (excess.length > 0) {
    await app.prisma.contentRevision.deleteMany({
      where: { id: { in: excess.map((row) => row.id) } },
    });
  }
}

/**
 * `GET /admin/{pages|blog|products|portfolio}/{id}/revisions` ortak liste sorgusu (read-factory,
 * bkz. ARCHITECTURE.md §10.1) — dört route da BUNU çağırır. En yeni revizyon önce gelir; DTO'ya
 * çevirme (`toContentRevisionSummaryDto`) ve `ok()` zarfına sarma çağıran route'ta kalır.
 * NOT: mevcut satırların davranışıyla aynı şekilde üst entity'nin (Page/BlogPost/...) var olup
 * olmadığını KONTROL ETMEZ — id eşleşmezse yalnızca boş liste döner (bkz. blog/pages önceki hali).
 */
export async function listContentRevisions(
  app: FastifyInstance,
  entityType: ContentEntityType,
  entityId: string,
  query: { cursor?: string; limit: number }
): Promise<{ rows: ContentRevision[]; nextCursor: string | null }> {
  const cursorSeq = parseCursor(query.cursor);

  const rows = await app.prisma.contentRevision.findMany({
    where: {
      entityType,
      entityId,
      ...(cursorSeq ? { seq: { lt: cursorSeq } } : {}),
    },
    orderBy: { seq: "desc" },
    take: query.limit,
  });

  const nextCursor = rows.length === query.limit ? encodeCursor(rows[rows.length - 1]!.seq) : null;

  return { rows, nextCursor };
}

/**
 * `GET /admin/{pages|blog|products|portfolio}/{id}/revisions/{revisionId}` ortak detay sorgusu
 * (read-factory) — bulunamazsa veya `entityType`/`entityId` eşleşmezse `404` fırlatır (IDOR
 * koruması: başka bir entity'nin/tipin revizyonu `revisionId` tahmin edilerek okunamaz).
 */
export async function getContentRevisionOrThrow(
  app: FastifyInstance,
  entityType: ContentEntityType,
  entityId: string,
  revisionId: string
): Promise<ContentRevision> {
  const revision = await app.prisma.contentRevision.findUnique({ where: { id: revisionId } });
  if (!revision || revision.entityType !== entityType || revision.entityId !== entityId) {
    throw new NotFoundError("Revizyon bulunamadı.");
  }
  return revision;
}
