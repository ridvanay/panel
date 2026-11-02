/**
 * Paket AH - bir site dilini ziyaretciye KAPATIR (varsayilan: `tr`): `Locale.enabled = false`. Veri SILINMEZ; cevirileri,
 * ContentSlug kayitlari ve icerik oldugu gibi kalir (geri acmak icin `--restore` ya da admin panelden `enabled=true`).
 *
 * Kapaninca: public `/locales` dil listesinde, dil secicide, hreflang ve sitemap'te dil yoktur; `/tr/*` adreslerinin 301
 * yonlendirmesi frontend tarafindadir (FE1). Varsayilan dil (`isDefault`) KAPATILAMAZ: hedef dil varsayilansa script HATA verir
 * (once `switch-default-locale-to-en.ts` ile varsayilan dil EN yapilmalidir). Admin paneli dili (`tr`) Locale tablosundan bagimsizdir.
 *
 * Guvenlik:
 *  - Varsayilan KURU CALISTIRMA (hicbir sey yazilmaz, yedek de alinmaz).
 *  - Yazmak icin: --confirm=disable-site-locale --operator=<ad>
 *  - Idempotent: dil zaten kapaliysa (ya da yoksa) degisiklik yapilmaz.
 *  - Yazmadan once TUM `locales` satirlarinin JSON yedegi alinir (varsayilan storage/backups/locales-<tarih>.json).
 *  - Geri yukleme: --restore=<yedek.json> --confirm=disable-site-locale --operator=<ad>
 *    (yedekteki `enabled/isDefault/sortOrder` degerlerini ayni kodlara yazar; yedekte olmayan diller degismez).
 *  - Islem audit log'a yazilir. Public dil listesi onbellekli olabilir: site birkac dk icinde yansir.
 *
 * Calistirma (backend/ dizininden; DATABASE_URL'i ACIKCA export edin - bkz. proje notu):
 *   npx tsx scripts/disable-site-locale.ts
 *   npx tsx scripts/disable-site-locale.ts --confirm=disable-site-locale --operator=ridvan
 *   npx tsx scripts/disable-site-locale.ts --restore=storage/backups/locales-<tarih>.json --confirm=disable-site-locale --operator=ridvan
 *   (istege bagli: --code=tr  --backup-dir=<yol>)
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CONFIRM_TOKEN = "disable-site-locale";
const DEFAULT_CODE = "tr";

function parseArgs(argv: string[]) {
  const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  return { confirm: value("confirm"), operator: value("operator"), restore: value("restore"), backupDir: value("backup-dir"), code: (value("code") ?? DEFAULT_CODE).toLowerCase() };
}

interface LocaleRow {
  code: string;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
}
interface Snapshot {
  version: 1;
  createdAt: string;
  locales: LocaleRow[];
}

async function readSnapshot(): Promise<Snapshot> {
  const locales = await prisma.locale.findMany({ select: { code: true, enabled: true, isDefault: true, sortOrder: true }, orderBy: { sortOrder: "asc" } });
  return { version: 1, createdAt: new Date().toISOString(), locales };
}

async function printState() {
  const rows = await prisma.locale.findMany({ select: { code: true, enabled: true, isDefault: true }, orderBy: { sortOrder: "asc" } });
  console.log('[durum] code | enabled | isDefault');
  for (const row of rows) console.log(`  ${row.code}\t${row.enabled}\t${row.isDefault}`);
}

async function restoreSnapshot(file: string, operator: string) {
  const snap = JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
  if (snap.version !== 1 || !Array.isArray(snap.locales)) throw new Error("Geçersiz yedek dosyası biçimi.");
  await prisma.$transaction(async (tx) => {
    // `locales_single_default` kısmi unique indeksi: önce varsayılanı herkesten al, sonra yedekteki varsayılanı ver.
    await tx.locale.updateMany({ where: { code: { in: snap.locales.map((l) => l.code) } }, data: { isDefault: false } });
    for (const l of snap.locales) {
      await tx.locale.update({ where: { code: l.code }, data: { enabled: l.enabled, sortOrder: l.sortOrder } });
    }
    for (const l of snap.locales.filter((x) => x.isDefault)) await tx.locale.update({ where: { code: l.code }, data: { isDefault: true } });
    await tx.auditLog.create({
      data: { actorEmail: `script:${operator}`, action: "locale.restore_disable_site_locale", targetType: "Locale", metadata: { script: "disable-site-locale", backup: path.basename(file), locales: snap.locales.length } },
    });
  });
  console.log(`[fix] diller yedekten geri yüklendi (${snap.locales.length} satır).`);
  await printState();
}

async function main() {
  const { confirm, operator, restore, backupDir, code } = parseArgs(process.argv.slice(2));
  const write = confirm === CONFIRM_TOKEN;
  if (confirm !== undefined && !write) throw new Error(`Geçersiz --confirm değeri. Beklenen: --confirm=${CONFIRM_TOKEN}`);
  if (write && !operator?.trim()) throw new Error("--operator=<ad> zorunludur (audit log için).");
  console.log(`[disable-site-locale] mod=${restore ? (write ? "GERİ YÜKLE" : "KURU (restore)") : write ? "YAZ" : "KURU ÇALIŞTIRMA"} dil="${code}"`);

  if (restore) {
    const file = path.resolve(restore);
    if (!fs.existsSync(file)) throw new Error(`Yedek dosyası bulunamadı: ${file}`);
    if (!write) {
      console.log(`[kuru] ${file} yedeğinden diller geri yüklenecekti (hiçbir şey yazılmadı).`);
      return;
    }
    await restoreSnapshot(file, operator!.trim());
    return;
  }

  const target = await prisma.locale.findUnique({ where: { code } });
  if (!target) {
    console.log(`[atla] "${code}" kodlu dil kayıtlı değil; yapılacak değişiklik yok.`);
    await printState();
    return;
  }
  if (target.isDefault) {
    throw new Error(`"${code}" VARSAYILAN dil (isDefault=true) — kapatılamaz. Önce varsayılan dili devredin: npx tsx scripts/switch-default-locale-to-en.ts --target en`);
  }
  const defaultRow = await prisma.locale.findFirst({ where: { isDefault: true }, select: { code: true, enabled: true } });
  if (!defaultRow || !defaultRow.enabled) throw new Error("Etkin bir varsayılan dil yok; işlem durduruldu.");
  console.log(`[bilgi] varsayılan dil: "${defaultRow.code}" (değişmez).`);

  if (!target.enabled) {
    console.log(`[atla] "${code}" zaten enabled=false — değişiklik gerekmiyor.`);
    await printState();
    return;
  }
  console.log(`[plan] "${code}" enabled=true -> false (çeviriler, slug'lar ve içerik KORUNUR).`);
  if (!write) {
    console.log("[kuru] hiçbir şey yazılmadı.");
    await printState();
    return;
  }

  const dir = path.resolve(backupDir ?? "storage/backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `locales-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(await readSnapshot(), null, 2), "utf8");
  console.log(`[yedek] ${file}`);

  await prisma.$transaction(async (tx) => {
    await tx.locale.update({ where: { code }, data: { enabled: false } });
    await tx.auditLog.create({
      data: { actorEmail: `script:${operator!.trim()}`, action: "locale.disable_site_locale", targetType: "Locale", targetId: code, metadata: { script: "disable-site-locale", code, backup: path.basename(file) } },
    });
  });
  console.log(`[fix] "${code}" kapatıldı (enabled=false).`);
  await printState();
  console.log(`[geri al] npx tsx scripts/disable-site-locale.ts --restore=${file} --confirm=${CONFIRM_TOKEN} --operator=<ad>`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
