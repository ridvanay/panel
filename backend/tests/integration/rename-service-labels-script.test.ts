import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import {
  CTA_LABEL,
  RENAME_SERVICE_LABELS_AUDIT_ACTION,
  RENAME_SERVICE_LABELS_CONFIRM_KEY,
  RENAME_SERVICE_LABELS_RESTORE_AUDIT_ACTION,
  RenameServiceLabelsError,
  SERVICE_LABEL_MAP,
  SERVICE_LANGS,
  applyServiceLabelPlan,
  buildServiceLabelBackup,
  buildServiceLabelPlan,
  formatServiceLabelPlan,
  parseServiceLabelBackup,
  restoreServiceLabels,
  validateServiceLabelMap,
} from "../../src/lib/service-labels";
import { assertProdWriteAllowed } from "../../scripts/_script-guard";

/** Paket AI — `rename-service-labels`: harita tutarlılığı, kuru çalışma, yazma, idempotent, slug değişmez, yedek/geri yükleme, CTA, prod bayrağı. */
const OP = { operator: "Test Operatör", osUser: "ci", hostname: "test-host", revalidate: false };
const CONFIRMED = { ...OP, confirm: RENAME_SERVICE_LABELS_CONFIRM_KEY };
const OLD_NAMES: Record<string, string> = { orthodontist: "Orthodontist", "interventional-radiology-specialist": "Interventional Radiology Specialist" };

