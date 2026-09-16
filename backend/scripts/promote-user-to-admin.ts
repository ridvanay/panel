/**
 * Tek seferlik admin-düzeltme script'i — sıfırlanmış bir veritabanında `/admin` paneline erişimini
 * kaybetmiş bir kullanıcıyı kurtarmak için: (1) kullanıcının `role`'ünü `SiteRole.ADMIN`'e yükseltir,
 * (2) `telehealth` modülünü `SiteModule` tablosunda `enabled: true` yapar. `link-telehealth-demo-doctor-user.ts`
 * İLE AYNI desen (idempotent, Prisma client'ı doğrudan kullanır, `main().catch().finally()` iskeleti).
 *
 * BU SCRIPT NE YAPMAZ (bilinçli sınırlar):
 *  - Kullanıcı OLUŞTURMAZ — hedef `User` zaten VAR OLMALIDIR; yoksa açıklayıcı hata verip çıkar.
 *  - `status` alanını ASLA zorla değiştirmez — SUSPENDED/DELETED durumundaki bir kullanıcıyı sessizce
 *    ACTIVE yapmaz; yalnızca mevcut durumu raporlar (bu ayrı, bilinçli bir karar gerektirir).
 *  - JWT/token yenileme veya session invalidation YAPMAZ — rol her istekte DB'den taze okunur
 *    (bkz. src/middleware/authenticate.ts satır 5-9), bu yüzden DB güncellemesi tek başına yeterlidir.
 *
 * ÇALIŞTIRMA (backend/ dizininden, veya `docker compose exec backend npx tsx scripts/...`):
 *   npx tsx scripts/promote-user-to-admin.ts --dry-run
 *   npx tsx scripts/promote-user-to-admin.ts --email ridvan.ay3@gmail.com
 *
 * ARGÜMANLAR (hepsi opsiyonel):
 *   --email <email>   Varsayılan: ridvan.ay3@gmail.com
 *   --dry-run         Hiçbir yazma yapmaz; ne yapılacağını konsola basar.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface ScriptArgs {
  email: string;
  dryRun: boolean;
}

const DEFAULT_EMAIL = "ridvan.ay3@gmail.com";
const TELEHEALTH_MODULE_KEY = "telehealth";

function parseArgs(argv: string[]): ScriptArgs {
  const args: ScriptArgs = { email: DEFAULT_EMAIL, dryRun: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--email") {
      args.email = argv[++i] ?? args.email;
      continue;
    }
    if (arg.startsWith("--email=")) {
      args.email = arg.slice("--email=".length);
      continue;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[promote-user-to-admin] email="${args.email}" dryRun=${args.dryRun}`);

  const user = await prisma.user.findUnique({
    where: { email: args.email.toLowerCase() },
    select: { id: true, email: true, name: true, role: true, status: true },
  });
  if (!user) {
    throw new Error(
      `Kullanıcı bulunamadı: "${args.email}". Bu script kullanıcı OLUŞTURMAZ — önce POST /auth/register ` +
        "(veya admin panelden) bu e-posta ile bir hesap oluşturun, sonra script'i tekrar çalıştırın."
    );
  }

  // --- 1) Rol yükseltme ---
  if (user.role === "ADMIN") {
    console.log(`[ok] "${user.email}" zaten role="ADMIN" — değişiklik gerekmiyor.`);
  } else if (args.dryRun) {
    console.log(`[dry-run] "${user.email}" role="${user.role}" -> "ADMIN" yükseltilecekti (hiçbir şey YAZILMADI).`);
  } else {
    await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    console.log(`[fix] "${user.email}" role="${user.role}" -> "ADMIN" yükseltildi.`);
  }

  // Status ASLA zorla değiştirilmez — yalnızca raporlanır.
  if (user.status !== "ACTIVE") {
    console.log(
      `[UYARI] "${user.email}" status="${user.status}" (ACTIVE değil) — bu script status'u DEĞİŞTİRMEZ. ` +
        "SUSPENDED/DELETED bir hesap giriş yapamayabilir; bu ayrı, bilinçli bir kararla elle çözülmelidir."
    );
  } else {
    console.log(`[ok] "${user.email}" status="ACTIVE".`);
  }

  // --- 2) telehealth modülünü aktive et ---
  const existingModule = await prisma.siteModule.findUnique({
    where: { key: TELEHEALTH_MODULE_KEY },
    select: { id: true, enabled: true },
  });

  if (existingModule?.enabled === true) {
    console.log(`[ok] SiteModule "${TELEHEALTH_MODULE_KEY}" zaten enabled=true — değişiklik gerekmiyor.`);
  } else if (args.dryRun) {
    if (existingModule) {
      console.log(`[dry-run] SiteModule "${TELEHEALTH_MODULE_KEY}" enabled=false -> true yapılacaktı (hiçbir şey YAZILMADI).`);
    } else {
      console.log(`[dry-run] SiteModule "${TELEHEALTH_MODULE_KEY}" satırı YOK — enabled=true ile oluşturulacaktı (hiçbir şey YAZILMADI).`);
    }
  } else {
    // updatedById: hedef kullanıcı bu noktada (dry-run değilse) zaten ADMIN'e yükseltilmiş olabilir;
    // henüz DB'de eski rolle okunmuş olsa da FK yalnızca user.id'ye referans verir, role bağımlı değildir.
    await prisma.siteModule.upsert({
      where: { key: TELEHEALTH_MODULE_KEY },
      create: { key: TELEHEALTH_MODULE_KEY, enabled: true, updatedById: user.id },
      update: { enabled: true, updatedById: user.id },
    });
    console.log(`[fix] SiteModule "${TELEHEALTH_MODULE_KEY}" enabled=true olarak upsert edildi.`);
  }

  console.log(
    "\n[Not] Rol JWT'ye gömülmez — her istekte DB'den taze okunur (authenticate.ts). Token yenileme/" +
      "session invalidation GEREKMİYOR: mevcut access token geçerliyse bir sonraki istekte ADMIN olarak " +
      "görünecek; süresi dolmuşsa normal login yeterli."
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
