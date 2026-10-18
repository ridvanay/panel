/**
 * Paket B2 (2026-10-18) — demo doktorları ilişkili TEST verisiyle birlikte KALICI siler.
 * Mantık `src/lib/demo-doctor-purge.ts` içindedir (engeller, yedek, transaction, dosya silme).
 *
 * YALNIZCA açıkça verilen slug'lar işlenir. Bağlı kullanıcı, gerçek ödeme (arşivli olsa bile),
 * gelecekte açık randevu veya devam eden kayıt varsa HİÇBİR şey silinmeden durur (çıkış kodu 2).
 * Hasta kullanıcı hesapları ve audit log satırları SİLİNMEZ.
 *
 * Klinik içerik (not/intake/belge/kayıt/gerçekleşmiş görüşme) varsa da durur; yalnızca içerik
 * TAMAMEN demo ödemeli booking'lerdeyse `--allow-demo-clinical="<gerekçe>"` ile geçilebilir.
 *
 * ÇALIŞTIRMA (backend/ dizininden) — ÖNCE dry-run; `--operator` zorunlu (audit'e yazılır):
 *   npx tsx scripts/purge-demo-doctors.ts --slugs=laura-bennett-2,felix-braun-2 --operator="Ad Soyad" --dry-run
 *   npx tsx scripts/purge-demo-doctors.ts --slugs=laura-bennett-2,felix-braun-2 --operator="Ad Soyad"
 * Yedek: storage/purge-backups/purge-demo-doctors-<zaman>.json (0600, PII + şifreli alan içerir).
 * Saklama en fazla 30 gün (compliance); süresi dolanları imha etmek için:
 *   npx tsx scripts/purge-demo-doctors.ts --prune-backups --operator="Ad Soyad" [--dry-run]
 */

import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  PURGE_BACKUP_RETENTION_DAYS,
  PurgeBlockedError,
  parseSlugList,
  pruneDemoDoctorPurgeBackups,
  runDemoDoctorPurge,
  type PurgeDoctorPlan,
} from "../src/lib/demo-doctor-purge";
import { telehealthDocumentStorage } from "../src/lib/telehealth-document-storage";
import { isRecordingStorageConfigured, recordingStagingKey, telehealthRecordingStorage } from "../src/lib/telehealth-recording-storage";

const prisma = new PrismaClient();

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function printPlan(doctor: PurgeDoctorPlan) {
  console.log(`\n${doctor.fullName} (/${doctor.slug}, id=${doctor.doctorId})`);
  console.log(`  randevular: ${doctor.appointments.length}`);
  for (const a of doctor.appointments) console.log(`    ${a.id}  ${a.startsAt}  ${a.status}  booking=${a.bookingId ?? "-"}`);
  console.log(`  booking'ler: ${doctor.bookings.length}`);
  for (const b of doctor.bookings) {
    console.log(
      `    ${b.bookingNumber}  ${b.paymentStatus}  paidBy=${b.paidBy ?? "-"}  ${formatCents(b.totalCents)} ${b.currency}${b.archivedAt ? "  [arşivli]" : ""}`
    );
  }
  console.log(`  müsaitlik kuralları: ${doctor.availabilityCount}`);
  console.log(`  ek uzmanlıklar: ${doctor.additionalSpecialtyCount}`);
  console.log(`  sağlık formu (intake): ${doctor.intakeCount}`);
  console.log(`  belgeler (dosya): ${doctor.documents.length}${doctor.documents.map((d) => `\n    ${d.id}  ${d.filename}`).join("")}`);
  console.log(`  görüşme kayıtları: ${doctor.recordings.length}${doctor.recordings.map((r) => `\n    ${r.id}  ${r.status}`).join("")}`);
}

const BACKUP_DIR = path.resolve(process.cwd(), "storage/purge-backups");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const operator = argValue("operator")?.trim() ?? "";
  if (!operator) {
    console.error('--operator="Ad Soyad" zorunludur (audit kaydı için).');
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes("--prune-backups")) {
    const expired = await pruneDemoDoctorPurgeBackups(prisma, { backupDir: BACKUP_DIR, operator, dryRun });
    console.log(`${dryRun ? "[dry-run] imha edilecek" : "[uygulandı] imha edilen"} (${PURGE_BACKUP_RETENTION_DAYS} günden eski) yedek: ${expired.length}`);
    for (const name of expired) console.log(`  ${name}`);
    return;
  }

  const slugs = parseSlugList(argValue("slugs"));
  if (slugs.length === 0) {
    console.error('Kullanım: --slugs=slug-1,slug-2 --operator="Ad Soyad" [--dry-run] [--allow-demo-clinical="<gerekçe>"]');
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runDemoDoctorPurge(prisma, {
      slugs,
      dryRun,
      operator,
      allowDemoClinicalReason: argValue("allow-demo-clinical"),
      backupDir: BACKUP_DIR,
      fileRemover: {
        removeDocument: (storagePath) => telehealthDocumentStorage.remove(storagePath),
        removeRecording: async (recordingId, storagePath) => {
          if (!isRecordingStorageConfigured()) return;
          if (storagePath) await telehealthRecordingStorage.remove(storagePath);
          await telehealthRecordingStorage.remove(recordingStagingKey(recordingId));
        },
      },
    });

    for (const doctor of result.plan.doctors) printPlan(doctor);
    if (result.dryRun) {
      console.log("\n[dry-run] hiçbir şey SİLİNMEDİ.");
      return;
    }
    console.log(`\n[uygulandı] yedek: ${result.backupFile} (en geç ${PURGE_BACKUP_RETENTION_DAYS} gün içinde --prune-backups ile imha edin)`);
    console.log(`  silinen: ${result.deleted?.doctors} doktor, ${result.deleted?.bookings} booking, ${result.deleted?.appointments} randevu`);
    if (result.fileErrors.length > 0) {
      console.log(`  dosya silme hataları (DB geri alınmadı, yollar yedekte): ${result.fileErrors.length}`);
      for (const line of result.fileErrors) console.log(`    ${line}`);
    }
  } catch (err) {
    if (err instanceof PurgeBlockedError) {
      console.error("DURDURULDU — hiçbir şey silinmedi:");
      for (const b of err.blockers) console.error(`  ${b.slug}: ${b.code} — ${b.message}`);
      process.exitCode = 2;
      return;
    }
    throw err;
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
