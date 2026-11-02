import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDatabase } from "../helpers/reset-db";

/** Paket AJ-6 - scripts/fill-footer-intermediary.ts smoke testi (alt surecte tsx; yalnizca test DB'si). */
const SCRIPT_PATH = path.resolve(__dirname, "../../scripts/fill-footer-intermediary.ts");
const TSX_CLI = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");
const CONFIRM = ["--confirm=fill-footer-intermediary", "--operator=test"];

function runScript(args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH, ...args], { cwd: path.resolve(__dirname, "../.."), env: { ...process.env, ...env }, encoding: "utf8" });
}

describe("scripts/fill-footer-intermediary.ts", () => {
  const prisma = new PrismaClient();
  let backupDir: string;

  beforeEach(async () => {
    await resetDatabase(prisma);
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "footer-fill-"));
    await prisma.specialty.createMany({
      data: [
        { name: "Obesity & Metabolic Surgery", slug: "obesity-and-metabolic-surgery", icon: "Target", order: 0, translations: { de: { name: "Adipositas- & Stoffwechselchirurgie" } } },
        { name: "Dental Treatments", slug: "dental", icon: "Smile", order: 1 },
        { name: "Passive Service", slug: "passive", icon: "Smile", order: 2, isActive: false },
      ],
    });
    const parent = await prisma.specialty.findUniqueOrThrow({ where: { slug: "dental" } });
    await prisma.specialty.create({ data: { name: "Implants", slug: "implants", icon: "Smile", parentId: parent.id } });
    const priv = await prisma.page.create({ data: { title: "Privacy Notice", slug: "privacy-notice", status: "PUBLISHED", isLegalDocument: true } });
    const kvkk = await prisma.page.create({ data: { title: "KVKK Aydınlatma Metni", slug: "kvkk-aydinlatma-metni", status: "PUBLISHED", isLegalDocument: true } });
    const draft = await prisma.page.create({ data: { title: "Terms of Use", slug: "terms-of-use", status: "DRAFT", isLegalDocument: true } });
    await prisma.contentSlug.createMany({
      data: [
        { entityType: "PAGE", entityId: priv.id, locale: "en", slug: "privacy-notice" },
        { entityType: "PAGE", entityId: kvkk.id, locale: "tr", slug: "kvkk-aydinlatma-metni" },
        { entityType: "PAGE", entityId: draft.id, locale: "en", slug: "terms-of-use" },
      ],
    });
    await prisma.footerColumn.create({ data: { title: "Platform", order: 0, links: { create: [{ label: "Ana Sayfa", href: "/", order: 0 }, { label: "Custom Link", href: "/custom", order: 1 }] } } });
    await prisma.footerColumn.create({ data: { title: "Services", order: 1, links: { create: [{ label: "Doctors", href: "/physicians", order: 0 }] } } });
    await prisma.footerColumn.create({ data: { title: "Legal", order: 2, links: { create: [{ label: "KVKK", href: "/kvkk-aydinlatma-metni", order: 0 }] } } });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  const snapshot = async () =>
    (await prisma.footerColumn.findMany({ orderBy: { order: "asc" }, include: { links: { orderBy: { order: "asc" } } } })).map((c) => [c.title, c.links.map((l) => `${l.label}|${l.href}|${l.order}`)] as const);

  it("kuru calistirma hicbir sey yazmaz; plani ve uyarilari yazdirir", async () => {
    const before = await snapshot();
    const res = runScript([`--backup-dir=${backupDir}`]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/\[hedef DB\] [^\s]+:\d+\/saas_test/);
    expect(res.stdout).toContain("EKLENİR");
    expect(res.stdout).toContain("ÇIKARILIR");
    expect(res.stdout).toContain("Yasal sayfa yayında değil");
    expect(res.stdout).toContain("[kuru]");
    expect(await snapshot()).toEqual(before);
    expect(fs.readdirSync(backupDir)).toHaveLength(0);
  });

  it("gercek calistirma: 3 sutun dolar (8 dil), hekim ve TR yasal baglantilar cikar, ozel baglanti korunur; idempotent; restore", async () => {
    const before = await snapshot();
    const res = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    expect(res.status, res.stderr).toBe(0);
    const after = await snapshot();
    expect(after[0]).toEqual([
      "Platform",
      ["Home|/|0", "About|/about|1", "VIP Accommodation & Transfer|/vip-accommodation-transfer|2", "Health Guides|/blog|3", "Contact|/contact|4", "Custom Link|/custom|5"],
    ]);
    expect(after[1]).toEqual(["Services", ["Obesity & Metabolic Surgery|/specialties/obesity-and-metabolic-surgery|0", "Dental Treatments|/specialties/dental|1"]]);
    expect(after[2]).toEqual(["Legal", ["Privacy Notice|/privacy-notice|0"]]);

    const home = await prisma.footerLink.findFirstOrThrow({ where: { href: "/" } });
    expect((home.translations as Record<string, { label: string }>).de?.label).toBe("Startseite");
    const obesity = await prisma.footerLink.findFirstOrThrow({ where: { href: "/specialties/obesity-and-metabolic-surgery" } });
    expect((obesity.translations as Record<string, { label: string }>).de?.label).toBe("Adipositas- & Stoffwechselchirurgie");
    const legalCol = await prisma.footerColumn.findFirstOrThrow({ where: { title: "Legal" } });
    expect((legalCol.translations as Record<string, { title: string }>).ar?.title).toBe("قانوني");
    expect(await prisma.page.count({ where: { isLegalDocument: true } })).toBe(3);
    expect(await prisma.auditLog.count({ where: { action: "navigation.fill_footer_intermediary" } })).toBe(1);

    // Idempotent
    const again = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain("Yapılacak değişiklik yok");
    expect(await snapshot()).toEqual(after);

    // Restore
    const backup = fs.readdirSync(backupDir).find((f) => f.startsWith("footer-fill-"));
    expect(backup).toBeTruthy();
    const restore = runScript([`--restore=${path.join(backupDir, backup!)}`, ...CONFIRM]);
    expect(restore.status, restore.stderr).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it("NODE_ENV=production iken yazma --i-know-this-is-prod ister; bayrakla gecer", async () => {
    const blocked = runScript([...CONFIRM, `--backup-dir=${backupDir}`], { NODE_ENV: "production" });
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain("--i-know-this-is-prod");
    const allowed = runScript([...CONFIRM, "--i-know-this-is-prod", `--backup-dir=${backupDir}`], { NODE_ENV: "production" });
    expect(allowed.status, allowed.stderr).toBe(0);
  });
});
