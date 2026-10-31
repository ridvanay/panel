import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import {
  IMPORT_CONFIRM_KEY,
  RESTORE_CONFIRM_KEY,
  applyImportPlan,
  buildImportPlan,
  buildTranslationExport,
  filterExportItems,
  readTranslationFile,
  restoreTranslations,
  type TranslationExport,
} from "../../src/lib/content-translations";

/**
 * Paket Y (2026-10-30) — hekim SSS (`faq`), prosedür (`doctorProcedure`) ve galeri (`doctorMedia`)
 * çevirilerinin export/import/geri dönüş akışı.
 */
const OP = { operator: "Test Operatör", osUser: "ci", hostname: "test-host", revalidate: false };
const NEW = ["es", "de", "ar", "ru"];
const FAQ = [
  { question: "Is it safe?", answer: "Yes." },
  { question: "How long?", answer: "Two hours." },
];

describe("content-translations — hekim profili (Paket Y)", () => {
  let app: FastifyInstance;
  let dir: string;
  let originalLocales: Awaited<ReturnType<FastifyInstance["prisma"]["locale"]["findMany"]>> = [];
  let doctorId: string;
  let procedureId: string;
  let mediaId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    originalLocales = await app.prisma.locale.findMany();
  });

  beforeEach(async () => {
    await resetDatabase(app.prisma);
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "translations-y-"));
    await app.prisma.locale.updateMany({ data: { isDefault: false } });
    const rows = [
      { code: "en", label: "İngilizce", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0 },
      { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: false, enabled: true, sortOrder: 1 },
      ...NEW.map((code, i) => ({ code, label: code, nativeLabel: code, isDefault: false, enabled: false, sortOrder: 2 + i })),
    ];
    for (const l of rows) await app.prisma.locale.upsert({ where: { code: l.code }, create: l, update: l });

    const doctor = await app.prisma.doctorProfile.create({
      data: {
        title: "Dr.",
        fullName: "Vahit Mutlu",
        slug: "vahit-mutlu",
        bio: "General surgeon.",
        languages: ["en"],
        timeZone: "Europe/Istanbul",
        isActive: true,
        faq: FAQ,
        translations: { tr: { title: "Doç. Dr.", bio: "Genel cerrah." } },
      },
    });
    doctorId = doctor.id;
    const procedure = await app.prisma.doctorProcedure.create({
      data: {
        doctorId,
        isPublished: false,
        translations: {
          en: { title: "Bypass surgery", description: "Open heart.", duration: "4 hours" },
          tr: { title: "Bypass ameliyatı" },
        },
      },
    });
    procedureId = procedure.id;
    const media = await app.prisma.doctorMedia.create({
      data: { doctorId, kind: "photo", category: "clinic", translations: { en: { title: "Our clinic", alt: "Clinic lobby" } } },
    });
    mediaId = media.id;
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

  const item = (d: TranslationExport, type: string) => d.items.find((i) => i.type === type)!;

  it("export faq, prosedür (yayında olmasa da) ve galeriyi kanonik dil metniyle yazar", async () => {
    const data = await buildTranslationExport(app.prisma);
    expect(item(data, "doctor").fields.faq).toEqual(FAQ);
    expect(item(data, "doctorProcedure")).toMatchObject({
      id: procedureId,
      ref: "vahit-mutlu — Bypass surgery",
      importable: true,
      fields: { title: "Bypass surgery", description: "Open heart.", duration: "4 hours", recovery: null },
    });
    expect(item(data, "doctorMedia")).toMatchObject({ id: mediaId, importable: true, fields: { title: "Our clinic", alt: "Clinic lobby", description: null } });
    expect(filterExportItems(data.items, ["doctorProcedure:vahit-mutlu — Bypass surgery"]).items).toHaveLength(1);
  });

  it("kanonik dilde metin yoksa öğe importable:false olur ve içe aktarılmaz", async () => {
    await app.prisma.doctorProcedure.update({ where: { id: procedureId }, data: { translations: { tr: { title: "Sadece TR" } } } });
    const data = await buildTranslationExport(app.prisma);
    expect(item(data, "doctorProcedure")).toMatchObject({ importable: false, note: expect.stringMatching(/Kanonik dilde/) });
    const file = await translatedFile((d) => {
      item(d, "doctorProcedure").translations.es = { title: "Cirugía" };
    });
    const plan = await buildImportPlan(app.prisma, await readTranslationFile(file));
    expect(plan.children).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({ type: "doctorProcedure", reason: expect.stringMatching(/metin yok/) });
  });

  it("import faq/prosedür/galeriyi yalnızca hedef dile yazar; diğer diller ve kanonik değişmez; geri dönüş çalışır", async () => {
    const file = await translatedFile((d) => {
      item(d, "doctor").translations.es = {
        title: "Dr.",
        bio: "Cirujano general.",
        faq: [
          { question: "¿Es seguro?", answer: "Sí." },
          { question: "¿Cuánto dura?", answer: "Dos horas." },
        ],
      };
      item(d, "doctorProcedure").translations.es = { title: "Cirugía de bypass", description: "Corazón abierto.", duration: "4 horas" };
      item(d, "doctorMedia").translations.de = { title: "Unsere Klinik", alt: "Klinik-Lobby" };
    });
    const plan = await buildImportPlan(app.prisma, await readTranslationFile(file));
    expect(plan.skipped).toEqual([]);
    expect(plan.children.map((c) => `${c.type}/${c.locale}`)).toEqual(["doctorProcedure/es", "doctorMedia/de"]);

    const result = await applyImportPlan(app.prisma, plan, { ...OP, confirm: IMPORT_CONFIRM_KEY, backupDir: dir, sourceFile: file });
    expect(result).toMatchObject({ doctors: 1, procedures: 1, media: 1 });

    const doctor = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    expect(doctor.faq).toEqual(FAQ);
    const dt = doctor.translations as Record<string, { faq?: unknown; bio: string }>;
    expect(dt.es!.faq).toHaveLength(2);
    expect(dt.tr).toEqual({ title: "Doç. Dr.", bio: "Genel cerrah." });

    const proc = await app.prisma.doctorProcedure.findUniqueOrThrow({ where: { id: procedureId } });
    const pt = proc.translations as Record<string, Record<string, string>>;
    expect(pt.es).toEqual({ title: "Cirugía de bypass", description: "Corazón abierto.", duration: "4 horas" });
    expect(pt.en!.title).toBe("Bypass surgery");
    expect(pt.tr).toEqual({ title: "Bypass ameliyatı" });
    const med = await app.prisma.doctorMedia.findUniqueOrThrow({ where: { id: mediaId } });
    expect((med.translations as Record<string, Record<string, string>>).de).toEqual({ title: "Unsere Klinik", alt: "Klinik-Lobby" });

    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "content.translations.imported" } });
    expect(audit.metadata).toMatchObject({ doctors: 1, doctorFaq: 1, procedures: 1, media: 1 });

    const backupFile = result.backupFile;
    await restoreTranslations(app.prisma, backupFile, { ...OP, confirm: RESTORE_CONFIRM_KEY, backupDir: dir });
    expect((await app.prisma.doctorProcedure.findUniqueOrThrow({ where: { id: procedureId } })).translations).not.toHaveProperty("es");
    expect((await app.prisma.doctorMedia.findUniqueOrThrow({ where: { id: mediaId } })).translations).not.toHaveProperty("de");
    expect(((await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } })).translations as Record<string, unknown>).es).toBeUndefined();
  });

  it("faq şekil hataları, HTML ve uzunluk uyuşmazlığı reddedilir; bio yine de geçerli satır olarak değerlendirilir", async () => {
    const base = { title: "Dr.", bio: "Cirujano." };
    const file = await translatedFile((d) => {
      const t = item(d, "doctor").translations;
      t.es = { ...base, faq: [{ question: "¿Seguro?", answer: "Sí." }] }; // uzunluk uyuşmuyor
      t.de = { ...base, faq: [{ question: "Sicher?", answer: "<b>Ja</b>" }, { question: "Wie lange?", answer: "Zwei." }] }; // HTML
      t.ar = { ...base, faq: [{ question: "q".repeat(201), answer: "a" }, { question: "x", answer: "y" }] }; // uzun
      t.ru = { ...base, faq: "yok" };
    });
    const plan = await buildImportPlan(app.prisma, await readTranslationFile(file));
    expect(plan.doctors).toEqual([]);
    expect(plan.skipped.map((s) => s.locale).sort()).toEqual(["ar", "de", "es", "ru"]);
    expect(plan.skipped.find((s) => s.locale === "es")!.reason).toMatch(/kanonikle aynı/);
    expect(plan.skipped.find((s) => s.locale === "de")!.reason).toMatch(/HTML/);
  });

  it("prosedür/galeri: HTML ve alan sınırı reddedilir; zorunlu başlık", async () => {
    const file = await translatedFile((d) => {
      item(d, "doctorProcedure").translations.es = { title: "<script>x</script>" };
      item(d, "doctorProcedure").translations.de = { title: "Bypass", recovery: "x".repeat(301) };
      item(d, "doctorProcedure").translations.ar = { description: "بلا عنوان" };
      item(d, "doctorMedia").translations.es = { title: "Clínica", alt: "" }; // fotoğraf: alt zorunlu
      item(d, "doctorMedia").translations.de = { title: "Klinik", alt: "<img src=x>" };
    });
    const plan = await buildImportPlan(app.prisma, await readTranslationFile(file));
    expect(plan.children).toEqual([]);
    expect(plan.skipped).toHaveLength(5);
  });

  it("kanonik metin export'tan sonra değiştiyse bayat → reddedilir", async () => {
    const file = await translatedFile((d) => {
      item(d, "doctor").translations.es = { title: "Dr.", bio: "Cirujano.", faq: [{ question: "a", answer: "b" }, { question: "c", answer: "d" }] };
      item(d, "doctorProcedure").translations.es = { title: "Cirugía" };
      item(d, "doctorMedia").translations.es = { title: "Clínica", alt: "Vestíbulo" };
    });
    await app.prisma.doctorProfile.update({ where: { id: doctorId }, data: { faq: [{ question: "Is it safe?", answer: "Changed." }, FAQ[1]!] } });
    await app.prisma.doctorProcedure.update({
      where: { id: procedureId },
      data: { translations: { en: { title: "Bypass surgery v2" } } },
    });
    await app.prisma.doctorMedia.update({ where: { id: mediaId }, data: { translations: { en: { title: "Our clinic", alt: "New alt" } } } });
    const plan = await buildImportPlan(app.prisma, await readTranslationFile(file));
    expect(plan.doctors).toEqual([]);
    expect(plan.children).toEqual([]);
    expect(plan.skipped.map((s) => s.type).sort()).toEqual(["doctor", "doctorMedia", "doctorProcedure"]);
    expect(plan.skipped.every((s) => /Kanonik metin/.test(s.reason))).toBe(true);
  });

  it("tr koruması prosedür/galeri için de geçerli; --overwrite-locale=tr ile yazılır", async () => {
    const file = await translatedFile((d) => {
      item(d, "doctorProcedure").translations.tr = { title: "Bypass (yeni)" };
      item(d, "doctorMedia").translations.tr = { title: "Kliniğimiz", alt: "Klinik lobisi" };
    });
    const parsed = await readTranslationFile(file);
    const plan = await buildImportPlan(app.prisma, parsed);
    // Prosedürde TR dolu → atlanır; galeride TR boş → yazılır.
    expect(plan.children.map((c) => `${c.type}/${c.locale}`)).toEqual(["doctorMedia/tr"]);
    expect(plan.skipped).toEqual([expect.objectContaining({ type: "doctorProcedure", locale: "tr", reason: expect.stringMatching(/--overwrite-locale=tr/) })]);

    const forced = await buildImportPlan(app.prisma, parsed, { overwriteLocales: ["tr"] });
    expect(forced.children).toHaveLength(2);
    await applyImportPlan(app.prisma, forced, { ...OP, confirm: IMPORT_CONFIRM_KEY, backupDir: dir, sourceFile: file });
    const proc = await app.prisma.doctorProcedure.findUniqueOrThrow({ where: { id: procedureId } });
    expect((proc.translations as Record<string, Record<string, string>>).tr).toEqual({ title: "Bypass (yeni)" });
  });
});
