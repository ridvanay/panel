/**
 * Paket L (2026-10-23) — çevrilecek tüm içeriğin EN kanonik metnini TEK bir JSON dosyasına yazar.
 * SALT OKUMA: veritabanına hiçbir şey yazmaz. Kapsam: yayındaki sayfalar ve blok metinleri (SSS dahil),
 * doktor profilleri (SSS dahil), hekim prosedürleri ve galeri öğeleri (Paket Y); bilgi amaçlı (içe aktarılmaz): uzmanlıklar, menü, footer, site ayarları.
 * Yasal sayfalar (`isLegalDocument`) HARİÇ. Mantık: `src/lib/content-translations.ts`.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/export-translatable-content.ts [--out=storage/translations/export.json]
 *   npx tsx scripts/export-translatable-content.ts --only=page:home[,doctor:vahit-mutlu]   # Paket O: yalnızca seçilen kalemler (tip:ref ya da tip:id)
 *   npx tsx scripts/export-translatable-content.ts --only=doctor:vahit-mutlu,doctorProcedure:<id>,doctorMedia:<id>   # Paket Y
 *   npx tsx scripts/export-translatable-content.ts --locales=ro,fr,sr-latn               # Paket T: yalnızca bu dillerin yuvaları
 */
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { TranslationImportError, buildTranslationExport, summarizeExport } from "../src/lib/content-translations";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const only = arg("only")?.split(",").filter(Boolean);
    // Paket T — yalnızca belirtilen dillerin yuvaları (ör. --locales=ro,fr,sr-latn).
    const locales = arg("locales")?.split(",").map((l) => l.trim().toLowerCase()).filter(Boolean);
    const data = await buildTranslationExport(prisma, new Date(), { only, locales });
    const out = path.resolve(arg("out") ?? `storage/translations/export-${data.exportedAt.replace(/[:.]/g, "-")}.json`);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, JSON.stringify(data, null, 2), "utf8");
    console.log(`Kanonik dil: ${data.canonicalLocale} — kalemler:\n${summarizeExport(data)}`);
    console.log(`\nYazıldı: ${out}`);
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
