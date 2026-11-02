/**
 * Paket AI - hizmet adlarini unvandan hizmet adina cevirir, hizmet grubu/ikon/kisa aciklama yazar (8 dil).
 * Mantik: `src/lib/service-labels.ts`. Slug/URL DEGISMEZ, kayit SILINMEZ, idempotent.
 * `--cta`: header birincil CTA etiketini "Book a consultation" (8 dil) + href /request yapar (yalniz istenirse).
 *
 * Calistirma (backend/ dizininden; DATABASE_URL'i ACIKCA export edin):
 *   npx tsx scripts/rename-service-labels.ts                                   # kuru calisma
 *   npx tsx scripts/rename-service-labels.ts --cta                              # kuru calisma (+ header CTA)
 *   npx tsx scripts/rename-service-labels.ts --confirm=rename-service-labels --operator="Ad Soyad" [--cta]
 *   npx tsx scripts/rename-service-labels.ts --restore=storage/backups/service-labels-<tarih>.json --confirm=rename-service-labels --operator="Ad Soyad"
 *   (istege bagli: --backup-dir=<yol>, --no-revalidate; NODE_ENV=production iken yazma/restore ek --i-know-this-is-prod ister)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  RENAME_SERVICE_LABELS_CONFIRM_KEY,
  RenameServiceLabelsError,
  applyServiceLabelPlan,
  buildServiceLabelBackup,
  buildServiceLabelPlan,
  formatServiceLabelPlan,
  parseServiceLabelBackup,
  restoreServiceLabels,
} from "../src/lib/service-labels";
import { assertProdWriteAllowed, printTargetDb } from "./_script-guard";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const confirm = arg("confirm");
    const operator = arg("operator") ?? "";
    const restore = arg("restore");
    const cta = process.argv.includes("--cta");
    const write = confirm !== undefined;
    console.log(`[rename-service-labels] mod=${restore ? (write ? "GERİ YÜKLE" : "KURU (restore)") : write ? "YAZ" : "KURU ÇALIŞTIRMA"}${cta ? " +CTA" : ""}`);
    printTargetDb();
    assertProdWriteAllowed(write, process.argv.slice(2));
    const options = { confirm, operator, osUser: os.userInfo().username, hostname: os.hostname(), revalidate: !process.argv.includes("--no-revalidate") };

    if (restore) {
      const file = path.resolve(restore);
      if (!fs.existsSync(file)) throw new RenameServiceLabelsError(`Yedek dosyası bulunamadı: ${file}`);
      const backup = parseServiceLabelBackup(fs.readFileSync(file, "utf8"));
      if (!write) {
        console.log(`[kuru] ${file} yedeğinden ${backup.specialties.length} uzmanlık${backup.cta ? " + header CTA" : ""} geri yüklenecekti (hiçbir şey yazılmadı).`);
        return;
      }
      const result = await restoreServiceLabels(prisma, backup, options);
      for (const slug of result.missing) console.warn(`[uyari] ${slug}: kayıt bulunamadı; atlandı.`);
      for (const item of result.skipped) console.warn(`[atla] ${item.slug}: ${item.reason}.`);
      console.log(`[fix] geri yüklendi: ${result.restored.join(", ") || "-"}${result.ctaRestored ? " + header CTA" : ""}`);
      return;
    }

    const plan = await buildServiceLabelPlan(prisma, { cta });
    console.log(formatServiceLabelPlan(plan));
    if (!write) {
      console.log(`\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Yazmak için --confirm=${RENAME_SERVICE_LABELS_CONFIRM_KEY} --operator="Ad Soyad" ekleyin.`);
      return;
    }
    if (confirm !== RENAME_SERVICE_LABELS_CONFIRM_KEY) throw new RenameServiceLabelsError(`Geçersiz --confirm değeri. Beklenen: --confirm=${RENAME_SERVICE_LABELS_CONFIRM_KEY}`);
    if (!operator.trim()) throw new RenameServiceLabelsError('--operator="Ad Soyad" zorunludur.');
    if (!plan.entries.some((e) => e.action === "set") && plan.cta?.action !== "set") {
      console.log("\nYapılacak değişiklik yok; hiçbir şey yazılmadı (idempotent).");
      return;
    }

    const dir = path.resolve(arg("backup-dir") ?? "storage/backups");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `service-labels-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(buildServiceLabelBackup(plan), null, 2), "utf8");
    console.log(`[yedek] ${file}`);

    const result = await applyServiceLabelPlan(prisma, plan, options);
    for (const item of result.skipped) console.warn(`[uyari] ${item.slug}: ${item.reason}; atlandı.`);
    console.log(`\nGüncellendi: ${result.updated.join(", ") || "-"}${result.ctaUpdated ? " + header CTA" : ""}`);
    console.log(`[geri al] npx tsx scripts/rename-service-labels.ts --restore=${file} --confirm=${RENAME_SERVICE_LABELS_CONFIRM_KEY} --operator="Ad Soyad"`);
  } catch (err) {
    if (err instanceof RenameServiceLabelsError || (err instanceof Error && err.message.startsWith("NODE_ENV=production"))) {
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
