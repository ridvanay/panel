/**
 * Paket U (2026-10-28) — genel doktor CV/yayın aktarımı (anlatı biçimli CV düz metni).
 * Mantık ve kurallar: `src/lib/doctor-cv-generic.ts`. Rapor: `docs/prompts/2026-10-28-U-RAPOR.md`.
 *
 * NE YAPMAZ:
 *  - Doktor OLUŞTURMAZ; slug bulunamazsa açık hatayla çıkar.
 *  - `id`, `slug`, `userId`, `fullName`, `avatarMediaId`, uzmanlık ilişkileri, `title` ve `bio` değişmez.
 *  - `aboutHtml` yalnızca `--with-about` ile CV anlatısından yeniden üretilir.
 *  - CV'deki telefon/e-posta/doğum bilgisi profile girmez (yazmadan önce taranır, bulunursa reddedilir).
 *
 * Varsayılan KURU ÇALIŞMA — hiçbir şey yazmaz; kalemleri, sayıları ve eklenmeyenleri listeler.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/import-doctor-cv.ts --slug=ali-firat --file=imports/ali-firat.txt                          # kuru çalışma
 *   npx tsx scripts/import-doctor-cv.ts --slug=ali-firat --file=imports/ali-firat.txt --confirm=import-cv --operator="Ad Soyad"
 *   npx tsx scripts/import-doctor-cv.ts --slug=ali-firat --restore=<yedek.json> --confirm=restore-cv --operator="Ad Soyad"
 * Seçenekler:
 *   --with-about        aboutHtml'i CV anlatısından yeniden üret
 *   --backup-dir=<yol>  yedek klasörü (varsayılan storage/doctor-backups)
 *   --no-revalidate     yazma sonrası önbellek yenilemesini atla
 */

import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { DoctorImportError } from "../src/lib/doctor-cv-import";
import {
  CV_IMPORT_CONFIRM_KEY,
  CV_RESTORE_CONFIRM_KEY,
  applyGenericCvImport,
  buildGenericImportPlan,
  formatGenericPlan,
  restoreGenericCvImport,
} from "../src/lib/doctor-cv-generic";

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
    const slug = arg("slug");
    if (!slug) throw new DoctorImportError("--slug zorunlu.");
    const restore = arg("restore");
    if (restore) {
      const result = await restoreGenericCvImport(prisma, slug, path.resolve(restore), { ...operatorInfo, confirm: arg("confirm"), backupDir, revalidate });
      console.log("Geri dönüş tamam (cvEntries, publications, aboutHtml).");
      console.log(`Geri dönüş öncesi hâlin yedeği: ${result.preRestoreBackup}`);
      return;
    }
    const file = arg("file");
    if (!file) throw new DoctorImportError("--file zorunlu (CV düz metni).");
    const plan = await buildGenericImportPlan(prisma, slug, path.resolve(file), { withAbout: process.argv.includes("--with-about") });
    console.log(formatGenericPlan(plan));

    const confirm = arg("confirm");
    if (!confirm) {
      console.log(`\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Yazmak için --confirm=${CV_IMPORT_CONFIRM_KEY} --operator="Ad Soyad" ekleyin.`);
      return;
    }
    const result = await applyGenericCvImport(prisma, plan, { ...operatorInfo, confirm, backupDir, revalidate });
    console.log(`\nYazıldı. Yedek: ${result.backupFile}`);
    console.log(`Geri dönüş: npx tsx scripts/import-doctor-cv.ts --slug=${slug} --restore=${result.backupFile} --confirm=${CV_RESTORE_CONFIRM_KEY} --operator="..."`);
  } catch (err) {
    if (err instanceof DoctorImportError) {
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
