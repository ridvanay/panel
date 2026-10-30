/**
 * Paket W / W-ek — eşleştirme sihirbazı kataloğu (314 konu + 18 kırmızı bayrak, 9 dil eş anlamlılar).
 * Kaynak tablo: docs/prompts/2026-10-31-W-ek-katalog.md. Mantık: `src/lib/care-topics/seed.ts`.
 * Varsayılan: yalnızca yeni konuları ekler, var olana dokunmaz. `--update-existing`: var olan kayıt
 * seed'den beri DEĞİŞMEMİŞSE (içerik özeti) günceller; admin değiştirdiyse atlar.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/seed-care-topics.ts [--update-existing]                                 # kuru çalışma
 *   npx tsx scripts/seed-care-topics.ts [--update-existing] --confirm=seed-care-topics --operator="Ad Soyad"
 */
import os from "node:os";
import { PrismaClient } from "@prisma/client";
import { SEED_CARE_TOPICS_CONFIRM_KEY, applySeedCareTopicsPlan, buildSeedCareTopicsPlan, formatSeedCareTopicsPlan } from "../src/lib/care-topics/seed";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const plan = await buildSeedCareTopicsPlan(prisma, { updateExisting: process.argv.includes("--update-existing") });
    console.log(formatSeedCareTopicsPlan(plan));
    const confirm = arg("confirm");
    if (!confirm) {
      console.log(`\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Yazmak için --confirm=${SEED_CARE_TOPICS_CONFIRM_KEY} --operator="Ad Soyad" ekleyin.`);
      return;
    }
    const result = await applySeedCareTopicsPlan(prisma, plan, { confirm, operator: arg("operator") ?? "", osUser: os.userInfo().username, hostname: os.hostname() });
    console.log(`\nEklendi: ${result.created.length} · Güncellendi: ${result.updated.length}${result.skippedChanged.length ? ` · Yazım sırasında değişmiş, atlandı: ${result.skippedChanged.join(", ")}` : ""}`);
  } catch (err) {
    console.error(`HATA: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
