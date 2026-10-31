/**
 * Paket X — 8 TASLAK sağlık paketi (yalnızca EN metin, fiyatsız, isActive=false). Var olan slug'a dokunulmaz.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/seed-health-packages.ts                                                   (kuru çalışma)
 *   npx tsx scripts/seed-health-packages.ts --confirm=seed-health-packages --operator="Ad Soyad"
 */
import { PrismaClient } from "@prisma/client";
import { applySeedHealthPackagesPlan, buildSeedHealthPackagesPlan, SEED_HEALTH_PACKAGES_CONFIRM_KEY } from "../src/lib/health-packages-seed";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const plan = await buildSeedHealthPackagesPlan(prisma);
    console.log(`Oluşturulacak taslak: ${plan.toCreate.length} (${plan.toCreate.map((p) => p.slug).join(", ") || "—"})`);
    if (plan.existing.length) console.log(`Zaten var (dokunulmaz): ${plan.existing.join(", ")}`);
    const confirm = arg("confirm");
    if (!confirm) {
      console.log(`\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Yazmak için --confirm=${SEED_HEALTH_PACKAGES_CONFIRM_KEY} --operator="Ad Soyad" ekleyin.`);
      return;
    }
    const result = await applySeedHealthPackagesPlan(prisma, plan, { confirm, operator: arg("operator") ?? "" });
    console.log(`Oluşturuldu: ${result.created} taslak paket (isActive=false, fiyatsız). Yönetici içerik ve çevirileri kontrol edip aktifleştirmeli.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
