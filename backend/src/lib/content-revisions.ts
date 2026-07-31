import type { FastifyInstance } from "fastify";
import type { ContentEntityType, Prisma } from "@prisma/client";

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
