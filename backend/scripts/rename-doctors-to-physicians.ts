/**
 * Paket V — menü, footer, header CTA ve e-posta şablonlarındaki `/doctors` bağlantılarını `/physicians`
 * yapar; hekim listesine giden menü öğesinin etiketini "Consult Physicians" (+ 8 dil) olarak yazar.
 * Mantık: `src/lib/physicians-links.ts`.
 *
 * Varsayılan KURU ÇALIŞMA — hiçbir şey yazmaz, değişecek kayıtları listeler.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/rename-doctors-to-physicians.ts
 *   npx tsx scripts/rename-doctors-to-physicians.ts --confirm=rename-physicians --operator="Ad Soyad"
 * Seçenekler:
 *   --no-revalidate     yazma sonrası önbellek yenilemesini atla
 */
import os from "node:os";
import { PrismaClient } from "@prisma/client";
import { PHYSICIANS_CONFIRM_KEY, PhysiciansLinkError, applyPhysiciansPlan, buildPhysiciansPlan, formatPhysiciansPlan } from "../src/lib/physicians-links";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const plan = await buildPhysiciansPlan(prisma);
    console.log(formatPhysiciansPlan(plan));
    const confirm = arg("confirm");
    if (!confirm) {
      console.log(`\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Yazmak için --confirm=${PHYSICIANS_CONFIRM_KEY} --operator="Ad Soyad" ekleyin.`);
      return;
    }
    const result = await applyPhysiciansPlan(prisma, plan, {
      confirm,
      operator: arg("operator") ?? "",
      osUser: os.userInfo().username,
      hostname: os.hostname(),
      revalidate: !process.argv.includes("--no-revalidate"),
    });
    console.log(`\nYazıldı: ${result.changed} kayıt. Önceki değerler audit kaydında (site.links.physicians_renamed).`);
  } catch (err) {
    if (err instanceof PhysiciansLinkError) {
      console.error(`HATA: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
