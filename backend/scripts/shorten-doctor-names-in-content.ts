/**
 * Kurucu dışındaki doktorların `bio` / `aboutHtml` / `subSpecialty` metinlerinde (kanonik EN +
 * `translations.<tüm diller>`) geçen tam adı sitede görünen adla değiştirir (Paket U, Bölüm C ile tutarlı).
 * Mantık ve kurallar: `src/lib/doctor-name-content.ts`.
 *
 * Varsayılan KURU ÇALIŞMA — hiçbir şey yazmaz; doktor × dil × alan bazında değişiklik sayısı, önce/sonra
 * örnekleri ve başka alfabeyle yazılmış ad adaylarını (otomatik değiştirilmez) listeler.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/shorten-doctor-names-in-content.ts                                              # kuru çalışma
 *   npx tsx scripts/shorten-doctor-names-in-content.ts --confirm=shorten-names --operator="Ad Soyad"
 *   npx tsx scripts/shorten-doctor-names-in-content.ts --restore=<yedek.json> --confirm=restore-names --operator="Ad Soyad"
 * Seçenekler:
 *   --backup-dir=<yol>  yedek klasörü (varsayılan storage/doctor-backups)
 *   --no-revalidate     yazma sonrası önbellek yenilemesini atla
 */
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  NameShortenError,
  SHORTEN_CONFIRM_KEY,
  SHORTEN_RESTORE_CONFIRM_KEY,
  applyShortenPlan,
  buildShortenPlan,
  formatShortenPlan,
  restoreShortenBackup,
} from "../src/lib/doctor-name-content";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const prisma = new PrismaClient();
  const operatorInfo = { operator: arg("operator") ?? "", osUser: os.userInfo().username, hostname: os.hostname() };
  const backupDir = path.resolve(arg("backup-dir") ?? "storage/doctor-backups");
  const revalidate = !process.argv.includes("--no-revalidate");
  try {
    const restore = arg("restore");
    if (restore) {
      const result = await restoreShortenBackup(prisma, path.resolve(restore), { ...operatorInfo, confirm: arg("confirm"), backupDir, revalidate });
      console.log(`Geri dönüş tamam (${result.doctors} doktor). Geri dönüş öncesi yedek: ${result.preRestoreBackup}`);
      return;
    }
    const plan = await buildShortenPlan(prisma);
    console.log(formatShortenPlan(plan));
    const confirm = arg("confirm");
    if (!confirm) {
      console.log(`\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Yazmak için --confirm=${SHORTEN_CONFIRM_KEY} --operator="Ad Soyad" ekleyin.`);
      return;
    }
    const result = await applyShortenPlan(prisma, plan, { ...operatorInfo, confirm, backupDir, revalidate });
    console.log(`\nYazıldı: ${result.doctors} doktor, ${result.replacements} değişiklik. Yedek: ${result.backupFile}`);
    console.log(`Geri dönüş: npx tsx scripts/shorten-doctor-names-in-content.ts --restore=${result.backupFile} --confirm=${SHORTEN_RESTORE_CONFIRM_KEY} --operator="..."`);
  } catch (err) {
    if (err instanceof NameShortenError) {
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
