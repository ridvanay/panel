/**
 * Paket J (2026-10-19) — yasal sayfaların TR/EN içeriğini `docs/legal/` klasöründen CMS'e yükler.
 * Mantık ve kurallar: `src/lib/legal-pages-publisher.ts`. Rapor: `docs/prompts/2026-10-19-J-RAPOR.md`.
 *
 * Varsayılan KURU ÇALIŞMA — hiçbir şey yazmaz; her sayfa için mevcut/yeni başlık ve içerik uzunluğu,
 * EN kaydının varlığı ve eksik yer tutucuları yazdırır.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/publish-legal-pages.ts                                   # kuru çalışma
 *   npx tsx scripts/publish-legal-pages.ts --confirm=publish-legal --operator="Ad Soyad"
 *   npx tsx scripts/publish-legal-pages.ts --restore=backups/legal-pages-<zaman>.json --confirm=restore-legal --operator="Ad Soyad"
 * Seçenekler:
 *   --dir=<yol>         docs/legal klasörü (varsayılan ../docs/legal)
 *   --backup-dir=<yol>  yedek klasörü (varsayılan backups; prod konteynerinde yazılabilir olan storage/legal-backups)
 *   --no-revalidate     yükleme sonrası ISR yenilemesini atla
 *   --allow-disabled-locale  çeviri dili (ör. en) etkin değilken bilerek yükle (çeviri sitede görünmez)
 */

import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  LegalPublishError,
  buildPublishPlan,
  formatPlan,
  loadValues,
  publishLegalPages,
  restoreLegalPages,
} from "../src/lib/legal-pages-publisher";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const prisma = new PrismaClient();
  const operatorInfo = { operator: arg("operator") ?? "", osUser: os.userInfo().username, hostname: os.hostname() };
  const backupDir = path.resolve(arg("backup-dir") ?? "backups");
  const revalidate = !process.argv.includes("--no-revalidate");
  try {
    const restore = arg("restore");
    if (restore) {
      const result = await restoreLegalPages(prisma, path.resolve(restore), { ...operatorInfo, confirm: arg("confirm"), backupDir, revalidate });
      console.log(`Geri dönüş tamam: ${result.slugs.join(", ")}`);
      console.log(`Geri dönüş öncesi hâlin yedeği: ${result.preRestoreBackup}`);
      return;
    }

    const dir = path.resolve(arg("dir") ?? "../docs/legal");
    const plan = await buildPublishPlan(prisma, dir, await loadValues(dir));
    console.log(formatPlan(plan));

    const confirm = arg("confirm");
    if (!confirm) {
      console.log("\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Yüklemek için --confirm=publish-legal --operator=\"Ad Soyad\" ekleyin.");
      return;
    }
    const result = await publishLegalPages(prisma, plan, {
      ...operatorInfo,
      confirm,
      backupDir,
      revalidate,
      allowDisabledLocale: process.argv.includes("--allow-disabled-locale"),
    });
    console.log(`\nYüklendi: ${result.slugs.join(", ")}`);
    console.log(`Yedek: ${result.backupFile}`);
    console.log(`Geri dönüş: npx tsx scripts/publish-legal-pages.ts --restore=${result.backupFile} --confirm=restore-legal --operator="..."`);
  } catch (err) {
    if (err instanceof LegalPublishError) {
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
