import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { resetDatabase } from "../helpers/reset-db";

/** Paket AJ-9 - scripts/apply-brand-theme.ts smoke testi (alt surecte tsx; yalnizca test DB'si). */
const SCRIPT_PATH = path.resolve(__dirname, "../../scripts/apply-brand-theme.ts");
const TSX_CLI = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");
const CONFIRM = ["--confirm=apply-brand-theme", "--operator=test", "--no-revalidate"];

function runScript(args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH, ...args], { cwd: path.resolve(__dirname, "../.."), env: { ...process.env, ...env }, encoding: "utf8" });
}

describe("scripts/apply-brand-theme.ts", () => {
  const prisma = new PrismaClient();
  let backupDir: string;

  beforeEach(async () => {
    await resetDatabase(prisma);
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-theme-"));
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  const row = () => prisma.siteAppearance.findUnique({ where: { id: "singleton" } });

  it("kuru calistirma: satir yoksa plan yazdirir, hicbir sey yazmaz; kontrastlar gecer", async () => {
    const res = runScript([`--backup-dir=${backupDir}`]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/\[hedef DB\] [^\s]+:\d+\/saas_test/);
    expect(res.stdout).toContain("-> #2951a0");
    expect(res.stdout).toContain("-> #4ab9e1");
    expect(res.stdout).not.toContain("KALDI");
    expect(res.stdout).toContain("[kuru]");
    expect(await row()).toBeNull();
    expect(fs.readdirSync(backupDir)).toHaveLength(0);
  });

  it("gercek calistirma mevcut indigo satiri gunceller, ikinci calisma degisiklik yapmaz, restore eski degerleri getirir", async () => {
    await prisma.siteAppearance.create({ data: { id: "singleton", presetKey: "modern-indigo", secondaryColor: "#123456" } });
    const before = await row();
    expect(before?.primaryColor).toBe("#4f46e5");
    const res = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    expect(res.status, res.stderr).toBe(0);
    const after = await row();
    expect(after).toMatchObject({ primaryColor: "#2951a0", buttonColor: "#2951a0", linkColor: "#2951a0", headerLinkActiveColor: "#2951a0", accentColor: "#4ab9e1", buttonTextColor: "#ffffff", presetKey: null, secondaryColor: "#123456" });
    expect(await prisma.auditLog.count({ where: { action: "appearance.apply_brand_theme" } })).toBe(1);

    const again = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain("Yapılacak değişiklik yok");
    expect(fs.readdirSync(backupDir)).toHaveLength(1);

    const restore = runScript([`--restore=${path.join(backupDir, fs.readdirSync(backupDir)[0]!)}`, ...CONFIRM]);
    expect(restore.status, restore.stderr).toBe(0);
    expect(await row()).toMatchObject({ primaryColor: "#4f46e5", buttonColor: "#4f46e5", accentColor: "#f59e0b", presetKey: "modern-indigo" });
  });

  it("satir yoksa olusturur; restore satiri geri siler", async () => {
    expect(runScript([...CONFIRM, `--backup-dir=${backupDir}`]).status).toBe(0);
    expect(await row()).toMatchObject({ primaryColor: "#2951a0", accentColor: "#4ab9e1" });
    expect(runScript([`--restore=${path.join(backupDir, fs.readdirSync(backupDir)[0]!)}`, ...CONFIRM]).status).toBe(0);
    expect(await row()).toBeNull();
  });

  it("kontrast yetersizse (ornegin cok acik arka plan degil, koyu arka plan) hicbir sey yazmaz", async () => {
    await prisma.siteAppearance.create({ data: { id: "singleton", backgroundColor: "#1a2a55" } });
    const res = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("KALDI");
    expect((await row())?.primaryColor).toBe("#4f46e5");
  });

  it("mor tonlu header/sayfa basligi rengi bilgi olarak listelenir (degistirilmez); production bayragi ister", async () => {
    await prisma.siteAppearance.create({ data: { id: "singleton", pageHeaderBackgroundColor: "#7c3aed" } });
    const dry = runScript([`--backup-dir=${backupDir}`]);
    expect(dry.stdout).toContain("pageHeaderBackgroundColor=#7c3aed");
    const blocked = runScript([...CONFIRM, `--backup-dir=${backupDir}`], { NODE_ENV: "production" });
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain("--i-know-this-is-prod");
    expect(runScript([...CONFIRM, "--i-know-this-is-prod", `--backup-dir=${backupDir}`], { NODE_ENV: "production" }).status).toBe(0);
    expect((await row())?.pageHeaderBackgroundColor).toBe("#7c3aed");
  });
});
