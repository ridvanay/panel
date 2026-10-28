import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { DoctorImportError, IMPORT_AUDIT_ACTION, RESTORE_AUDIT_ACTION } from "../../src/lib/doctor-cv-import";
import {
  CV_IMPORT_CONFIRM_KEY,
  CV_RESTORE_CONFIRM_KEY,
  applyGenericCvImport,
  buildGenericImportPlan,
  formatGenericPlan,
  restoreGenericCvImport,
} from "../../src/lib/doctor-cv-generic";

/**
 * Paket U (A1) — genel CV aktarımı gerçek DB'ye karşı: kuru çalışma yazmaz; korunan alanlar
 * (id/slug/userId/fullName/avatarMediaId/title/bio/uzmanlık) değişmez; aboutHtml yalnızca --with-about
 * ile; yedek + tek transaction + audit; yalnızca yazılan alanların geri dönüşü.
 */
const FIXTURE = path.resolve(__dirname, "../fixtures/doctor-cv-narrative-sample.txt");
const OP = { operator: "Test Operatör", osUser: "ci", hostname: "test-host" };
const SLUG = "test-doctor";

describe("import-doctor-cv (Paket U)", () => {
  let app: FastifyInstance;
  let backupDir: string;
  let doctorId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app.prisma);
    backupDir = await fs.mkdtemp(path.join(os.tmpdir(), "cv-backup-"));
    const specialty = await app.prisma.specialty.create({ data: { name: "Radiology", slug: "radiology", icon: "heart-pulse" } });
    const doctor = await app.prisma.doctorProfile.create({
      data: {
        title: "Prof. Dr.",
        fullName: "Test DOCTOR",
        slug: SLUG,
        bio: "Kısa özet.",
        aboutHtml: "<p>Mevcut biyografi</p>",
        languages: ["tr", "en"],
        timeZone: "Europe/Istanbul",
        specialtyId: specialty.id,
        sessionDurationMin: 30,
        sessionPriceCents: 10_000,
        currency: "EUR",
        cvEntries: [],
        publications: [],
      },
    });
    doctorId = doctor.id;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("kuru çalışma hiçbir şey yazmaz; plan sayıları ve eklenmeyenleri listeler", async () => {
    const before = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    const plan = await buildGenericImportPlan(app.prisma, SLUG, FIXTURE);
    const text = formatGenericPlan(plan);
    expect(text).toContain("cvEntries: 0 → 10");
    expect(text).toContain("publications: 0 → 6");
    expect(text).toContain("aboutHtml: DEĞİŞMEZ");
    expect(text).toMatch(/CAREER×2/);
    expect(text).toMatch(/Künyede yıl yok/);
    await expect(applyGenericCvImport(app.prisma, plan, { ...OP, backupDir, revalidate: false })).rejects.toThrow(DoctorImportError);
    expect(await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } })).toEqual(before);
    expect(await app.prisma.auditLog.count()).toBe(0);
  });

  it("yazma: yalnızca cvEntries/publications; korunan alanlar aynı; yedek + audit; geri dönüş", async () => {
    const before = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    const plan = await buildGenericImportPlan(app.prisma, SLUG, FIXTURE);
    await expect(applyGenericCvImport(app.prisma, plan, { ...OP, operator: "", confirm: CV_IMPORT_CONFIRM_KEY, backupDir, revalidate: false })).rejects.toThrow(/--operator/);
    const { backupFile } = await applyGenericCvImport(app.prisma, plan, { ...OP, confirm: CV_IMPORT_CONFIRM_KEY, backupDir, revalidate: false });
    expect(path.basename(backupFile)).toMatch(/^test-doctor-.*\.json$/);

    const after = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    for (const key of ["id", "slug", "userId", "fullName", "avatarMediaId", "title", "bio", "aboutHtml", "specialtyId", "subSpecialty"] as const) {
      expect(after[key], key).toEqual(before[key]);
    }
    expect((after.cvEntries as unknown[]).length).toBe(10);
    expect((after.publications as unknown[]).length).toBe(6);
    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: IMPORT_AUDIT_ACTION } });
    expect(audit.metadata).toMatchObject({ tool: "import-doctor-cv", operator: "Test Operatör", cvEntries: 10, publications: 6, withAbout: false });

    // Plan sonrası kayıt değiştiyse yazma geri alınır.
    await expect(applyGenericCvImport(app.prisma, plan, { ...OP, confirm: CV_IMPORT_CONFIRM_KEY, backupDir, revalidate: false })).rejects.toThrow(/değişmiş/);

    await expect(restoreGenericCvImport(app.prisma, "other-doctor", backupFile, { ...OP, confirm: CV_RESTORE_CONFIRM_KEY, backupDir, revalidate: false })).rejects.toThrow(/yönetilmeyen/);
    await restoreGenericCvImport(app.prisma, SLUG, backupFile, { ...OP, confirm: CV_RESTORE_CONFIRM_KEY, backupDir, revalidate: false });
    const restored = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    expect(restored.cvEntries).toEqual([]);
    expect(restored.publications).toEqual([]);
    expect(restored.aboutHtml).toBe(before.aboutHtml);
    expect(await app.prisma.auditLog.count({ where: { action: RESTORE_AUDIT_ACTION } })).toBe(1);
  });

  it("--with-about anlatıdan biyografi yazar; doktor yoksa oluşturmaz", async () => {
    const plan = await buildGenericImportPlan(app.prisma, SLUG, FIXTURE, { withAbout: true });
    await applyGenericCvImport(app.prisma, plan, { ...OP, confirm: CV_IMPORT_CONFIRM_KEY, backupDir, revalidate: false });
    const after = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    expect(after.aboutHtml).toContain("Prof. Dr. Test Doctor is a medical doctor");
    await expect(buildGenericImportPlan(app.prisma, "yok-boyle-doktor", FIXTURE)).rejects.toThrow(/OLUŞTURMAZ/);
    expect(await app.prisma.doctorProfile.count()).toBe(1);
  });
});
