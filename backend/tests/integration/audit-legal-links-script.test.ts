import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDatabase } from "../helpers/reset-db";

/**
 * Paket A2 (2026-10-18) — `scripts/audit-legal-links.ts` (salt okunur tespit) script-smoke-test'i.
 * `add-home-journey-faq-blocks-script.test.ts` deseni: ayrı alt process (`tsx`), stdout + DB doğrulanır.
 */
const SCRIPT_PATH = path.resolve(__dirname, "../../scripts/audit-legal-links.ts");
const TSX_CLI = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");

function runScript() {
  return spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH], { cwd: path.resolve(__dirname, "../.."), env: { ...process.env }, encoding: "utf8" });
}

describe("scripts/audit-legal-links.ts", () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  it("başlık yazılmış ve var olmayan sayfaya giden footer linklerini raporlar, eksik yasal metinleri listeler, hiçbir şey yazmaz", async () => {
    await prisma.page.create({ data: { title: "KVKK Aydınlatma Metni", slug: "kvkk-aydinlatma-metni", status: "PUBLISHED", isLegalDocument: true } });
    await prisma.footerColumn.create({
      data: {
        title: "Yasal",
        order: 0,
        links: {
          create: [
            { label: "KVKK", href: "/kvkk-aydinlatma-metni", order: 0 },
            { label: "Mesafeli", href: "/Distance Service Agreement", order: 1 },
            { label: "Koşullar", href: "/terms-of-use", order: 2 },
            { label: "Doktorlar", href: "/doctors", order: 3 },
          ],
        },
      },
    });
    const pageCountBefore = await prisma.page.count();

    const result = runScript();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("/Distance Service Agreement  — GEÇERSİZ KARAKTER");
    expect(result.stdout).toContain("/terms-of-use  — yayınlanmış sayfa YOK");
    expect(result.stdout).not.toContain("[!] /kvkk-aydinlatma-metni");
    expect(result.stdout).not.toContain("[!] /doctors");
    expect(result.stdout).toContain("[ok] KVKK Aydınlatma Metni");
    expect(result.stdout).toContain("[EKSİK] Sağlık Verisi Açık Rıza Metni");
    expect(await prisma.page.count()).toBe(pageCountBefore);
  });
});