describe("rename-service-labels", () => {
  let app: FastifyInstance;
  let tmp: string;

  const row = (slug: string) => app.prisma.specialty.findUniqueOrThrow({ where: { slug } });

  beforeAll(async () => {
    app = await buildTestApp();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "service-labels-"));
  });

  beforeEach(async () => {
    await resetDatabase(app.prisma);
    for (const [i, e] of SERVICE_LABEL_MAP.entries()) {
      await app.prisma.specialty.create({
        data: { name: OLD_NAMES[e.slug] ?? e.name.en, slug: e.slug, icon: "Heart", order: i, description: `Eski açıklama ${e.slug}`, translations: { de: { description: "De açıklama" } } },
      });
    }
    const gas = await row("gastroenterology");
    for (const [i, slug] of ["ercp", "esd", "poem"].entries()) await app.prisma.specialty.create({ data: { name: slug.toUpperCase(), slug, icon: "Heart", order: 50 + i, parentId: gas.id } });
    await app.prisma.specialty.create({ data: { name: "Cardiology", slug: "cardiology", icon: "Heart", order: 99 } });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("harita kendi içinde tutarlı: 8 dil, ≤120, ikonlar benzersiz, izinli gruplar", () => {
    expect(validateServiceLabelMap()).toEqual([]);
    expect(SERVICE_LABEL_MAP.map((e) => e.slug)).toHaveLength(11);
    for (const e of SERVICE_LABEL_MAP) expect(Object.keys(e.name).sort()).toEqual([...SERVICE_LANGS].sort());
  });

  it("kuru çalışma yazmaz; onaysız/operatörsüz yazma reddedilir; gerçek yazma ad/grup/ikon/açıklama yazar, slug değişmez, açıklama korunur", async () => {
    const plan = await buildServiceLabelPlan(app.prisma);
    const text = formatServiceLabelPlan(plan);
    expect(text).toContain('[güncelle] orthodontist: ad "Orthodontist" -> "Orthodontics"');
    expect(text).toContain('ad "Interventional Radiology Specialist" -> "Interventional Radiology"');
    expect(text).toContain('("Other" kalır): cardiology');
    expect((await row("orthodontist")).name).toBe("Orthodontist");
    expect((await row("orthodontist")).serviceGroup).toBeNull();

    await expect(applyServiceLabelPlan(app.prisma, plan, OP)).rejects.toThrow(RenameServiceLabelsError);
    await expect(applyServiceLabelPlan(app.prisma, plan, { ...CONFIRMED, operator: " " })).rejects.toThrow(/--operator/);
    expect((await row("orthodontist")).name).toBe("Orthodontist");

    const slugsBefore = (await app.prisma.specialty.findMany({ select: { slug: true }, orderBy: { slug: "asc" } })).map((s) => s.slug);
    const result = await applyServiceLabelPlan(app.prisma, plan, CONFIRMED);
    expect(result.updated).toHaveLength(11);
    expect((await app.prisma.specialty.findMany({ select: { slug: true }, orderBy: { slug: "asc" } })).map((s) => s.slug)).toEqual(slugsBefore);

    const ortho = await row("orthodontist");
    expect(ortho).toMatchObject({ name: "Orthodontics", icon: "Gem", serviceGroup: "aesthetic-dental-hair", description: "Eski açıklama orthodontist" });
    expect(ortho.shortDescription).toBe("Teeth alignment and bite correction at authorized dental facilities");
    const t = ortho.translations as Record<string, Record<string, string>>;
    expect(Object.keys(t).sort()).toEqual([...SERVICE_LANGS].sort());
    expect(t.de).toMatchObject({ name: "Kieferorthopädie", description: "De açıklama" });
    expect((await row("interventional-radiology-specialist")).name).toBe("Interventional Radiology");
    expect((await row("ivf-and-reproductive-health")).serviceGroup).toBe("fertility");
    for (const slug of ["ercp", "esd", "poem", "cardiology"]) expect(await row(slug)).toMatchObject({ serviceGroup: null, shortDescription: null, icon: "Heart" });
    expect(new Set((await app.prisma.specialty.findMany({ where: { serviceGroup: { not: null } } })).map((s) => s.icon)).size).toBe(11);

    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: RENAME_SERVICE_LABELS_AUDIT_ACTION } });
    expect(audit.actorEmail).toBe("script:Test Operatör");
    expect(audit.metadata).toMatchObject({ operator: "Test Operatör", cta: false });
  });

  it("idempotent: ikinci çalıştırmada hepsi atlanır, yeni audit yazılmaz", async () => {
    await applyServiceLabelPlan(app.prisma, await buildServiceLabelPlan(app.prisma), CONFIRMED);
    const again = await buildServiceLabelPlan(app.prisma);
    expect(again.entries.every((e) => e.action === "skip")).toBe(true);
    expect(formatServiceLabelPlan(again)).toContain("Güncellenecek kayıt yok.");
    expect(await applyServiceLabelPlan(app.prisma, again, CONFIRMED)).toEqual({ updated: [], ctaUpdated: false, skipped: [] });
    expect(await app.prisma.auditLog.count({ where: { action: RENAME_SERVICE_LABELS_AUDIT_ACTION } })).toBe(1);
  });

  it("bulunamayan slug uyarı olur (hata değil), diğerleri yazılır", async () => {
    await app.prisma.specialty.delete({ where: { slug: "hair-transplantation" } });
    const plan = await buildServiceLabelPlan(app.prisma);
    expect(formatServiceLabelPlan(plan)).toContain("[uyari] hair-transplantation: kayıt bulunamadı; atlandı.");
    const result = await applyServiceLabelPlan(app.prisma, plan, CONFIRMED);
    expect(result.updated).toHaveLength(10);
  });

  it("yedek + geri yükleme: önceki değerler döner; sonradan admin değişikliği ezilmez; yedek biçimi doğrulanır", async () => {
    const plan = await buildServiceLabelPlan(app.prisma);
    const file = path.join(tmp, "backup.json");
    fs.writeFileSync(file, JSON.stringify(buildServiceLabelBackup(plan)), "utf8");
    await applyServiceLabelPlan(app.prisma, plan, CONFIRMED);

    // Admin, betikten sonra thoracic-surgery adını değiştirdi: geri yükleme onu ezmemeli.
    await app.prisma.specialty.update({ where: { slug: "thoracic-surgery" }, data: { name: "Chest Surgery (admin)" } });

    const parsed = parseServiceLabelBackup(fs.readFileSync(file, "utf8"));
    const result = await restoreServiceLabels(app.prisma, parsed, CONFIRMED);
    expect(result.restored).toHaveLength(10);
    expect(result.skipped.map((s) => s.slug)).toEqual(["thoracic-surgery"]);
    expect(await row("orthodontist")).toMatchObject({ name: "Orthodontist", icon: "Heart", serviceGroup: null, shortDescription: null });
    expect((await row("orthodontist")).translations).toEqual({ de: { description: "De açıklama" } });
    expect((await row("thoracic-surgery")).name).toBe("Chest Surgery (admin)");
    expect(await app.prisma.auditLog.count({ where: { action: RENAME_SERVICE_LABELS_RESTORE_AUDIT_ACTION } })).toBe(1);

    expect(() => parseServiceLabelBackup("{")).toThrow(/JSON/);
    expect(() => parseServiceLabelBackup(JSON.stringify({ version: 2 }))).toThrow(/biçimi/);
    await expect(restoreServiceLabels(app.prisma, parsed, OP)).rejects.toThrow(RenameServiceLabelsError);
  });

  it("--cta: header CTA 'Book a consultation' + /request + 8 dil yazılır, idempotent, restore geri alır; --cta yoksa dokunulmaz", async () => {
    const initial = { headerCtaLabel: "Appointment", headerCtaHref: "/request", translations: { de: { headerCtaLabel: "Termin", tagline: "x" } } };
    await app.prisma.siteSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...initial }, update: initial });
    const noCta = await buildServiceLabelPlan(app.prisma);
    expect(noCta.cta).toBeNull();
    await applyServiceLabelPlan(app.prisma, noCta, CONFIRMED);
    expect((await app.prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } })).headerCtaLabel).toBe("Appointment");

    const plan = await buildServiceLabelPlan(app.prisma, { cta: true });
    expect(plan.cta?.action).toBe("set");
    expect(formatServiceLabelPlan(plan)).toContain('[güncelle] header CTA: "Appointment"');
    const backup = buildServiceLabelBackup(plan);
    const res = await applyServiceLabelPlan(app.prisma, plan, CONFIRMED);
    expect(res.ctaUpdated).toBe(true);
    const s = await app.prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(s).toMatchObject({ headerCtaLabel: "Book a consultation", headerCtaHref: "/request" });
    const t = s.translations as Record<string, Record<string, string>>;
    expect(t.de).toEqual({ headerCtaLabel: CTA_LABEL.de, tagline: "x" });
    expect(t["sr-latn"]!.headerCtaLabel).toBe(CTA_LABEL["sr-latn"]);

    expect((await buildServiceLabelPlan(app.prisma, { cta: true })).cta?.action).toBe("skip");

    const restored = await restoreServiceLabels(app.prisma, backup, CONFIRMED);
    expect(restored.ctaRestored).toBe(true);
    const back = await app.prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(back).toMatchObject({ headerCtaLabel: "Appointment", headerCtaHref: "/request" });
    expect(back.translations).toEqual(initial.translations);
  });

  it("NODE_ENV=production iken yazma --i-know-this-is-prod ister; kuru çalışma ister değil", () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(() => assertProdWriteAllowed(true, ["--confirm=rename-service-labels"])).toThrow(/--i-know-this-is-prod/);
      expect(() => assertProdWriteAllowed(true, ["--confirm=rename-service-labels", "--i-know-this-is-prod"])).not.toThrow();
      expect(() => assertProdWriteAllowed(false, [])).not.toThrow();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
