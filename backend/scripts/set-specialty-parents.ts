/**
 * Paket AG (İş 1) — `esd`, `ercp`, `poem` uzmanlıklarını `gastroenterology` altına bağlar (alt uzmanlık).
 * Mantık: `src/lib/specialty-parents.ts`. İdempotent; kayıt silmez, slug/URL değiştirmez.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/set-specialty-parents.ts                                                   # kuru çalışma
 *   npx tsx scripts/set-specialty-parents.ts --confirm=set-specialty-parent --operator="Ad Soyad"
 *   npx tsx scripts/set-specialty-parents.ts --map=esd:gastroenterology,ercp:gastroenterology  # özel eşleme
 *   npx tsx scripts/set-specialty-parents.ts --restore=storage/backups/specialty-parents-<tarih>.json --confirm=set-specialty-parent --operator="Ad Soyad"
 *   (isteğe bağlı: --backup-dir=<yol>, --no-revalidate)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  SET_SPECIALTY_PARENTS_CONFIRM_KEY,
  SetSpecialtyParentsError,
  applySpecialtyParentPlan,
  buildSpecialtyParentBackup,
  buildSpecialtyParentPlan,
  formatSpecialtyParentPlan,
  parseSpecialtyParentBackup,
  parseSpecialtyParentMap,
  restoreSpecialtyParents,
} from "../src/lib/specialty-parents";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

/** Hedef veritabanı: host:port/db (kullanıcı adı ve şifre ASLA yazdırılmaz). */
function describeTarget(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return `${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`;
  } catch {
    return "(DATABASE_URL okunamadı)";
  }
}

async function main() {
  console.log(`[set-specialty-parents] hedef veritabanı: ${describeTarget()}`);
  const prisma = new PrismaClient();
  try {
    const confirm = arg("confirm");
    const operator = arg("operator") ?? "";
    const restore = arg("restore");
    const write = confirm !== undefined;
    const options = {
      confirm,
      operator,
      osUser: os.userInfo().username,
      hostname: os.hostname(),
      revalidate: !process.argv.includes("--no-revalidate"),
    };
    console.log(`[set-specialty-parents] mod=${restore ? (write ? "GERİ YÜKLE" : "KURU (restore)") : write ? "YAZ" : "KURU ÇALIŞTIRMA"}`);

    if (restore) {
      const file = path.resolve(restore);
      if (!fs.existsSync(file)) throw new SetSpecialtyParentsError(`Yedek dosyası bulunamadı: ${file}`);
      const backup = parseSpecialtyParentBackup(fs.readFileSync(file, "utf8"));
      if (!write) {
        console.log(`[kuru] ${file} yedeğinden ${backup.entries.length} uzmanlığın üst bağlantısı geri yüklenecekti (hiçbir şey yazılmadı).`);
        return;
      }
      const result = await restoreSpecialtyParents(prisma, backup, options);
      for (const slug of result.missing) console.warn(`[uyari] ${slug}: kayıt bulunamadı; atlandı.`);
      for (const item of result.skipped) console.warn(`[atla] ${item.slug}: ${item.reason}.`);
      console.log(`[fix] geri yüklendi: ${result.restored.join(", ") || "-"}`);
      return;
    }

    const plan = await buildSpecialtyParentPlan(prisma, parseSpecialtyParentMap(arg("map")));
    console.log(formatSpecialtyParentPlan(plan));
    if (!write) {
      console.log(`\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Yazmak için --confirm=${SET_SPECIALTY_PARENTS_CONFIRM_KEY} --operator="Ad Soyad" ekleyin.`);
      return;
    }
    if (confirm !== SET_SPECIALTY_PARENTS_CONFIRM_KEY) throw new SetSpecialtyParentsError(`Geçersiz --confirm değeri. Beklenen: --confirm=${SET_SPECIALTY_PARENTS_CONFIRM_KEY}`);
    if (!operator.trim()) throw new SetSpecialtyParentsError('--operator="Ad Soyad" zorunludur.');
    if (!plan.entries.some((e) => e.action === "set")) {
      console.log("\nYapılacak değişiklik yok; hiçbir şey yazılmadı.");
      return;
    }

    const dir = path.resolve(arg("backup-dir") ?? "storage/backups");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `specialty-parents-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(buildSpecialtyParentBackup(plan), null, 2), "utf8");
    console.log(`[yedek] ${file}`);

    const result = await applySpecialtyParentPlan(prisma, plan, options);
    for (const item of result.skipped) console.warn(`[uyari] ${item.child}: ${item.reason}; yazma sırasında atlandı.`);
    console.log(`\nBağlandı: ${result.updated.join(", ") || "-"}`);
    console.log(`[geri al] npx tsx scripts/set-specialty-parents.ts --restore=${file} --confirm=${SET_SPECIALTY_PARENTS_CONFIRM_KEY} --operator="Ad Soyad"`);
  } catch (err) {
    if (err instanceof SetSpecialtyParentsError) {
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
