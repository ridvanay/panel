/**
 * Paket L (2026-10-23) — çevrilmiş export dosyasını içe aktarır. `translations.es|de|ar|ru` yazılır;
 * Paket O: `translations.tr` YALNIZCA hedefte TR yoksa ya da `--overwrite-locale=tr` verilmişse yazılır.
 * Kanonik (EN) alanlara ve `translations.en`'e asla dokunulmaz. Mantık:
 * `src/lib/content-translations.ts`.
 *
 * Varsayılan KURU ÇALIŞMA — dil başına yazılacak kalem sayılarını ve atlananları listeler.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/import-translations.ts --file=<cevrilmis.json>                                   # kuru çalışma
 *   npx tsx scripts/import-translations.ts --file=<cevrilmis.json> --confirm=import-translations --operator="Ad Soyad"
 *   npx tsx scripts/import-translations.ts --restore=<yedek.json> --confirm=restore-translations --operator="Ad Soyad"
 * Seçenekler:
 *   --backup-dir=<yol>  yedek klasörü (varsayılan storage/translation-backups)
 *   --no-revalidate     yazma sonrası önbellek yenilemesini atla
 *   --overwrite-locale=tr  mevcut TR çevirisinin üzerine yaz (varsayılan: dolu TR atlanır)
 */
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  IMPORT_CONFIRM_KEY,
  RESTORE_CONFIRM_KEY,
  TranslationImportError,
  applyImportPlan,
  buildImportPlan,
  formatImportPlan,
  readTranslationFile,
  restoreTranslations,
} from "../src/lib/content-translations";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const prisma = new PrismaClient();
  const operatorInfo = { operator: arg("operator") ?? "", osUser: os.userInfo().username, hostname: os.hostname() };
  const backupDir = path.resolve(arg("backup-dir") ?? "storage/translation-backups");
  const revalidate = !process.argv.includes("--no-revalidate");
  try {
    const restore = arg("restore");
    if (restore) {
      const result = await restoreTranslations(prisma, path.resolve(restore), { ...operatorInfo, confirm: arg("confirm"), backupDir, revalidate });
      console.log("Geri dönüş tamam.");
      console.log(`Geri dönüş öncesi hâlin yedeği: ${result.preRestoreBackup}`);
      return;
    }

    const file = arg("file");
    if (!file) throw new TranslationImportError("--file=<çevrilmiş export dosyası> gerekli.");
    const overwriteLocales = arg("overwrite-locale")?.split(",").filter(Boolean);
    const plan = await buildImportPlan(prisma, await readTranslationFile(path.resolve(file)), { overwriteLocales });
    console.log(formatImportPlan(plan));

    const confirm = arg("confirm");
    if (!confirm) {
      console.log(`\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Yazmak için --confirm=${IMPORT_CONFIRM_KEY} --operator="Ad Soyad" ekleyin.`);
      return;
    }
    const result = await applyImportPlan(prisma, plan, { ...operatorInfo, confirm, backupDir, sourceFile: file, revalidate });
    console.log(`\nYazıldı: ${result.pages} sayfa, ${result.doctors} doktor, ${result.entities} uzmanlık/menü/footer çevirisi.`);
    console.log(`Yedek: ${result.backupFile}`);
    console.log(`Geri dönüş: npx tsx scripts/import-translations.ts --restore=${result.backupFile} --confirm=${RESTORE_CONFIRM_KEY} --operator="..."`);
  } catch (err) {
    if (err instanceof TranslationImportError) {
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
