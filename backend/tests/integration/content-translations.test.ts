import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import {
  IMPORT_AUDIT_ACTION,
  IMPORT_CONFIRM_KEY,
  RESTORE_CONFIRM_KEY,
  TranslationImportError,
  applyImportPlan,
  buildImportPlan,
  buildTranslationExport,
  readTranslationFile,
  restoreTranslations,
  type TranslationExport,
} from "../../src/lib/content-translations";

/**
 * Paket L (2026-10-23) — export (salt okuma) ve import: yalnızca translations.es|de|ar|ru yazılır,
 * kanonik (EN) ve tr içeriğe dokunulmaz; yapı/bağlantı değiştiren çeviri ve bayat kalem atlanır;
 * yedek + tek transaction + audit; geri dönüş yalnızca hedef dilleri geri alır.
 */
const OP = { operator: "Test Operatör", osUser: "ci", hostname: "test-host", revalidate: false };
const NEW = ["es", "de", "ar", "ru"];

const BLOCKS = [
  { id: "h1", type: "heading", data: { text: "Our clinic", level: 2, href: "/about" } },
  { id: "t1", type: "text", data: { html: "<p>We care for you.</p>" } },
];

describe("content-translations (Paket L)", () => {
  let app: FastifyInstance;
  let dir: string;
  let originalLocales: Awaited<ReturnType<FastifyInstance["prisma"]["locale"]["findMany"]>> = [];
  let pageId: string;
  let doctorId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    originalLocales = await app.prisma.locale.findMany();
  });

  beforeEach(async () => {
    await resetDatabase(app.prisma);
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "translations-"));
    await app.prisma.locale.updateMany({ data: { isDefault: false } });
    const rows = [
      { code: "en", label: "İngilizce", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0 },
      { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: false, enabled: true, sortOrder: 1 },
      ...NEW.map((code, i) => ({ code, label: code, nativeLabel: code, isDefault: false, enabled: false, sortOrder: 2 + i })),
    ];
    for (const l of rows) await app.prisma.locale.upsert({ where: { code: l.code }, create: l, update: l });

    const page = await app.prisma.page.create({
      data: {
        slug: "about",
        title: "About",
        status: "PUBLISHED",
        blocks: BLOCKS,
        translations: { tr: { title: "Hakkımızda", blocks: BLOCKS } },
      },
    });
    pageId = page.id;
    await app.prisma.page.create({ data: { slug: "privacy", title: "Privacy", status: "PUBLISHED", isLegalDocument: true, blocks: BLOCKS } });
    const doctor = await app.prisma.doctorProfile.create({
      data: {
        title: "Dr.",
        fullName: "Vahit Mutlu",
        slug: "vahit-mutlu",
        bio: "General surgeon.",
        aboutHtml: "<p>Bio</p>",
        languages: ["en"],
        timeZone: "Europe/Istanbul",
        isActive: true,
        translations: { tr: { title: "Doç. Dr.", bio: "Genel cerrah." } },
      },
    });
    doctorId = doctor.id;
    await app.prisma.specialty.create({ data: { name: "Surgical Oncology", slug: "oncology", icon: "heart-pulse" } });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.prisma.locale.deleteMany({ where: { code: { in: NEW } } });
    await app.prisma.locale.updateMany({ data: { isDefault: false } });
    for (const row of originalLocales) await app.prisma.locale.upsert({ where: { code: row.code }, create: row, update: row });
    await app.close();
  });

  async function translatedFile(mutate: (data: TranslationExport) => void): Promise<string> {
    const data = await buildTranslationExport(app.prisma);
    mutate(data);
    const file = path.join(dir, `translated-${Math.random().toString(36).slice(2)}.json`);
    await fs.writeFile(file, JSON.stringify(data));
    return file;
  }

  function esPage(): Record<string, unknown> {
    return {
      title: "Sobre nosotros",
      blocks: [
        { id: "h1", type: "heading", data: { text: "Nuestra clínica", level: 2, href: "/about" } },
        { id: "t1", type: "text", data: { html: "<p>Cuidamos de usted.</p><script>x</script>" } },
      ],
    };
  }

  it("export salt okumadır; yasal sayfa yok, uzmanlık bilgi amaçlı (importable: false)", async () => {
    const before = await app.prisma.page.findMany({ orderBy: { slug: "asc" } });
    const data = await buildTranslationExport(app.prisma);
    expect(data.canonicalLocale).toBe("en");
    expect(data.items.filter((i) => i.type === "page").map((i) => i.ref)).toEqual(["about"]);
    expect(data.items.find((i) => i.type === "doctor")).toMatchObject({ importable: true, fields: { title: "Dr.", bio: "General surgeon." } });
    expect(data.items.find((i) => i.type === "specialty")).toMatchObject({ importable: false });
    expect(await app.prisma.page.findMany({ orderBy: { slug: "asc" } })).toEqual(before);
  });

  it("dosyada tr/en anahtarı varsa reddedilir", async () => {
    const file = await translatedFile((d) => {
      (d.items[0]!.translations as Record<string, unknown>).tr = { title: "Ezme denemesi" };
    });
    await expect(readTranslationFile(file)).rejects.toThrow(TranslationImportError);
  });

  it("import yalnızca hedef dilleri yazar; kanonik ve tr değişmez; bağlantı değiştiren çeviri atlanır", async () => {
    const file = await translatedFile((d) => {
      d.items.find((i) => i.type === "page")!.translations.es = esPage();
      const bad = esPage();
      (bad.blocks as { data: Record<string, unknown> }[])[0]!.data.href = "https://evil.example";
      d.items.find((i) => i.type === "page")!.translations.de = bad;
      d.items.find((i) => i.type === "doctor")!.translations.ar = { title: "د.", bio: "جراح عام.", aboutHtml: '<p onclick="alert(1)">سيرة</p>' };
      d.items.find((i) => i.type === "specialty")!.translations.ru = { name: "Хирургическая онкология" };
    });
    const plan = await buildImportPlan(app.prisma, await readTranslationFile(file));
    expect(plan.pages.map((p) => p.locale)).toEqual(["es"]);
    expect(plan.doctors.map((d) => d.locale)).toEqual(["ar"]);
    expect(plan.skipped.map((s) => `${s.type}/${s.locale ?? "-"}`)).toEqual(expect.arrayContaining(["page/de", "specialty/-"]));

    // Kuru çalışma (plan) hiçbir şey yazmadı.
    expect((await app.prisma.page.findUniqueOrThrow({ where: { id: pageId } })).translations).not.toHaveProperty("es");
    await expect(applyImportPlan(app.prisma, plan, { ...OP, backupDir: dir, sourceFile: file })).rejects.toThrow(TranslationImportError);

    const { backupFile } = await applyImportPlan(app.prisma, plan, { ...OP, confirm: IMPORT_CONFIRM_KEY, backupDir: dir, sourceFile: file });
    const page = await app.prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    const translations = page.translations as Record<string, { title: string; blocks: { data: { html?: string } }[] }>;
    expect(page.title).toBe("About");
    expect(page.blocks).toEqual(BLOCKS);
    expect(translations.tr).toEqual({ title: "Hakkımızda", blocks: BLOCKS });
    expect(translations.es!.title).toBe("Sobre nosotros");
    expect(JSON.stringify(translations.es)).not.toContain("<script");
    expect(await app.prisma.contentSlug.count({ where: { entityId: pageId, locale: "es" } })).toBe(1);

    const doctor = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    const dt = doctor.translations as Record<string, Record<string, string>>;
    expect(doctor.title).toBe("Dr.");
    expect(dt.tr).toEqual({ title: "Doç. Dr.", bio: "Genel cerrah." });
    expect(dt.ar!.title).toBe("د.");
    expect(dt.ar!.aboutHtml).not.toContain("onclick");

    expect(await app.prisma.auditLog.count({ where: { action: IMPORT_AUDIT_ACTION } })).toBe(1);
    expect(JSON.parse(await fs.readFile(backupFile, "utf8")).pages[0].translations).not.toHaveProperty("es");
  });

  it("kanonik metin export'tan sonra değiştiyse kalem atlanır", async () => {
    const file = await translatedFile((d) => {
      d.items.find((i) => i.type === "page")!.translations.es = esPage();
    });
    await app.prisma.page.update({ where: { id: pageId }, data: { title: "About us" } });
    const plan = await buildImportPlan(app.prisma, await readTranslationFile(file));
    expect(plan.pages).toEqual([]);
    expect(plan.skipped[0]!.reason).toMatch(/değişmiş/);
  });

  it("geri dönüş yalnızca hedef dilleri yedekteki hâline döndürür; tr korunur (yedek elle değiştirilse bile)", async () => {
    const file = await translatedFile((d) => {
      d.items.find((i) => i.type === "page")!.translations.es = esPage();
    });
    const { backupFile } = await applyImportPlan(app.prisma, await buildImportPlan(app.prisma, await readTranslationFile(file)), {
      ...OP,
      confirm: IMPORT_CONFIRM_KEY,
      backupDir: dir,
      sourceFile: file,
    });
    const tampered = JSON.parse(await fs.readFile(backupFile, "utf8"));
    tampered.pages[0].translations.tr = { title: "Ezilmiş", blocks: [] };
    await fs.writeFile(backupFile, JSON.stringify(tampered));

    await expect(restoreTranslations(app.prisma, backupFile, { ...OP, backupDir: dir })).rejects.toThrow(TranslationImportError);
    await restoreTranslations(app.prisma, backupFile, { ...OP, confirm: RESTORE_CONFIRM_KEY, backupDir: dir });
    const translations = (await app.prisma.page.findUniqueOrThrow({ where: { id: pageId } })).translations as Record<string, unknown>;
    expect(translations).not.toHaveProperty("es");
    expect(translations.tr).toEqual({ title: "Hakkımızda", blocks: BLOCKS });
  });
});
