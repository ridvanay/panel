/**
 * Vahit Mutlu doktor profili — CV, yayınlar, biyografi ve sertifika aktarımı.
 * İlk sürüm: 2026-10-02 (unvan, uzmanlık, sosyal bağlantılar). Paket L (2026-10-23): CV'den
 * `cvEntries`/`publications`/`bio`/`aboutHtml` + Wiley sertifika PDF'i. Mantık ve kurallar:
 * `src/lib/doctor-cv-import.ts`. Rapor: `docs/prompts/2026-10-23-L-RAPOR.md`.
 *
 * NE YAPMAZ (değişmeyen kurallar):
 *  - Doktor OLUŞTURMAZ; kayıt yoksa açık hatayla çıkar.
 *  - `id`, `slug`, `userId`, `fullName`, `avatarMediaId` alanlarına dokunmaz (randevu/LiveKit kimliği).
 *  - `subSpecialty`'ye dokunmaz; `specialtyId` yalnızca boşsa bağlanır, ek uzmanlıklar yalnızca eklenir.
 *  - WhatsApp numarası eklemez.
 *  - CV'deki kişisel telefon/e-posta ve doğum yılı/yeri profile girmez (yazmadan önce taranır).
 *
 * Varsayılan KURU ÇALIŞMA — hiçbir şey yazmaz; mevcut/yeni kalem sayılarını, bio/about
 * uzunluklarını, yüklenecek dosyayı ve eklenmeyen kalemleri listeler.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/update-vahit-mutlu-profile.ts                                     # kuru çalışma
 *   npx tsx scripts/update-vahit-mutlu-profile.ts --confirm=update-vahit --operator="Ad Soyad"
 *   npx tsx scripts/update-vahit-mutlu-profile.ts --restore=<yedek.json> --confirm=restore-vahit --operator="Ad Soyad"
 * Seçenekler:
 *   --dir=<yol>         kaynak klasör: vahitcv.txt + wiley-reviewer-certificate-2025.pdf (varsayılan ../imports/vahit-mutlu)
 *   --backup-dir=<yol>  yedek klasörü (varsayılan storage/doctor-backups)
 *   --no-revalidate     yazma sonrası önbellek yenilemesini atla
 */

import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { storage } from "../src/lib/storage";
import {
  DoctorImportError,
  IMPORT_CONFIRM_KEY,
  RESTORE_CONFIRM_KEY,
  applyDoctorCvImport,
  buildImportPlan,
  formatImportPlan,
  restoreDoctorProfile,
} from "../src/lib/doctor-cv-import";

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
      const result = await restoreDoctorProfile(prisma, path.resolve(restore), { ...operatorInfo, confirm: arg("confirm"), backupDir, revalidate });
      console.log("Geri dönüş tamam.");
      console.log(`Geri dönüş öncesi hâlin yedeği: ${result.preRestoreBackup}`);
      return;
    }

    const plan = await buildImportPlan(prisma, path.resolve(arg("dir") ?? "../imports/vahit-mutlu"));
    console.log(formatImportPlan(plan));

    const confirm = arg("confirm");
    if (!confirm) {
      console.log(`\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Yazmak için --confirm=${IMPORT_CONFIRM_KEY} --operator="Ad Soyad" ekleyin.`);
      return;
    }
    const result = await applyDoctorCvImport(prisma, plan, { ...operatorInfo, confirm, backupDir, storage, revalidate });
    console.log(`\nYazıldı. Sertifika medyası: ${result.mediaId}`);
    console.log(`Yedek: ${result.backupFile}`);
    console.log(
      `Geri dönüş: npx tsx scripts/update-vahit-mutlu-profile.ts --restore=${result.backupFile} --confirm=${RESTORE_CONFIRM_KEY} --operator="..."`
    );
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
