import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDatabase } from "../helpers/reset-db";

/** Paket Z1-ek — scripts/add-blog-nav-item.ts smoke testi (alt süreçte tsx; yalnızca test DB'si). */
const SCRIPT_PATH = path.resolve(__dirname, "../../scripts/add-blog-nav-item.ts");
const TSX_CLI = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");
const CONFIRM = ["--confirm=add-blog-nav", "--operator=test"];

function runScript(args: string[] = []) {
  return spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH, ...args], {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env },
    encoding: "utf8",
  });
}

describe("scripts/add-blog-nav-item.ts", () => {
  const prisma = new PrismaClient();
  let backupDir: string;

  beforeEach(async () => {
    await resetDatabase(prisma);
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "nav-backup-"));
    await prisma.navigationItem.createMany({
      data: [
        { label: "Home", href: "/", order: 0 },
        { label: "Physicians", href: "/physicians", order: 1 },
        { label: "About", href: "/about", order: 2 },
        { label: "Contact", href: "/contact", order: 3 },
      ],
    });
    await prisma.footerColumn.create({
      data: {
        title: "Company",
        order: 0,
        links: { create: [{ label: "Privacy", href: "/privacy", order: 0 }, { label: "About", href: "/about", order: 1 }, { label: "Contact", href: "/contact", order: 2 }] },
      },
    });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  const headerLabels = async () =>
    (await prisma.navigationItem.findMany({ where: { parentId: null }, orderBy: { order: "asc" } })).map((i) => i.label);
  const footerLabels = async () => (await prisma.footerLink.findMany({ orderBy: { order: "asc" } })).map((l) => l.label);

  it("kuru çalıştırma hiçbir şey yazmaz ve yedek oluşturmaz", async () => {
    const res = runScript([`--backup-dir=${backupDir}`]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("[plan] header");
    expect(res.stdout).toContain("[kuru]");
    expect(await headerLabels()).toEqual(["Home", "Physicians", "About", "Contact"]);
    expect(await footerLabels()).toEqual(["Privacy", "About", "Contact"]);
    expect(fs.readdirSync(backupDir)).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { action: "navigation.add_blog_nav_item" } })).toBe(0);
  });

  it("confirm olmadan geçersiz confirm / operatörsüz yazma reddedilir", () => {
    expect(runScript(["--confirm=yanlis", "--operator=x"]).status).not.toBe(0);
    expect(runScript(["--confirm=add-blog-nav"]).status).not.toBe(0);
  });

  it("gerçek çalıştırma header ve footer'a About'tan önce ekler; 9 dil etiket; yedek + audit; ikinci çalıştırma idempotent", async () => {
    const res = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    expect(res.status).toBe(0);
    expect(await headerLabels()).toEqual(["Home", "Physicians", "Health Guides", "About", "Contact"]);
    expect(await footerLabels()).toEqual(["Privacy", "Health Guides", "About", "Contact"]);

    const item = await prisma.navigationItem.findFirstOrThrow({ where: { href: "/blog" } });
    const link = await prisma.footerLink.findFirstOrThrow({ where: { href: "/blog" } });
    for (const t of [item.translations, link.translations] as Record<string, { label: string }>[]) {
      expect(Object.keys(t).sort()).toEqual(["ar", "de", "en", "es", "fr", "ro", "ru", "sr-latn", "tr"]);
      expect(t.tr!.label).toBe("Sağlık Rehberleri");
      expect(t["sr-latn"]!.label).toBe("Vodiči za zdravlje");
      expect(t.ar!.label).toBe("أدلة صحية");
    }
    expect(fs.readdirSync(backupDir)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: "navigation.add_blog_nav_item" } })).toBe(1);

    const again = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("Yapılacak değişiklik yok");
    expect(await prisma.navigationItem.count({ where: { href: "/blog" } })).toBe(1);
    expect(await prisma.footerLink.count({ where: { href: "/blog" } })).toBe(1);
    expect(fs.readdirSync(backupDir)).toHaveLength(1);
  });

  it("restore menüleri eski hâle döndürür", async () => {
    const before = await prisma.navigationItem.findMany({ orderBy: { order: "asc" } });
    runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    expect(await prisma.navigationItem.count({ where: { href: "/blog" } })).toBe(1);

    const file = path.join(backupDir, fs.readdirSync(backupDir)[0]!);
    expect(runScript([`--restore=${file}`]).stdout).toContain("[kuru]");
    expect(await prisma.navigationItem.count({ where: { href: "/blog" } })).toBe(1);

    const res = runScript([`--restore=${file}`, ...CONFIRM]);
    expect(res.status).toBe(0);
    const after = await prisma.navigationItem.findMany({ orderBy: { order: "asc" } });
    expect(after.map((i) => [i.id, i.label, i.order])).toEqual(before.map((i) => [i.id, i.label, i.order]));
    expect(await footerLabels()).toEqual(["Privacy", "About", "Contact"]);
    expect(await prisma.auditLog.count({ where: { action: "navigation.restore_blog_nav" } })).toBe(1);
  });

  it("About yoksa header sona, footer ilk sütunun sonuna eklenir", async () => {
    await prisma.navigationItem.deleteMany({ where: { href: "/about" } });
    await prisma.footerLink.deleteMany({ where: { href: "/about" } });
    expect(runScript([...CONFIRM, `--backup-dir=${backupDir}`]).status).toBe(0);
    expect((await headerLabels()).at(-1)).toBe("Health Guides");
    expect((await footerLabels()).at(-1)).toBe("Health Guides");
  });
});
