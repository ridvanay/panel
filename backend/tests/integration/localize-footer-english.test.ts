import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDatabase } from "../helpers/reset-db";

/** Paket AH - scripts/localize-footer-english.ts smoke testi (alt surecte tsx; yalnizca test DB'si). */
const SCRIPT_PATH = path.resolve(__dirname, "../../scripts/localize-footer-english.ts");
const TSX_CLI = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");
const CONFIRM = ["--confirm=localize-footer-english", "--operator=test"];

function runScript(args: string[] = []) {
  return spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH, ...args], { cwd: path.resolve(__dirname, "../.."), env: { ...process.env }, encoding: "utf8" });
}

describe("scripts/localize-footer-english.ts", () => {
  const prisma = new PrismaClient();
  let backupDir: string;

  beforeEach(async () => {
    await resetDatabase(prisma);
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "footer-backup-"));
    const kvkk = await prisma.page.create({ data: { title: "KVKK Aydınlatma Metni", slug: "kvkk-aydinlatma-metni", status: "PUBLISHED", isLegalDocument: true } });
    const priv = await prisma.page.create({ data: { title: "Privacy Notice", slug: "privacy-notice", status: "PUBLISHED", isLegalDocument: true } });
    await prisma.contentSlug.createMany({
      data: [
        { entityType: "PAGE", entityId: kvkk.id, locale: "tr", slug: "kvkk-aydinlatma-metni" },
        { entityType: "PAGE", entityId: kvkk.id, locale: "en", slug: "privacy-notice-tr" },
        { entityType: "PAGE", entityId: priv.id, locale: "en", slug: "privacy-notice" },
      ],
    });
    await prisma.footerColumn.create({
      data: {
        title: "Branşlar",
        order: 0,
        links: { create: [{ label: "Doktorlarımız", href: "/physicians", order: 0 }, { label: "Sağlık Rehberleri", href: "/blog", order: 1 }] },
      },
    });
    await prisma.footerColumn.create({
      data: {
        title: "Yasal",
        order: 1,
        translations: { de: { title: "Alt" } },
        links: {
          create: [
            { label: "KVKK Aydınlatma Metni", href: "/kvkk-aydinlatma-metni", order: 0 },
            { label: "Privacy Notice", href: "/privacy-notice", order: 1 },
            { label: "Gizlilik Politikası", href: "/gizlilik", order: 2 },
            { label: "Bilinmeyen Türkçe Bağlantı", href: "/x", order: 3 },
          ],
        },
      },
    });
    await prisma.siteSettings.create({ data: { id: "singleton", tagline: "Evinizden Uzman Doktorlarla Görüşün", footerCopyrightText: "Tüm hakları saklıdır." } });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  const columns = async () => (await prisma.footerColumn.findMany({ orderBy: { order: "asc" }, include: { links: { orderBy: { order: "asc" } } } })).map((c) => [c.title, c.links.map((l) => `${l.label}|${l.href}|${l.order}`)]);

  it("kuru calistirma hicbir sey yazmaz; plani ve uyarilari yazdirir", async () => {
    const res = runScript([`--backup-dir=${backupDir}`]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('sütun "Branşlar" -> "Services"');
    expect(res.stdout).toContain("ÇIKARILIR");
    expect(res.stdout).toContain("[uyarı] sözlükte yok");
    expect(res.stdout).toContain("[kuru]");
    expect((await columns())[0]![0]).toBe("Branşlar");
    expect(fs.readdirSync(backupDir)).toHaveLength(0);
  });

  it("gercek calistirma: EN + 8 dil, TR yasal ve hekim baglantilari cikar (sayfa kayitlari kalir), slogan/telif null; idempotent", async () => {
    expect(runScript([...CONFIRM, `--backup-dir=${backupDir}`]).status).toBe(0);
    expect(await columns()).toEqual([
      ["Services", ["Health Guides|/blog|0"]],
      ["Legal", ["Privacy Notice|/privacy-notice|0", "Privacy Policy|/gizlilik|1", "Bilinmeyen Türkçe Bağlantı|/x|2"]],
    ]);
    const legal = await prisma.footerColumn.findFirstOrThrow({ where: { title: "Legal" } });
    const t = legal.translations as Record<string, { title: string }>;
    expect(Object.keys(t).sort()).toEqual(["ar", "de", "en", "es", "fr", "ro", "ru", "sr-latn"]);
    expect(t.de!.title).toBe("Rechtliches");
    const guides = await prisma.footerLink.findFirstOrThrow({ where: { href: "/blog" } });
    expect((guides.translations as Record<string, { label: string }>)["sr-latn"]!.label).toBe("Vodiči za zdravlje");
    expect(await prisma.page.count({ where: { isLegalDocument: true } })).toBe(2);
    const s = await prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect([s.tagline, s.footerCopyrightText]).toEqual([null, null]);
    expect(fs.readdirSync(backupDir)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: "navigation.localize_footer_english" } })).toBe(1);

    const again = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("Yapılacak değişiklik yok");
    expect(fs.readdirSync(backupDir)).toHaveLength(1);
  });

  it("gecersiz confirm / operatorsuz yazma reddedilir", () => {
    expect(runScript(["--confirm=yanlis", "--operator=x"]).status).not.toBe(0);
    expect(runScript(["--confirm=localize-footer-english"]).status).not.toBe(0);
  });

  it("restore footer'i ve slogan/telif metnini eski hale dondurur", async () => {
    const before = await columns();
    runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    const file = path.join(backupDir, fs.readdirSync(backupDir)[0]!);
    expect(runScript([`--restore=${file}`]).stdout).toContain("[kuru]");
    const res = runScript([`--restore=${file}`, ...CONFIRM]);
    expect(res.status, res.stderr).toBe(0);
    expect(await columns()).toEqual(before);
    const s = await prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect([s.tagline, s.footerCopyrightText]).toEqual(["Evinizden Uzman Doktorlarla Görüşün", "Tüm hakları saklıdır."]);
    expect(await prisma.auditLog.count({ where: { action: "navigation.restore_footer_english" } })).toBe(1);
  });
});
