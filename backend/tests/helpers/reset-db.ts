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

  // Paket AL (İş 1.3) — KALICI düzeltme `src/app.ts` içindedir (test ortamında sweeper/zamanlayıcı kurulmaz:
  // açılıştaki fire-and-forget ilk tur TRUNCATE ile kilit sırası çakışıp 40P01 üretiyordu). Buradakiler
  // yalnızca EK güvenlik: (1) tablo sırası deterministik (alfabetik) — pg_tables sırası rastgeledir ve her
  // TRUNCATE farklı sırada AccessExclusive kilit alırdı; (2) tek ifade (tek kilit turu); (3) 40P01 olursa
  // deadlock kurbanı TRUNCATE olduğunda (rakip sorgu bitince) sınırlı sayıda yeniden dene.
  const names = tables
    .map((t) => t.tablename)
    .sort()
    .map((n) => `"public"."${n}"`)
    .join(", ");
  const maxAttempts = 4;
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
      break;
    } catch (err) {
      const text = err instanceof Error ? `${err.message} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})}` : String(err);
      const isDeadlock = text.includes("40P01") || text.toLowerCase().includes("deadlock detected");
      if (!isDeadlock || attempt >= maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
  }

  // §10.5 Çoklu Dil & Yerelleştirme — `locales` tablosu TRUNCATE ile birlikte az önce
  // silinen `tr`/`en` seed satırlarını (bkz. migration
  // `20260812055828_add_locale_and_content_slug`) `prisma migrate deploy` YALNIZCA global
  // setup'ta (tüm test dosyalarından ÖNCE) bir kez çalıştırdığı için bir daha üretmez —
  // bu satır olmadan `resetDatabase()`'i çağıran HER test dosyası "varsayılan dil yok"
  // durumuna düşerdi. Üretimde bu SORUN DEĞİLDİR (TRUNCATE hiç çalışmaz); bu YALNIZCA test
  // izolasyonu için gereken bir yeniden-tohumlamadır (bkz. lib/localization.ts'teki ayrı
  // savunma ağı, gerçek çökme senaryolarına karşı).
  await prisma.locale.createMany({
    data: [
      { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: true, enabled: true, sortOrder: 0 },
      { code: "en", label: "İngilizce", nativeLabel: "English", isDefault: false, enabled: true, sortOrder: 1 },
    ],
    skipDuplicates: true,
  });
}
