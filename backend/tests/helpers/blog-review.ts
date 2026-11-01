import type { FastifyInstance } from "fastify";

/**
 * Paket Z1 — yayın kuralı: PUBLISHED/SCHEDULED için hekim onayı ya da tıbbi olmayan kategoride
 * "not_required" gerekir. Bu yardımcı, hekim onayından bağımsız testlerin yazıyı yayınlayabilmesi için
 * tıbbi olmayan bir kategori (idempotent) oluşturur ve admin payload'ına eklenecek alanları döner.
 */
export async function exemptReview(app: FastifyInstance): Promise<{ categoryId: string; medicalReviewStatus: "not_required" }> {
  const category = await app.prisma.blogCategory.upsert({
    where: { slug: "test-health-travel-guide" },
    create: { name: "Health travel guide", slug: "test-health-travel-guide", isMedical: false },
    update: { isMedical: false },
  });
  return { categoryId: category.id, medicalReviewStatus: "not_required" };
}
