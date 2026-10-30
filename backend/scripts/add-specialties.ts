/**
 * Paket V — Göğüs Cerrahisi (`thoracic-surgery`) ve Beyin ve Sinir Cerrahisi (`neurosurgery`)
 * uzmanlıklarını ekler. Mantık: `src/lib/specialty-additions.ts`. İdempotent; mevcut uzmanlıklara
 * dokunmaz.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/add-specialties.ts                                               # kuru çalışma
 *   npx tsx scripts/add-specialties.ts --confirm=add-specialties --operator="Ad Soyad"
 * Ardından 8 dilin çevirisi: export-translatable-content.ts → çeviri → import-translations.ts.
 */
import os from "node:os";
import { PrismaClient } from "@prisma/client";
import {
  ADD_SPECIALTIES_CONFIRM_KEY,
  AddSpecialtiesError,
  applyAddSpecialtiesPlan,
  buildAddSpecialtiesPlan,
  formatAddSpecialtiesPlan,
} from "../src/lib/specialty-additions";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const plan = await buildAddSpecialtiesPlan(prisma);
    console.log(formatAddSpecialtiesPlan(plan));
    const confirm = arg("confirm");
    if (!confirm) {
      console.log(`\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Yazmak için --confirm=${ADD_SPECIALTIES_CONFIRM_KEY} --operator="Ad Soyad" ekleyin.`);
      return;
    }
    const result = await applyAddSpecialtiesPlan(prisma, plan, {
      confirm,
      operator: arg("operator") ?? "",
      osUser: os.userInfo().username,
      hostname: os.hostname(),
      revalidate: !process.argv.includes("--no-revalidate"),
    });
    console.log(result.created.length ? `\nEklendi: ${result.created.join(", ")}` : "\nEklenecek uzmanlık yoktu; hiçbir şey yazılmadı.");
  } catch (err) {
    if (err instanceof AddSpecialtiesError) {
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
