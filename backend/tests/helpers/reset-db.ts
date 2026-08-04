import type { PrismaClient } from "@prisma/client";

/**
 * Güvenlik kilidi — TRUNCATE'ten önce mutlaka çağrılır. Test process'i yanlışlıkla
 * (örn. .env yükleme sırası bozulursa) gerçek geliştirme/production veritabanına bağlanmışsa
 * burada patlar ve TRUNCATE'e asla izin vermez. Bkz. tests/setup/env.ts — asıl kök neden
 * düzeltmesi orada, ama bu kilit env yükleme sırası tekrar bozulsa bile son savunma hattıdır.
 */
async function assertConnectedToTestDatabase(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<{ current_database: string }[]>`
    SELECT current_database()
  `;
  const currentDatabase = rows[0]?.current_database;
  if (currentDatabase !== "saas_test") {
    throw new Error(
      `resetDatabase() güvenlik kilidi: bağlı veritabanı "${currentDatabase}" — beklenen "saas_test" değil, ` +
        `TRUNCATE reddedildi. Testlerin doğru DATABASE_URL ile çalıştığından emin olun ` +
        `(bkz. tests/setup/env.ts, .env.test).`,
    );
  }
}

/** Testler arası izolasyon için: migration tablosu hariç tüm tabloları boşaltır. */
export async function resetDatabase(prisma: PrismaClient) {
  await assertConnectedToTestDatabase(prisma);

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;

  const names = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}
