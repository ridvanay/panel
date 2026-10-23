/**
 * Paket L (2026-10-23) — es (Español), de (Deutsch), ar (العربية), ru (Русский) `Locale`
 * satırlarını `enabled: false` olarak ekler; istenirse açar. Mantık: `src/lib/site-locales-setup.ts`.
 *
 * Varsayılan KURU ÇALIŞMA — hiçbir şey yazmaz. `tr`/`en` satırlarına ve `isDefault` alanına dokunmaz.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/add-site-locales.ts                                                   # kuru çalışma
 *   npx tsx scripts/add-site-locales.ts --confirm=add-locales --operator="Ad Soyad"       # ekle (kapalı)
 *   npx tsx scripts/add-site-locales.ts --enable=es,de,ar,ru --confirm=add-locales --operator="Ad Soyad"  # aç
 * Seçenekler:
 *   --no-revalidate   yazma sonrası dil listesi önbellek yenilemesini atla
 */
import os from "node:os";
import { PrismaClient } from "@prisma/client";
import {
  ADD_LOCALES_CONFIRM_KEY,
  SiteLocalesError,
  applyLocalesPlan,
  buildLocalesPlan,
  formatLocalesPlan,
  parseEnableArg,
} from "../src/lib/site-locales-setup";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const plan = await buildLocalesPlan(prisma, parseEnableArg(arg("enable")));
    console.log(formatLocalesPlan(plan));
    const confirm = arg("confirm");
    if (!confirm) {
      console.log(`\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Yazmak için --confirm=${ADD_LOCALES_CONFIRM_KEY} --operator="Ad Soyad" ekleyin.`);
      return;
    }
    const result = await applyLocalesPlan(prisma, plan, {
      confirm,
      operator: arg("operator") ?? "",
      osUser: os.userInfo().username,
      hostname: os.hostname(),
      revalidate: !process.argv.includes("--no-revalidate"),
    });
    console.log(`\nEklendi: ${result.created.join(", ") || "(yok)"} — Açıldı: ${result.enabled.join(", ") || "(yok)"}`);
  } catch (err) {
    if (err instanceof SiteLocalesError) {
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
