import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDatabase } from "../helpers/reset-db";

/** Paket AH - scripts/setup-intermediary-nav.ts smoke testi (alt surecte tsx; yalnizca test DB'si). */
const SCRIPT_PATH = path.resolve(__dirname, "../../scripts/setup-intermediary-nav.ts");
const TSX_CLI = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");
const CONFIRM = ["--confirm=setup-intermediary-nav", "--operator=test"];
const LANGS = ["ar", "de", "en", "es", "fr", "ro", "ru", "sr-latn"];

function runScript(args: string[] = []) {
  return spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH, ...args], { cwd: path.resolve(__dirname, "../.."), env: { ...process.env }, encoding: "utf8" });
}

describe("scripts/setup-intermediary-nav.ts", () => {
  const prisma = new PrismaClient();
  let backupDir: string;

  beforeEach(async () => {
    await resetDatabase(prisma);
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "intermediary-nav-"));
    await prisma.navigationItem.createMany({
      data: [
        { label: "Home", href: "/", order: 0 },
        { label: "Physicians", href: "/physicians", order: 1 },
        { label: "Health Guides", href: "/blog", order: 2 },
        { label: "About", href: "/about", order: 3 },
        { label: "Contact", href: "/contact", order: 4 },
      ],
    });
    await prisma.footerColumn.create({ data: { title: "Company", order: 0, links: { create: [{ label: "Health Guides", href: "/blog", order: 0 }, { label: "Privacy", href: "/privacy", order: 1 }] } } });
    await prisma.siteSettings.create({ data: { id: "singleton", headerCtaLabel: "Book now", headerCtaHref: "/physicians", translations: { de: { tagline: "Slogan" } } } });
    const gastro = await prisma.specialty.create({ data: { name: "Gastroenterology", slug: "gastroenterology", icon: "Stethoscope", order: 0, translations: { de: { name: "Gastroenterologie" } } } });
    await prisma.specialty.create({ data: { name: "Cardiology", slug: "cardiology", icon: "Heart", order: 1 } });
    await prisma.specialty.create({ data: { name: "ESD", slug: "esd", icon: "Stethoscope", order: 2, parentId: gastro.id } });
    await prisma.specialty.create({ data: { name: "Hidden", slug: "hidden", icon: "Heart", order: 3, isActive: false } });
    const inactiveParent = await prisma.specialty.create({ data: { name: "Old parent", slug: "old-parent", icon: "Heart", order: 4, isActive: false } });
    await prisma.specialty.create({ data: { name: "Orphan sub", slug: "orphan-sub", icon: "Heart", order: 5, parentId: inactiveParent.id } });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  const roots = async () => (await prisma.navigationItem.findMany({ where: { parentId: null }, orderBy: { order: "asc" } })).map((i) => [i.label, i.href]);
  const servicesChildren = async () => {
    const parent = await prisma.navigationItem.findFirstOrThrow({ where: { href: "/specialties", parentId: null } });
    return (await prisma.navigationItem.findMany({ where: { parentId: parent.id }, orderBy: { order: "asc" } })).map((i) => [i.label, i.href]);
  };

  it("kuru calistirma hicbir sey yazmaz ve yedek olusturmaz; plani yazdirir", async () => {
    const res = runScript([`--backup-dir=${backupDir}`]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain("[plan] header kökleri: Home (/) | About (/about) | Health Tourism Services (/specialties) | VIP Accommodation & Transfer (/vip-accommodation-transfer) | Contact (/contact)");
    expect(res.stdout).toContain("[kuru]");
    expect((await roots()).map((r) => r[0])).toEqual(["Home", "Physicians", "Health Guides", "About", "Contact"]);
    expect(fs.readdirSync(backupDir)).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { action: "navigation.setup_intermediary_nav" } })).toBe(0);
  });

  it("gecersiz confirm / operatorsuz yazma reddedilir", () => {
    expect(runScript(["--confirm=yanlis", "--operator=x"]).status).not.toBe(0);
    expect(runScript(["--confirm=setup-intermediary-nav"]).status).not.toBe(0);
  });

  it("gercek calistirma: 5 kok oge, 8 dil ceviri, Health Guides header'dan cikar footer'da kalir, bolumler + All services, CTA; yedek + audit", async () => {
    const res = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    expect(res.status, res.stderr).toBe(0);
    expect(await roots()).toEqual([
      ["Home", "/"],
      ["About", "/about"],
      ["Health Tourism Services", "/specialties"],
      ["VIP Accommodation & Transfer", "/vip-accommodation-transfer"],
      ["Contact", "/contact"],
    ]);
    // Paket AH: "Health Tourism Services" ALT OGE TASIMAZ (header aktif bolumleri kendisi doldurur).
    expect(await servicesChildren()).toEqual([]);
    expect(await prisma.navigationItem.count({ where: { parentId: { not: null } } })).toBe(0);
    for (const item of await prisma.navigationItem.findMany()) {
      expect(Object.keys(item.translations as object).sort()).toEqual(LANGS);
    }
    const services = await prisma.navigationItem.findFirstOrThrow({ where: { href: "/specialties", parentId: null } });
    expect((services.translations as Record<string, { label: string }>)["sr-latn"]!.label).toBe("Usluge zdravstvenog turizma");
    // Header'da /blog yok; footer'a dokunulmadi.
    expect(await prisma.navigationItem.count({ where: { href: "/blog" } })).toBe(0);
    expect(await prisma.footerLink.count({ where: { href: "/blog" } })).toBe(1);

    const settings = await prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect([settings.headerCtaLabel, settings.headerCtaHref]).toEqual(["Appointment", "/request"]);
    const t = settings.translations as Record<string, Record<string, string>>;
    expect(t.de).toEqual({ tagline: "Slogan", headerCtaLabel: "Termin" });
    expect(Object.keys(t).sort()).toEqual(LANGS);

    expect(fs.readdirSync(backupDir)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: "navigation.setup_intermediary_nav" } })).toBe(1);
  });

  it("ikinci calistirma idempotent (yeni yedek/audit yok, menu ayni)", async () => {
    runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    const before = await prisma.navigationItem.count();
    const again = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain("Yapılacak değişiklik yok");
    expect(await prisma.navigationItem.count()).toBe(before);
    expect(fs.readdirSync(backupDir)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: "navigation.setup_intermediary_nav" } })).toBe(1);
  });

  it("footer'da /blog yoksa uyari verir", async () => {
    await prisma.footerLink.deleteMany({ where: { href: "/blog" } });
    expect(runScript().stdout).toContain("[uyarı] footer");
  });

  it("restore menuyu ve header CTA'yi eski hale dondurur", async () => {
    const before = await prisma.navigationItem.findMany({ orderBy: { order: "asc" } });
    runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    const file = path.join(backupDir, fs.readdirSync(backupDir)[0]!);
    expect(runScript([`--restore=${file}`]).stdout).toContain("[kuru]");
    expect(await prisma.navigationItem.count({ where: { href: "/vip-accommodation-transfer" } })).toBe(1);
    const res = runScript([`--restore=${file}`, ...CONFIRM]);
    expect(res.status, res.stderr).toBe(0);
    const after = await prisma.navigationItem.findMany({ orderBy: { order: "asc" } });
    expect(after.map((i) => [i.id, i.label, i.order])).toEqual(before.map((i) => [i.id, i.label, i.order]));
    const settings = await prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect([settings.headerCtaLabel, settings.headerCtaHref, settings.translations]).toEqual(["Book now", "/physicians", { de: { tagline: "Slogan" } }]);
    expect(await prisma.auditLog.count({ where: { action: "navigation.restore_intermediary_nav" } })).toBe(1);
  });
});
