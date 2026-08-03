import type { FastifyInstance } from "fastify";
import type { SiteRole } from "@prisma/client";
import { ForbiddenError, ValidationError } from "./errors";

/**
 * §10.7 İçerik Yönetim Listesi — `authorId` kuralı, `Page`/`BlogPost` create/update
 * gövdelerinde BİREBİR AYNIDIR (bkz. ARCHITECTURE.md §10.7, openapi.yaml
 * CreatePageRequest/CreateBlogPostRequest/UpdatePageRequest/UpdateBlogPostRequest).
 *
 * - Gövdede `authorId` yoksa (`undefined`) → dokunma, çağıran taraf varsayılanı uygular
 *   (create'te `request.user.id`, update'te alanı hiç değiştirme).
 * - Giriş yapmış kullanıcının kendi id'si gönderildiyse → serbest (herkes kendini atayabilir).
 * - `null` dahil, BAŞKA bir id yalnızca ADMIN tarafından gönderilebilir; EDITOR/VIEWER
 *   gönderirse 403.
 * - Var olmayan bir kullanıcı id'si → 422 (VALIDATION_ERROR).
 */
export async function resolveAuthorId(
  app: FastifyInstance,
  requestedAuthorId: string | null | undefined,
  actor: { id: string; role: SiteRole }
): Promise<string | null | undefined> {
  if (requestedAuthorId === undefined) return undefined;
  if (requestedAuthorId === actor.id) return requestedAuthorId;

  if (actor.role !== "ADMIN") {
    throw new ForbiddenError("Yazarı yalnızca ADMIN değiştirebilir.");
  }

  if (requestedAuthorId !== null) {
    const exists = await app.prisma.user.findUnique({ where: { id: requestedAuthorId }, select: { id: true } });
    if (!exists) {
      throw new ValidationError("Belirtilen yazar bulunamadı.", { authorId: ["Kullanıcı bulunamadı."] });
    }
  }

  return requestedAuthorId;
}
