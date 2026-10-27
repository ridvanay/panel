import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import {
  ADD_LOCALES_AUDIT_ACTION,
  ADD_LOCALES_CONFIRM_KEY,
  ENABLE_LOCALES_AUDIT_ACTION,
  SiteLocalesError,
  applyLocalesPlan,
  buildLocalesPlan,
  parseEnableArg,
} from "../../src/lib/site-locales-setup";

/**
 * Paket L (2026-10-23) — `add-site-locales`: kuru çalışma yazmaz; diller kapalı eklenir ve public
 * `/locales`'te görünmez; tr/en ve isDefault'a dokunulmaz; `--enable` yalnızca dört yeni dili açar.
 * `resetDatabase` dil satırlarını silmediği için test kendi satırlarını temizler.
 */
// Paket T — ro/fr/sr-latn eklendi.
const NEW = ["es", "de", "ar", "ru", "ro", "fr", "sr-latn"];
const OP = { operator: "Test Operatör", osUser: "ci", hostname: "test-host", revalidate: false };

describe("add-site-locales (Paket L)", () => {
  let app: FastifyInstance;

  async function baseline() {
    await app.prisma.locale.deleteMany({ where: { code: { in: NEW } } });
    await app.prisma.auditLog.deleteMany({ where: { action: { in: [ADD_LOCALES_AUDIT_ACTION, ENABLE_LOCALES_AUDIT_ACTION] } } });
    await app.prisma.locale.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    for (const l of [
      { code: "en", label: "İngilizce", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0 },
      { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: false, enabled: true, sortOrder: 1 },
    ]) {
      await app.prisma.locale.upsert({ where: { code: l.code }, create: l, update: l });
    }
  }

  // Ortak test DB'sindeki dil satırları bu dosyadan önceki hâline geri döndürülür (diğer dosyalar etkilenmesin).
  let originalLocales: Awaited<ReturnType<FastifyInstance["prisma"]["locale"]["findMany"]>> = [];

  beforeAll(async () => {
    app = await buildTestApp();
    originalLocales = await app.prisma.locale.findMany();
  });

  beforeEach(baseline);

  afterAll(async () => {
    await app.prisma.locale.deleteMany({ where: { code: { in: NEW } } });
    await app.prisma.locale.updateMany({ data: { isDefault: false } });
    for (const row of originalLocales) {
      await app.prisma.locale.upsert({ where: { code: row.code }, create: row, update: row });
    }
    await app.close();
  });

  it("kuru çalışma (plan) hiçbir şey yazmaz", async () => {
    const plan = await buildLocalesPlan(app.prisma);
    expect(plan.toCreate.map((l) => l.code)).toEqual(NEW);
    expect(plan.toCreate.map((l) => l.sortOrder)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(await app.prisma.locale.count({ where: { code: { in: NEW } } })).toBe(0);
  });

  it("onaysız yazmaz; onayla kapalı ekler, tr/en ve varsayılan değişmez, public /locales'te görünmez", async () => {
    const before = await app.prisma.locale.findMany({ where: { code: { in: ["tr", "en"] } }, orderBy: { code: "asc" } });
    const plan = await buildLocalesPlan(app.prisma);
    await expect(applyLocalesPlan(app.prisma, plan, OP)).rejects.toThrow(SiteLocalesError);

    const result = await applyLocalesPlan(app.prisma, plan, { ...OP, confirm: ADD_LOCALES_CONFIRM_KEY });
    expect(result.created).toEqual(NEW);
    const rows = await app.prisma.locale.findMany({ where: { code: { in: NEW } }, orderBy: { sortOrder: "asc" } });
    expect(rows.map((r) => [r.code, r.nativeLabel, r.hreflang, r.enabled, r.isDefault])).toEqual([
      ["es", "Español", "es", false, false],
      ["de", "Deutsch", "de", false, false],
      ["ar", "العربية", "ar", false, false],
      ["ru", "Русский", "ru", false, false],
      ["ro", "Română", "ro", false, false],
      ["fr", "Français", "fr", false, false],
      ["sr-latn", "Srpski", "sr-Latn", false, false],
    ]);
    expect(await app.prisma.locale.findMany({ where: { code: { in: ["tr", "en"] } }, orderBy: { code: "asc" } })).toEqual(before);
    expect(await app.prisma.auditLog.count({ where: { action: ADD_LOCALES_AUDIT_ACTION } })).toBe(1);

    const res = await app.inject({ method: "GET", url: "/api/v1/locales" });
    const codes = (res.json().data as { code: string }[]).map((l) => l.code);
    expect(codes).toEqual(expect.arrayContaining(["en", "tr"]));
    for (const code of NEW) expect(codes).not.toContain(code);

    // Tekrar çalıştırma: eklenecek bir şey kalmaz, mevcut satıra dokunulmaz.
    const again = await buildLocalesPlan(app.prisma);
    expect(again.toCreate).toEqual([]);
  });

  it("--enable yalnızca yeni dilleri kabul eder ve onayla açar", async () => {
    expect(() => parseEnableArg("es,it")).toThrow(/bilinmeyen: it/);
    expect(parseEnableArg("ro, SR-LATN")).toEqual(["ro", "sr-latn"]);
    expect(() => parseEnableArg("tr")).toThrow(SiteLocalesError);
    await applyLocalesPlan(app.prisma, await buildLocalesPlan(app.prisma), { ...OP, confirm: ADD_LOCALES_CONFIRM_KEY });

    const plan = await buildLocalesPlan(app.prisma, parseEnableArg("es, ar"));
    expect(plan.toEnable).toEqual(["es", "ar"]);
    const result = await applyLocalesPlan(app.prisma, plan, { ...OP, confirm: ADD_LOCALES_CONFIRM_KEY });
    expect(result.enabled).toEqual(["es", "ar"]);

    const res = await app.inject({ method: "GET", url: "/api/v1/locales" });
    const codes = (res.json().data as { code: string }[]).map((l) => l.code);
    expect(codes).toEqual(expect.arrayContaining(["es", "ar"]));
    expect(codes).not.toContain("de");
    expect(codes).not.toContain("ru");
    expect((await app.prisma.locale.findUniqueOrThrow({ where: { code: "en" } })).isDefault).toBe(true);
    expect(await app.prisma.auditLog.count({ where: { action: ENABLE_LOCALES_AUDIT_ACTION } })).toBe(1);
  });

  it("Paket T — Paket L dilleri zaten varken (canlı durumu) yalnızca ro/fr/sr-latn kapalı eklenir: sortOrder 6, 7, 8; mevcutlara dokunulmaz", async () => {
    const paketL = [
      { code: "es", nativeLabel: "Español", hreflang: "es", sortOrder: 2 },
      { code: "de", nativeLabel: "Deutsch", hreflang: "de", sortOrder: 3 },
      { code: "ar", nativeLabel: "العربية", hreflang: "ar", sortOrder: 4 },
      { code: "ru", nativeLabel: "Русский", hreflang: "ru", sortOrder: 5 },
    ];
    for (const l of paketL) await app.prisma.locale.create({ data: { ...l, label: l.code, enabled: true, isDefault: false } });
    const before = await app.prisma.locale.findMany({ orderBy: { code: "asc" } });

    const plan = await buildLocalesPlan(app.prisma);
    expect(plan.toCreate.map((l) => [l.code, l.sortOrder, l.hreflang])).toEqual([
      ["ro", 6, "ro"],
      ["fr", 7, "fr"],
      ["sr-latn", 8, "sr-Latn"],
    ]);
    await applyLocalesPlan(app.prisma, plan, { ...OP, confirm: ADD_LOCALES_CONFIRM_KEY });
    const after = await app.prisma.locale.findMany({ where: { code: { in: before.map((r) => r.code) } }, orderBy: { code: "asc" } });
    expect(after).toEqual(before);
    const added = await app.prisma.locale.findMany({ where: { code: { in: ["ro", "fr", "sr-latn"] } } });
    expect(added.every((r) => !r.enabled && !r.isDefault)).toBe(true);
    const res = await app.inject({ method: "GET", url: "/api/v1/locales" });
    const codes = (res.json().data as { code: string }[]).map((l) => l.code);
    for (const code of ["ro", "fr", "sr-latn"]) expect(codes).not.toContain(code);
  });
});
