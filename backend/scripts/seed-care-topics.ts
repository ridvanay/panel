/**
 * Paket W — eşleştirme sihirbazı kataloğu (≈100 konu + 8 kırmızı bayrak, 9 dil eş anlamlılar).
 * Kaynak tablo: docs/prompts/2026-10-30-W-eslesme-tablosu.md. Mantık: `src/lib/care-topics/seed.ts`.
 * İdempotent: var olan konuya dokunmaz. Canlıya yüklemeden önce tablo hekim kontrolünden geçmeli.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/seed-care-topics.ts                                                    # kuru çalışma
 *   npx tsx scripts/seed-care-topics.ts --confirm=seed-care-topics --operator="Ad Soyad"
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
    const plan = await buildSeedCareTopicsPlan(prisma);
    console.log(formatSeedCareTopicsPlan(plan));
    const confirm = arg("confirm");
    if (!confirm) {
      console.log(`\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Yazmak için --confirm=${SEED_CARE_TOPICS_CONFIRM_KEY} --operator="Ad Soyad" ekleyin.`);
      return;
    }
    const result = await applySeedCareTopicsPlan(prisma, plan, { confirm, operator: arg("operator") ?? "", osUser: os.userInfo().username, hostname: os.hostname() });
    console.log(result.created.length ? `\nEklendi: ${result.created.length} konu.` : "\nEklenecek konu yoktu; hiçbir şey yazılmadı.");
  } catch (err) {
    console.error(`HATA: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
