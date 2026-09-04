import type { FastifyInstance } from "fastify";
import { ConflictError, ValidationError } from "../../../lib/errors";

/**
 * `ProductCategory.parentId` hiyerarşi doğrulaması — EN FAZLA 2 SEVİYE (kök → alt). Derinlik
 * tavanı DB'de DEĞİL burada, uygulama katmanında zorlanır (bkz.
 * `.claude/architect-scope-products-catalog.md` §2.1, bağlayıcı; `NavigationItem`'ın tam-replace
 * payload'ı için yaptığı AYNI derinlik kontrolünün, tekil CRUD içindeki karşılığı).
 *
 * `categoryId` YOKSA (create) yalnızca "hedef üst kategori zaten bir alt kategori mi" kontrolü
 * yapılır. `categoryId` VARSA (update) ayrıca kendine referans + kendi altında çocuk varken
 * taşınma da reddedilir.
 *
 * Not: "hedef üst kategori KENDİ ALT AĞACIMDA mı" (döngü) kontrolü AYRI bir sorgu GEREKTİRMEZ —
 * 2 seviyelik bir hiyerarşide bu her zaman "hedef üst kategori zaten bir alt kategori" kontrolüyle
 * ÇAKIŞIR: bu kategorinin altındaki bir kategori, tanım gereği `parentId = categoryId` (null
 * DEĞİL) taşır ve zaten "3. seviye" kontrolünde reddedilir.
 */
export async function assertValidCategoryParent(
  app: FastifyInstance,
  input: { categoryId?: string; parentId: string | null }
): Promise<void> {
  const { categoryId, parentId } = input;

  // `null` = kök yap — her zaman geçerli (bkz. UpdateProductCategoryRequest.parentId notu).
  if (parentId === null) return;

  if (categoryId && parentId === categoryId) {
    throw new ValidationError("Bir kategori kendisini üst kategori olarak işaret edemez.", {
      parentId: ["Bir kategori kendisini üst kategori olarak işaret edemez."],
    });
  }

  const parent = await app.prisma.productCategory.findUnique({ where: { id: parentId } });
  if (!parent) {
    throw new ValidationError("Belirtilen üst kategori bulunamadı.", {
      parentId: ["Belirtilen üst kategori bulunamadı."],
    });
  }

  // 3. seviye (ve dolaylı olarak döngü) — hedef üst kategori ZATEN bir alt kategoriyse
  // (kendisi de bir üst kategoriye bağlıysa) bu, 3 seviyelik bir zincir üretir.
  if (parent.parentId !== null) {
    throw new ConflictError("En fazla 2 seviye derinlik desteklenir — seçilen kategori zaten bir alt kategori.", {
      parentId: ["Seçilen kategori zaten bir alt kategori — en fazla 2 seviye derinlik desteklenir."],
    });
  }

  if (categoryId) {
    // Bu kategorinin ALTINDA çocuk varken bir üst kategoriye taşınması → 409 (taşınırsa
    // çocukları 3. seviyeye düşerdi, 2 seviye tavanı ihlal edilir).
    const childCount = await app.prisma.productCategory.count({ where: { parentId: categoryId } });
    if (childCount > 0) {
      throw new ConflictError(
        "Bu kategorinin alt kategorileri var — üst kategoriye taşınamaz (en fazla 2 seviye derinlik desteklenir).",
        { parentId: ["Bu kategorinin alt kategorileri var — üst kategoriye taşınamaz."] }
      );
    }
  }
}
