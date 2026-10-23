import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import {
  CERTIFICATE_FILE,
  CV_FILE,
  DoctorImportError,
  IMPORT_AUDIT_ACTION,
  IMPORT_CONFIRM_KEY,
  RESTORE_AUDIT_ACTION,
  RESTORE_CONFIRM_KEY,
  TARGET_TITLE,
  applyDoctorCvImport,
  buildImportPlan,
  restoreDoctorProfile,
  type MediaSaver,
} from "../../src/lib/doctor-cv-import";

/**
 * Paket L — Vahit Mutlu profil aktarımı gerçek DB'ye karşı: kuru çalışma yazmaz, korunan alanlar
 * (id/slug/userId/fullName/avatarMediaId/subSpecialty) değişmez, yedek + tek transaction + audit,
 * sertifika medyası CERTIFICATE kalemine bağlanır ve tekrar çalıştırmada yeniden yüklenmez,
 * yedekten birebir geri dönüş.
 */
const FIXTURE = path.resolve(__dirname, "../fixtures/doctor-cv-sample.txt");
const OP = { operator: "Test Operatör", osUser: "ci", hostname: "test-host" };

describe("doctor-cv-import (Paket L)", () => {
  let app: FastifyInstance;
  let sourceDir: string;
  let backupDir: string;
  let doctorId: string;
  let saved: string[];
  const fakeStorage: MediaSaver = {
    async save({ filename }) {
      saved.push(filename);
      return { path: `test-${saved.length}.pdf`, url: `/uploads/test-${saved.length}.pdf` };
    },
  };

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app.prisma);
    saved = [];
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "vahit-src-"));
    backupDir = await fs.mkdtemp(path.join(os.tmpdir(), "vahit-backup-"));
    await fs.copyFile(FIXTURE, path.join(sourceDir, CV_FILE));
    await fs.writeFile(path.join(sourceDir, CERTIFICATE_FILE), "%PDF-1.4\n% test certificate\n");

    const obesity = await app.prisma.specialty.create({ data: { name: "Obesity & Metabolic Surgery", slug: "obesity", icon: "heart-pulse" } });
    await app.prisma.specialty.create({ data: { name: "Surgical Oncology", slug: "surgical-oncology", icon: "heart-pulse" } });
    const doctor = await app.prisma.doctorProfile.create({
      data: {
        title: "Dr.",
        fullName: "Vahit Mutlu",
        slug: "vahit-mutlu",
        bio: "Eski özet.",
        aboutHtml: "<p>Eski biyografi</p>",
        subSpecialty: "Bariatric Surgery",
        languages: ["tr", "en"],
        timeZone: "Europe/Istanbul",
        specialtyId: obesity.id,
        sessionDurationMin: 30,
        sessionPriceCents: 10_000,
        currency: "EUR",
        cvEntries: [{ kind: "EDUCATION", title: "Eski", organization: "Eski Üniv.", startYear: 2000, endYear: 2006 }],
        publications: [],
      },
    });
    doctorId = doctor.id;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("kuru çalışma (plan) hiçbir şey yazmaz ve medya yüklemez", async () => {
    const before = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    const plan = await buildImportPlan(app.prisma, sourceDir);
    expect(plan.current.cvEntries).toBe(1);
    expect(plan.parsed.cvEntries.length).toBe(5);
    const after = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    expect(after).toEqual(before);
    expect(await app.prisma.media.count()).toBe(0);
    expect(saved).toEqual([]);
  });

  it("onay ve operatör olmadan yazmaz", async () => {
    const plan = await buildImportPlan(app.prisma, sourceDir);
    await expect(applyDoctorCvImport(app.prisma, plan, { ...OP, backupDir, storage: fakeStorage, revalidate: false })).rejects.toThrow(DoctorImportError);
    await expect(
      applyDoctorCvImport(app.prisma, plan, { ...OP, operator: "", confirm: IMPORT_CONFIRM_KEY, backupDir, storage: fakeStorage, revalidate: false })
    ).rejects.toThrow(/operator/);
    expect(saved).toEqual([]);
  });

  it("yazar: yedek + audit + sertifika bağlantısı; korunan alanlar değişmez; tekrar çalıştırmada PDF yeniden yüklenmez", async () => {
    const before = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    const plan = await buildImportPlan(app.prisma, sourceDir);
    const { backupFile, mediaId } = await applyDoctorCvImport(app.prisma, plan, {
      ...OP,
      confirm: IMPORT_CONFIRM_KEY,
      backupDir,
      storage: fakeStorage,
      revalidate: false,
    });

    const after = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    for (const key of ["id", "slug", "userId", "fullName", "avatarMediaId", "subSpecialty", "specialtyId"] as const) {
      expect(after[key]).toEqual(before[key]);
    }
    expect(after.title).toBe(TARGET_TITLE);
    expect(after.aboutHtml).not.toMatch(/born|1989/);
    const cv = after.cvEntries as { kind: string; mediaId?: string; url?: string }[];
    expect(cv).toHaveLength(5);
    expect(cv.find((e) => e.kind === "CERTIFICATE")).toMatchObject({ mediaId, url: "/uploads/test-1.pdf" });
    expect((after.publications as unknown[]).length).toBe(8);
    expect(JSON.stringify(after)).not.toMatch(/example\.com|\+90 530/);

    // Ek uzmanlık eklendi (birincil dokunulmadı).
    expect(await app.prisma.doctorAdditionalSpecialty.count({ where: { doctorId } })).toBe(1);

    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: IMPORT_AUDIT_ACTION } });
    expect(audit.targetId).toBe(doctorId);
    expect(audit.metadata).toMatchObject({ operator: OP.operator, backupFile: path.basename(backupFile), certificateMediaId: mediaId });

    const backup = JSON.parse(await fs.readFile(backupFile, "utf8"));
    expect(backup.fields.bio).toBe("Eski özet.");

    // Tekrar: aynı PDF mevcut medya olarak bulunur, depolamaya ikinci kez yazılmaz.
    const plan2 = await buildImportPlan(app.prisma, sourceDir);
    expect(plan2.existingMediaId).toBe(mediaId);
    await applyDoctorCvImport(app.prisma, plan2, { ...OP, confirm: IMPORT_CONFIRM_KEY, backupDir, storage: fakeStorage, revalidate: false });
    expect(saved).toHaveLength(1);
    expect(await app.prisma.media.count()).toBe(1);
  });

  it("plan alındıktan sonra kayıt değişirse hiçbir şey yazılmaz", async () => {
    const plan = await buildImportPlan(app.prisma, sourceDir);
    await app.prisma.doctorProfile.update({ where: { id: doctorId }, data: { bio: "Bu arada değişti." } });
    await expect(
      applyDoctorCvImport(app.prisma, plan, { ...OP, confirm: IMPORT_CONFIRM_KEY, backupDir, storage: fakeStorage, revalidate: false })
    ).rejects.toThrow(/değişmiş/);
    const after = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    expect(after.bio).toBe("Bu arada değişti.");
    expect(await app.prisma.auditLog.count({ where: { action: IMPORT_AUDIT_ACTION } })).toBe(0);
  });

  it("--restore yedekteki hâli birebir geri yazar ve eklenen ek uzmanlığı kaldırır", async () => {
    const original = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    const plan = await buildImportPlan(app.prisma, sourceDir);
    const { backupFile } = await applyDoctorCvImport(app.prisma, plan, {
      ...OP,
      confirm: IMPORT_CONFIRM_KEY,
      backupDir,
      storage: fakeStorage,
      revalidate: false,
    });

    await expect(restoreDoctorProfile(app.prisma, backupFile, { ...OP, backupDir, revalidate: false })).rejects.toThrow(DoctorImportError);
    const { preRestoreBackup } = await restoreDoctorProfile(app.prisma, backupFile, {
      ...OP,
      confirm: RESTORE_CONFIRM_KEY,
      backupDir,
      revalidate: false,
    });

    const restored = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    for (const key of ["title", "bio", "aboutHtml", "cvEntries", "publications", "socialLinks", "specialtyId"] as const) {
      expect(restored[key]).toEqual(original[key]);
    }
    expect(await app.prisma.doctorAdditionalSpecialty.count({ where: { doctorId } })).toBe(0);
    expect(await app.prisma.auditLog.count({ where: { action: RESTORE_AUDIT_ACTION } })).toBe(1);
    await expect(fs.stat(preRestoreBackup)).resolves.toBeTruthy();
  });

  it("uzmanlık canlıdaki slug ile bulunur ('and' yazımı); doluysa birincil ezilmez, mevcut ek uzmanlık tekrarlanmaz", async () => {
    // Canlıdaki durum: ad "and" ile, slug'lar sabit; doktorun birincil ve ek uzmanlığı zaten bağlı.
    const obesity = await app.prisma.specialty.update({
      where: { slug: "obesity" },
      data: { name: "Obesity and Metabolic Surgery", slug: "obesity-and-metabolic-surgery" },
    });
    const oncology = await app.prisma.specialty.findUniqueOrThrow({ where: { slug: "surgical-oncology" } });
    await app.prisma.doctorAdditionalSpecialty.create({ data: { doctorId, specialtyId: oncology.id } });

    const plan = await buildImportPlan(app.prisma, sourceDir);
    expect(plan.specialtyWarnings).toEqual([]);
    expect(plan.willConnectPrimary).toBe(false);
    expect(plan.additionalSpecialtyIds).toEqual([oncology.id]);

    await applyDoctorCvImport(app.prisma, plan, { ...OP, confirm: IMPORT_CONFIRM_KEY, backupDir, storage: fakeStorage, revalidate: false });
    expect((await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } })).specialtyId).toBe(obesity.id);
    expect(await app.prisma.doctorAdditionalSpecialty.findMany({ where: { doctorId }, select: { specialtyId: true } })).toEqual([{ specialtyId: oncology.id }]);
  });

  it("slug farklıysa adla bulunur (büyük/küçük harf ve '&'/'and' farkı yok sayılır)", async () => {
    await app.prisma.specialty.update({ where: { slug: "obesity" }, data: { name: "OBESITY AND METABOLIC  SURGERY", slug: "bariatric" } });
    await app.prisma.specialty.update({ where: { slug: "surgical-oncology" }, data: { name: "surgical oncology", slug: "onco" } });
    const plan = await buildImportPlan(app.prisma, sourceDir);
    expect(plan.specialtyWarnings).toEqual([]);
    expect(plan.additionalSpecialtyIds).toHaveLength(1);
  });

  it("uzmanlık bulunamazsa uyarı verir, uzmanlık adımını atlar ve CV aktarımına devam eder; uzmanlık oluşturmaz", async () => {
    await app.prisma.doctorProfile.update({ where: { id: doctorId }, data: { specialtyId: null } });
    await app.prisma.specialty.deleteMany({});
    const plan = await buildImportPlan(app.prisma, sourceDir);
    expect(plan.specialtyWarnings).toHaveLength(2);
    expect(plan.willConnectPrimary).toBe(false);
    expect(plan.additionalSpecialtyIds).toEqual([]);

    await applyDoctorCvImport(app.prisma, plan, { ...OP, confirm: IMPORT_CONFIRM_KEY, backupDir, storage: fakeStorage, revalidate: false });
    const after = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    expect((after.cvEntries as unknown[]).length).toBe(5);
    expect(after.specialtyId).toBeNull();
    expect(await app.prisma.specialty.count()).toBe(0);
    expect(await app.prisma.doctorAdditionalSpecialty.count({ where: { doctorId } })).toBe(0);
  });

  it("başka bir doktora ait ya da bozuk yedek reddedilir", async () => {
    const forged = path.join(backupDir, "forged.json");
    await fs.writeFile(forged, JSON.stringify({ kind: "doctor-profile-backup", doctorId, slug: "baska-doktor", fields: { title: "x", bio: "y" } }));
    await expect(restoreDoctorProfile(app.prisma, forged, { ...OP, confirm: RESTORE_CONFIRM_KEY, backupDir, revalidate: false })).rejects.toThrow(
      /yönetilmeyen/
    );
  });
});
