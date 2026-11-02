import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import {
  SET_SPECIALTY_PARENTS_AUDIT_ACTION,
  SET_SPECIALTY_PARENTS_CONFIRM_KEY,
  SET_SPECIALTY_PARENTS_RESTORE_AUDIT_ACTION,
  SetSpecialtyParentsError,
  applySpecialtyParentPlan,
  buildSpecialtyParentBackup,
  buildSpecialtyParentPlan,
  formatSpecialtyParentPlan,
  parseSpecialtyParentBackup,
  parseSpecialtyParentMap,
  restoreSpecialtyParents,
} from "../../src/lib/specialty-parents";

/** Paket AG (İş 1) — `set-specialty-parents`: kuru çalışma, yazma, idempotent, uyarılar, yedek/geri yükleme, audit. */
const OP = { operator: "Test Operatör", osUser: "ci", hostname: "test-host", revalidate: false };
const CONFIRMED = { ...OP, confirm: SET_SPECIALTY_PARENTS_CONFIRM_KEY };

describe("set-specialty-parents", () => {
  let app: FastifyInstance;
  let tmp: string;

  const parentOf = async (slug: string) => (await app.prisma.specialty.findUniqueOrThrow({ where: { slug } })).parentId;

  beforeAll(async () => {
    app = await buildTestApp();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "specialty-parents-"));
  });

  beforeEach(async () => {
    await resetDatabase(app.prisma);
    for (const [i, slug] of ["gastroenterology", "esd", "ercp", "poem", "cardiology"].entries()) {
      await app.prisma.specialty.create({ data: { name: slug, slug, icon: "Heart", order: i } });
    }
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("kuru çalışma yazmaz; onaysız/operatörsüz yazma reddedilir; gerçek yazma üç alt uzmanlığı bağlar ve audit yazar", async () => {
    const plan = await buildSpecialtyParentPlan(app.prisma);
    expect(formatSpecialtyParentPlan(plan)).toBe("[bagla] esd -> gastroenterology\n[bagla] ercp -> gastroenterology\n[bagla] poem -> gastroenterology");
    expect(await parentOf("esd")).toBeNull();

    await expect(applySpecialtyParentPlan(app.prisma, plan, OP)).rejects.toThrow(SetSpecialtyParentsError);
    await expect(applySpecialtyParentPlan(app.prisma, plan, { ...CONFIRMED, operator: " " })).rejects.toThrow(/--operator/);
    expect(await parentOf("esd")).toBeNull();

    const result = await applySpecialtyParentPlan(app.prisma, plan, CONFIRMED);
    expect(result.updated).toEqual(["esd", "ercp", "poem"]);
    const gas = await app.prisma.specialty.findUniqueOrThrow({ where: { slug: "gastroenterology" } });
    for (const slug of ["esd", "ercp", "poem"]) expect(await parentOf(slug)).toBe(gas.id);
    expect(await parentOf("cardiology")).toBeNull();
    // Kayıt silinmedi, slug değişmedi.
    expect(await app.prisma.specialty.count()).toBe(5);

    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: SET_SPECIALTY_PARENTS_AUDIT_ACTION } });
    expect(audit.actorEmail).toBe("script:Test Operatör");
    expect(audit.metadata).toMatchObject({ operator: "Test Operatör", pairs: [{ child: "esd", parent: "gastroenterology", previousParentId: null }, { child: "ercp" }, { child: "poem" }] });
  });

  it("idempotent: ikinci çalıştırmada hepsi atlanır, yeni audit yazılmaz", async () => {
    await applySpecialtyParentPlan(app.prisma, await buildSpecialtyParentPlan(app.prisma), CONFIRMED);
    const again = await buildSpecialtyParentPlan(app.prisma);
    expect(again.entries.map((e) => e.action)).toEqual(["skip", "skip", "skip"]);
    expect(formatSpecialtyParentPlan(again)).toContain("[atla] esd -> gastroenterology: zaten bağlı.");
    expect(formatSpecialtyParentPlan(again)).toContain("Bağlanacak uzmanlık yok.");
    expect(await applySpecialtyParentPlan(app.prisma, again, CONFIRMED)).toEqual({ updated: [], skipped: [] });
    expect(await app.prisma.auditLog.count({ where: { action: SET_SPECIALTY_PARENTS_AUDIT_ACTION } })).toBe(1);
  });

  it("slug bulunamazsa uyarı verir (hata atmaz), bulunanlar bağlanır", async () => {
    await app.prisma.specialty.delete({ where: { slug: "ercp" } });
    const plan = await buildSpecialtyParentPlan(app.prisma, parseSpecialtyParentMap(undefined).concat([{ child: "esd", parent: "yok-boyle" }]));
    expect(plan.entries.map((e) => e.action)).toEqual(["set", "warn", "set", "warn"]);
    expect(formatSpecialtyParentPlan(plan)).toContain('[uyari] ercp -> gastroenterology: "ercp" bulunamadı; atlandı.');
    expect(formatSpecialtyParentPlan(plan)).toContain('"yok-boyle" bulunamadı');
    expect((await applySpecialtyParentPlan(app.prisma, plan, CONFIRMED)).updated).toEqual(["esd", "poem"]);
  });

  it("tek seviye kuralı: üst zaten alt uzmanlıksa ya da çocuklu uzmanlık taşınmak istenirse uyarı, yazma yok", async () => {
    // ercp -> esd (esd aynı çalıştırmada alt uzmanlık oluyor) ve gastroenterology -> cardiology (çocuklu olacak).
    await applySpecialtyParentPlan(app.prisma, await buildSpecialtyParentPlan(app.prisma, [{ child: "esd", parent: "gastroenterology" }]), CONFIRMED);
    const plan = await buildSpecialtyParentPlan(app.prisma, [
      { child: "ercp", parent: "esd" },
      { child: "gastroenterology", parent: "cardiology" },
      { child: "poem", parent: "poem" },
    ]);
    expect(plan.entries.map((e) => e.action)).toEqual(["warn", "warn", "warn"]);
    expect(plan.entries[0]!.reason).toContain("tek seviye");
    expect(plan.entries[1]!.reason).toContain("alt uzmanlıklarına sahip");
    expect(plan.entries[2]!.reason).toContain("kendisinin");
  });

  it("--map ayrıştırılır; geçersiz biçim hata verir", () => {
    expect(parseSpecialtyParentMap("esd:gastroenterology, poem:gastroenterology")).toEqual([
      { child: "esd", parent: "gastroenterology" },
      { child: "poem", parent: "gastroenterology" },
    ]);
    expect(() => parseSpecialtyParentMap("esd")).toThrow(SetSpecialtyParentsError);
    expect(() => parseSpecialtyParentMap("a:b:c")).toThrow(SetSpecialtyParentsError);
    expect(() => parseSpecialtyParentMap(" , ")).toThrow(/boş/);
  });

  it("yedek + geri yükleme: önceki parentId'ler döner, kayıt silinmez, audit yazılır; bulunmayan kayıt atlanır", async () => {
    const plan = await buildSpecialtyParentPlan(app.prisma);
    const backup = buildSpecialtyParentBackup(plan, new Date("2026-11-11T09:00:00Z"));
    expect(backup).toMatchObject({ version: 1, createdAt: "2026-11-11T09:00:00.000Z" });
    expect(backup.entries.map((e) => [e.slug, e.previousParentId])).toEqual([["esd", null], ["ercp", null], ["poem", null]]);
    const file = path.join(tmp, "backup.json");
    fs.writeFileSync(file, JSON.stringify(backup));

    await applySpecialtyParentPlan(app.prisma, plan, CONFIRMED);
    expect(await parentOf("poem")).not.toBeNull();
    await app.prisma.specialty.delete({ where: { slug: "ercp" } });

    const parsed = parseSpecialtyParentBackup(fs.readFileSync(file, "utf8"));
    await expect(restoreSpecialtyParents(app.prisma, parsed, OP)).rejects.toThrow(SetSpecialtyParentsError);
    const result = await restoreSpecialtyParents(app.prisma, parsed, CONFIRMED);
    expect(result).toEqual({ restored: ["esd", "poem"], missing: ["ercp"], skipped: [] });
    expect(await parentOf("esd")).toBeNull();
    expect(await parentOf("poem")).toBeNull();
    expect(await app.prisma.specialty.count()).toBe(4);
    expect((await app.prisma.auditLog.findFirstOrThrow({ where: { action: SET_SPECIALTY_PARENTS_RESTORE_AUDIT_ACTION } })).metadata).toMatchObject({ restored: ["esd", "poem"], missing: ["ercp"] });

    expect(() => parseSpecialtyParentBackup("{")).toThrow(/JSON/);
    expect(() => parseSpecialtyParentBackup(JSON.stringify({ version: 2, entries: [] }))).toThrow(/biçim/);
  });

  it("yedek doğrulaması: previousParentId string|null, newParentId string olmalı", () => {
    const entry = { slug: "esd", id: "x", previousParentId: null, newParentId: "y" };
    const ok = (e: unknown) => JSON.stringify({ version: 1, createdAt: "t", entries: [e] });
    expect(parseSpecialtyParentBackup(ok(entry)).entries).toHaveLength(1);
    expect(() => parseSpecialtyParentBackup(ok({ ...entry, previousParentId: 5 }))).toThrow(/biçim/);
    expect(() => parseSpecialtyParentBackup(ok({ ...entry, previousParentId: undefined }))).toThrow(/biçim/);
    expect(() => parseSpecialtyParentBackup(ok({ ...entry, newParentId: null }))).toThrow(/biçim/);
  });

  it("restore: mevcut parentId yedekteki 'yeni' değerle eşleşmiyorsa o kayıt atlanır (sonradan yapılan değişiklik ezilmez)", async () => {
    const plan = await buildSpecialtyParentPlan(app.prisma);
    const backup = buildSpecialtyParentBackup(plan);
    await applySpecialtyParentPlan(app.prisma, plan, CONFIRMED);
    // poem sonradan başka bir üst uzmanlığa (cardiology) taşındı
    const cardiology = await app.prisma.specialty.findUniqueOrThrow({ where: { slug: "cardiology" } });
    await app.prisma.specialty.update({ where: { slug: "poem" }, data: { parentId: cardiology.id } });

    const result = await restoreSpecialtyParents(app.prisma, backup, CONFIRMED);
    expect(result.restored).toEqual(["esd", "ercp"]);
    expect(result.skipped.map((x) => x.slug)).toEqual(["poem"]);
    expect(await parentOf("poem")).toBe(cardiology.id);
    expect(await parentOf("esd")).toBeNull();
  });

  it("restore sonrası tek seviye kuralı bozulacaksa tüm işlem geri alınır", async () => {
    const plan = await buildSpecialtyParentPlan(app.prisma, [{ child: "esd", parent: "gastroenterology" }]);
    const backup = buildSpecialtyParentBackup(plan);
    // esd'nin ÖNCEKİ üstü cardiology idi (yedeğe elle yazıldı); sonra cardiology başka bir uzmanlığın altına alındı.
    const [cardiology, ercp] = await Promise.all([
      app.prisma.specialty.findUniqueOrThrow({ where: { slug: "cardiology" } }),
      app.prisma.specialty.findUniqueOrThrow({ where: { slug: "ercp" } }),
    ]);
    await applySpecialtyParentPlan(app.prisma, plan, CONFIRMED);
    await app.prisma.specialty.update({ where: { slug: "cardiology" }, data: { parentId: ercp.id } });
    backup.entries[0]!.previousParentId = cardiology.id;

    await expect(restoreSpecialtyParents(app.prisma, backup, CONFIRMED)).rejects.toThrow(/tek seviye/);
    expect(await parentOf("esd")).toBe((await app.prisma.specialty.findUniqueOrThrow({ where: { slug: "gastroenterology" } })).id);
  });

  it("uygulama sırasında durum değiştiyse (üst uzmanlık artık alt uzmanlık) kayıt atlanır, yazılmaz", async () => {
    const plan = await buildSpecialtyParentPlan(app.prisma, [{ child: "esd", parent: "gastroenterology" }]);
    const ercp = await app.prisma.specialty.findUniqueOrThrow({ where: { slug: "ercp" } });
    // Plan çıkarıldıktan sonra gastroenterology başka bir uzmanlığın altına alındı.
    await app.prisma.specialty.update({ where: { slug: "gastroenterology" }, data: { parentId: ercp.id } });
    const result = await applySpecialtyParentPlan(app.prisma, plan, CONFIRMED);
    expect(result.updated).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(await parentOf("esd")).toBeNull();
  });
});
