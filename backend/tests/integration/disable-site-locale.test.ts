import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDatabase } from "../helpers/reset-db";

/** Paket AH - scripts/disable-site-locale.ts smoke testi (alt surecte tsx; yalnizca test DB'si). */
const SCRIPT_PATH = path.resolve(__dirname, "../../scripts/disable-site-locale.ts");
const TSX_CLI = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");
const CONFIRM = ["--confirm=disable-site-locale", "--operator=test"];

function runScript(args: string[] = []) {
  return spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH, ...args], { cwd: path.resolve(__dirname, "../.."), env: { ...process.env }, encoding: "utf8" });
}

describe("scripts/disable-site-locale.ts", () => {
  const prisma = new PrismaClient();
  let backupDir: string;

  beforeEach(async () => {
    await resetDatabase(prisma);
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "locale-backup-"));
    await prisma.locale.deleteMany({});
    await prisma.locale.createMany({
      data: [
        { code: "en", label: "English", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0 },
        { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: false, enabled: true, sortOrder: 1 },
        { code: "de", label: "Almanca", nativeLabel: "Deutsch", isDefault: false, enabled: true, sortOrder: 2 },
      ],
    });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  const state = async () => Object.fromEntries((await prisma.locale.findMany()).map((l) => [l.code, { enabled: l.enabled, isDefault: l.isDefault }]));

  it("kuru calistirma hicbir sey yazmaz ve yedek olusturmaz", async () => {
    const res = runScript([`--backup-dir=${backupDir}`]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('[plan] "tr" enabled=true -> false');
    expect(res.stdout).toContain("[kuru]");
    expect((await state()).tr).toEqual({ enabled: true, isDefault: false });
    expect(fs.readdirSync(backupDir)).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { action: "locale.disable_site_locale" } })).toBe(0);
  });

  it("gecersiz confirm / operatorsuz yazma reddedilir", () => {
    expect(runScript(["--confirm=yanlis", "--operator=x"]).status).not.toBe(0);
    expect(runScript(["--confirm=disable-site-locale"]).status).not.toBe(0);
  });

  it("gercek calistirma tr'yi kapatir (varsayilan en ve digerleri degismez), yedek + audit; ikinci calistirma idempotent", async () => {
    const res = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    expect(res.status, res.stderr).toBe(0);
    expect(await state()).toEqual({ en: { enabled: true, isDefault: true }, tr: { enabled: false, isDefault: false }, de: { enabled: true, isDefault: false } });
    expect(fs.readdirSync(backupDir)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: "locale.disable_site_locale" } })).toBe(1);

    const again = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("zaten enabled=false");
    expect(fs.readdirSync(backupDir)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: "locale.disable_site_locale" } })).toBe(1);
  });

  it("varsayilan dil kapatilamaz (tr varsayilansa hata) ve hicbir sey degismez", async () => {
    await prisma.locale.update({ where: { code: "en" }, data: { isDefault: false } });
    await prisma.locale.update({ where: { code: "tr" }, data: { isDefault: true } });
    const res = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("VARSAYILAN dil");
    expect((await state()).tr).toEqual({ enabled: true, isDefault: true });
    expect(fs.readdirSync(backupDir)).toHaveLength(0);
  });

  it("kayitli olmayan dil icin degisiklik yok", () => {
    const res = runScript(["--code=zz"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("kayıtlı değil");
  });

  it("her calismada hedef DB (host:port/db) yazdirilir, parola YAZILMAZ", () => {
    const res = runScript();
    expect(res.stdout).toMatch(/\[hedef DB\] [^\s]+:\d+\/saas_test/);
    expect(res.stdout).not.toContain("postgres:postgres");
  });

  it("NODE_ENV=production iken yazma --i-know-this-is-prod ister; kuru calisma gerektirmez", async () => {
    const env = { ...process.env, NODE_ENV: "production" };
    const blocked = spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH, ...CONFIRM, `--backup-dir=${backupDir}`], { cwd: path.resolve(__dirname, "../.."), env, encoding: "utf8" });
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain("--i-know-this-is-prod");
    expect((await state()).tr!.enabled).toBe(true);
    const dry = spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH], { cwd: path.resolve(__dirname, "../.."), env, encoding: "utf8" });
    expect(dry.status).toBe(0);
    const ok = spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH, ...CONFIRM, "--i-know-this-is-prod", `--backup-dir=${backupDir}`], { cwd: path.resolve(__dirname, "../.."), env, encoding: "utf8" });
    expect(ok.status, ok.stderr).toBe(0);
    expect((await state()).tr!.enabled).toBe(false);
  });

  it("restore: mevcut varsayilan dil yedektekinden farkliysa DURUR (kuru ve gercek), yedek bicimi kuru restore'da dogrulanir", async () => {
    runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    const file = path.join(backupDir, fs.readdirSync(backupDir)[0]!);
    await prisma.locale.update({ where: { code: "en" }, data: { isDefault: false } });
    await prisma.locale.update({ where: { code: "de" }, data: { isDefault: true } });
    for (const extra of [[], CONFIRM]) {
      const res = runScript([`--restore=${file}`, ...extra]);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Geri yükleme DURDURULDU");
      expect(res.stderr).toContain('"de"');
    }
    expect((await state()).tr!.enabled).toBe(false);
    // Bozuk yedek: kuru restore da hata verir.
    const broken = path.join(backupDir, "broken.json");
    fs.writeFileSync(broken, JSON.stringify({ version: 1, locales: [{ code: "tr" }] }));
    const bad = runScript([`--restore=${broken}`]);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("Geçersiz yedek dosyası biçimi");
    fs.writeFileSync(broken, "{ bozuk json");
    expect(runScript([`--restore=${broken}`]).status).not.toBe(0);
  });

  it("--restore yedekten enabled/isDefault degerlerini geri yukler", async () => {
    runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    expect((await state()).tr!.enabled).toBe(false);
    const file = path.join(backupDir, fs.readdirSync(backupDir)[0]!);
    expect(runScript([`--restore=${file}`]).stdout).toContain("[kuru]");
    expect((await state()).tr!.enabled).toBe(false);
    const res = runScript([`--restore=${file}`, ...CONFIRM]);
    expect(res.status, res.stderr).toBe(0);
    expect(await state()).toEqual({ en: { enabled: true, isDefault: true }, tr: { enabled: true, isDefault: false }, de: { enabled: true, isDefault: false } });
    expect(await prisma.auditLog.count({ where: { action: "locale.restore_disable_site_locale" } })).toBe(1);
  });
});
