/**
 * Tek seferlik veri operasyonu (KOD DEĞİŞİKLİĞİ DEĞİL) — sitenin varsayılan (prefix'siz) dilini
 * `tr`'den `en`'e devreder. `PATCH /admin/locales/{code}` ucunun (`src/modules/localization/
 * localization.routes.ts`) `isDefault: true` dalıyla BİREBİR AYNI iki adımı, AYNI TEK
 * transaction içinde tekrarlar: (1) mevcut varsayılanı `isDefault: false` yapar, (2) hedef
 * dili `isDefault: true` yapar. `promote-user-to-admin.ts` İLE AYNI desen (idempotent,
 * Prisma client'ı doğrudan kullanır, `main().catch().finally()` iskeleti).
 *
 * DİKKAT (bilinçli, görev tarafından istendi) — bu işlem sitenin prefix'siz (varsayılan)
 * dilini `tr`'den `en`'e çevirir: önceden prefix'siz servis edilen TR URL'ler artık `/tr/...`
 * prefix'i alacak, EN URL'ler prefix'siz olacaktır (bkz. `.claude/architect-scope-i18n.md`).
 *
 * BU SCRIPT NE YAPMAZ:
 *  - Yeni bir `Locale` satırı OLUŞTURMAZ — hedef dil (`en`) `enabled: true` ile ZATEN KAYITLI
 *    olmalıdır; yoksa açıklayıcı hata verip çıkar.
 *  - `enabled` bayrağına DOKUNMAZ — yalnızca `isDefault` devri yapılır (route'taki `enabled:
 *    false` iken `isDefault: true` YASAK kuralı burada da elle kontrol edilir).
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/switch-default-locale-to-en.ts --dry-run
 *   npx tsx scripts/switch-default-locale-to-en.ts --target en
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface ScriptArgs {
  target: string;
  dryRun: boolean;
}

const DEFAULT_TARGET = "en";

function parseArgs(argv: string[]): ScriptArgs {
  const args: ScriptArgs = { target: DEFAULT_TARGET, dryRun: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--target") {
      args.target = argv[++i] ?? args.target;
      continue;
    }
    if (arg.startsWith("--target=")) {
      args.target = arg.slice("--target=".length);
      continue;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[switch-default-locale-to-en] target="${args.target}" dryRun=${args.dryRun}`);

  const target = await prisma.locale.findUnique({ where: { code: args.target } });
  if (!target) {
    throw new Error(
      `Dil bulunamadı: "${args.target}". Bu script yeni bir Locale OLUŞTURMAZ — önce ` +
        "POST /admin/locales (veya admin panelden) bu kodla bir dil ekleyin, sonra script'i tekrar çalıştırın."
    );
  }

  if (target.isDefault) {
    console.log(`[ok] "${target.code}" zaten isDefault=true — değişiklik gerekmiyor.`);
    await printCurrentState();
    return;
  }

  if (!target.enabled) {
    throw new Error(`"${target.code}" enabled=false — varsayılan dil devre dışı bir dile devredilemez (route ile AYNI kural).`);
  }

  const currentDefault = await prisma.locale.findFirst({ where: { isDefault: true } });
  console.log(`[bilgi] mevcut varsayılan: "${currentDefault?.code ?? "(yok)"}" -> "${target.code}"`);

  if (args.dryRun) {
    console.log(`[dry-run] "${currentDefault?.code}" isDefault=false, "${target.code}" isDefault=true yapılacaktı (hiçbir şey YAZILMADI).`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    // route'taki AYNI iki adım, AYNI tek transaction — bkz. localization.routes.ts PATCH /:code.
    await tx.locale.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    await tx.locale.update({ where: { code: target.code }, data: { isDefault: true } });
  });

  console.log(`[fix] varsayılan dil "${currentDefault?.code}" -> "${target.code}" olarak devredildi.`);
  await printCurrentState();

  console.log(
    "\n[UYARI — KASITLI DAVRANIŞ DEĞİŞİKLİĞİ] Sitenin prefix'siz (varsayılan) dili artık " +
      `"${target.code}". Önceden prefix'siz servis edilen eski varsayılan dilin URL'leri artık ` +
      "prefix ALACAK (ör. `/tr/...`); yeni varsayılanın URL'leri artık prefix'SİZ servis edilecek. " +
      "Bu, ISR/CDN önbelleği ve dış bağlantılar (SEO) için önemli bir geçiş anlamına gelir."
  );
}

async function printCurrentState() {
  const rows = await prisma.locale.findMany({ select: { code: true, isDefault: true }, orderBy: { sortOrder: "asc" } });
  console.log("[durum] SELECT code, \"isDefault\" FROM locales;");
  for (const row of rows) {
    console.log(`  ${row.code}\t${row.isDefault}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
