import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Prisma, type ImportJobStatus, type ImportJobType } from "@prisma/client";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { runImportRetentionSweep } from "../../src/modules/import/import.retention";
import { IMPORT_ERROR_ROW_REDACTION_MS, IMPORT_JOB_RETENTION_MS } from "../../src/modules/import/import.constants";
import { importStorage } from "../../src/lib/import-storage";

/**
 * §10.8.8.1 compliance-agent kararı (2026-08-05, BLOCKER) — 30 günlük `ImportJobError.rawData`/
 * `sourceRef` (yalnızca USERS) PII redaksiyonu + 90 günlük `ImportJob` zarfı saklama süresi.
 * `runImportRetentionSweep` doğrudan çağrılır (gerçek zaman-tetiklemeli `setInterval`
 * zamanlayıcısı — bkz. `registerImportRetentionScheduler` — production sarmalayıcısıdır,
 * burada test edilen ASIL iş mantığı değildir).
 */
describe("import PII redaksiyonu ve saklama süresi (§10.8.8.1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  const OLD_31_DAYS = new Date(Date.now() - IMPORT_ERROR_ROW_REDACTION_MS - 24 * 60 * 60 * 1000);
  const RECENT = new Date();

  async function createJob(type: ImportJobType, status: ImportJobStatus, createdAt: Date, finishedAt: Date | null) {
    return app.prisma.importJob.create({
      data: {
        type,
        format: type === "USERS" || type === "PAGES" || type === "BLOG" ? "CSV" : type === "WORDPRESS" ? "XML" : "ZIP",
        status,
        filename: "test.csv",
        sizeBytes: 10,
        totalCount: 1,
        processedCount: 1,
        successCount: 0,
        errorCount: 1,
        createdAt,
        finishedAt: finishedAt ?? undefined,
      },
    });
  }

  it("30 günden eski bir ImportJobError satırının rawData'sı redakte edilir; job zarfı ve PII-olmayan alanlar KALIR", async () => {
    const job = await createJob("PAGES", "COMPLETED", OLD_31_DAYS, OLD_31_DAYS);

    const oldError = await app.prisma.importJobError.create({
      data: {
        jobId: job.id,
        rowNumber: 1,
        code: "REQUIRED_FIELD_MISSING",
        message: "Başlık zorunlu.",
        severity: "ERROR",
        field: "title",
        sourceRef: "eski-slug",
        rawData: { title: "", slug: "eski-slug" },
        createdAt: OLD_31_DAYS,
      },
    });

    const recentError = await app.prisma.importJobError.create({
      data: {
        jobId: job.id,
        rowNumber: 2,
        code: "REQUIRED_FIELD_MISSING",
        message: "Başlık zorunlu.",
        severity: "ERROR",
        field: "title",
        sourceRef: "yeni-slug",
        rawData: { title: "", slug: "yeni-slug" },
        createdAt: RECENT,
      },
    });

    const result = await runImportRetentionSweep(app);
    expect(result.redactedErrorRows).toBeGreaterThanOrEqual(1);

    const oldAfter = await app.prisma.importJobError.findUniqueOrThrow({ where: { id: oldError.id } });
    expect(oldAfter.rawData).toBeNull();
    // PII-olmayan alanlar (denetim/istatistik amaçlı) KORUNUR — satır SİLİNMEZ.
    expect(oldAfter.code).toBe("REQUIRED_FIELD_MISSING");
    expect(oldAfter.rowNumber).toBe(1);
    expect(oldAfter.severity).toBe("ERROR");
    expect(oldAfter.field).toBe("title");
    // PAGES tipi — `sourceRef` (slug) PII DEĞİLDİR, dokunulmaz.
    expect(oldAfter.sourceRef).toBe("eski-slug");

    // Daha YENİ satır (30 günden genç) DOKUNULMAMIŞ olmalı.
    const recentAfter = await app.prisma.importJobError.findUniqueOrThrow({ where: { id: recentError.id } });
    expect(recentAfter.rawData).toEqual({ title: "", slug: "yeni-slug" });
    expect(recentAfter.sourceRef).toBe("yeni-slug");

    // Job zarfının kendisi (90 gün altında) SİLİNMEMİŞ olmalı.
    const jobAfter = await app.prisma.importJob.findUnique({ where: { id: job.id } });
    expect(jobAfter).not.toBeNull();
  });

  it("USERS tipi bir işte 30 günden eski satırın HEM rawData'sı HEM sourceRef'i (e-posta) redakte edilir", async () => {
    const job = await createJob("USERS", "COMPLETED", OLD_31_DAYS, OLD_31_DAYS);

    const oldUserError = await app.prisma.importJobError.create({
      data: {
        jobId: job.id,
        rowNumber: 1,
        code: "DUPLICATE_SKIPPED",
        message: '"eski@example.com" zaten kayıtlı, atlandı.',
        severity: "SKIPPED",
        sourceRef: "eski@example.com",
        rawData: Prisma.DbNull,
        createdAt: OLD_31_DAYS,
      },
    });

    const recentUserError = await app.prisma.importJobError.create({
      data: {
        jobId: job.id,
        rowNumber: 2,
        code: "INVALID_EMAIL",
        message: "Geçersiz e-posta adresi.",
        severity: "ERROR",
        field: "email",
        sourceRef: "yeni@example.com",
        rawData: { name: "Yeni Kullanici", email: "yeni@example.com", role: "EDITOR" },
        createdAt: RECENT,
      },
    });

    await runImportRetentionSweep(app);

    const oldAfter = await app.prisma.importJobError.findUniqueOrThrow({ where: { id: oldUserError.id } });
    // USERS tipinde `sourceRef` PII'dir (e-posta) — redakte edilir.
    expect(oldAfter.sourceRef).toBeNull();
    expect(oldAfter.code).toBe("DUPLICATE_SKIPPED");

    const recentAfter = await app.prisma.importJobError.findUniqueOrThrow({ where: { id: recentUserError.id } });
    expect(recentAfter.sourceRef).toBe("yeni@example.com");
    expect(recentAfter.rawData).toEqual({ name: "Yeni Kullanici", email: "yeni@example.com", role: "EDITOR" });
  });

  it("90 günden eski COMPLETED/FAILED/CANCELLED bir ImportJob (ilişkili hata satırlarıyla) TAMAMEN silinir", async () => {
    const veryOld = new Date(Date.now() - IMPORT_JOB_RETENTION_MS - 24 * 60 * 60 * 1000); // 91 gün önce
    const oldJob = await createJob("BLOG", "FAILED", veryOld, veryOld);
    const oldJobError = await app.prisma.importJobError.create({
      data: { jobId: oldJob.id, rowNumber: 1, code: "DB_ERROR", message: "x", severity: "ERROR", createdAt: veryOld },
    });

    const recentJob = await createJob("BLOG", "COMPLETED", RECENT, RECENT);

    await runImportRetentionSweep(app);

    const oldJobAfter = await app.prisma.importJob.findUnique({ where: { id: oldJob.id } });
    expect(oldJobAfter).toBeNull();
    // `onDelete: Cascade` — çocuk hata satırı da gitmiş olmalı.
    const oldJobErrorAfter = await app.prisma.importJobError.findUnique({ where: { id: oldJobError.id } });
    expect(oldJobErrorAfter).toBeNull();

    const recentJobAfter = await app.prisma.importJob.findUnique({ where: { id: recentJob.id } });
    expect(recentJobAfter).not.toBeNull();
  });

  it("90 günden eski bir ImportJob silinirken storagePath'teki ham kaynak dosyası da temizlenir (§10.8.9.1)", async () => {
    const veryOld = new Date(Date.now() - IMPORT_JOB_RETENTION_MS - 24 * 60 * 60 * 1000);
    const storagePath = await importStorage.save(Buffer.from("<xml></xml>"));
    await expect(importStorage.read(storagePath)).resolves.toBeInstanceOf(Buffer);

    const oldJob = await app.prisma.importJob.create({
      data: {
        type: "WORDPRESS",
        format: "XML",
        status: "COMPLETED",
        filename: "site.xml",
        sizeBytes: 11,
        totalCount: 1,
        processedCount: 1,
        successCount: 1,
        errorCount: 0,
        createdAt: veryOld,
        finishedAt: veryOld,
        storagePath,
      },
    });

    await runImportRetentionSweep(app);

    const oldJobAfter = await app.prisma.importJob.findUnique({ where: { id: oldJob.id } });
    expect(oldJobAfter).toBeNull();
    await expect(importStorage.read(storagePath)).rejects.toBeTruthy();
  });

  it("idempotenttir — zaten redakte edilmiş/silinmiş satırlarda ikinci çalıştırma no-op'tur (hata FIRLATMAZ)", async () => {
    const job = await createJob("PAGES", "COMPLETED", OLD_31_DAYS, OLD_31_DAYS);
    await app.prisma.importJobError.create({
      data: {
        jobId: job.id,
        rowNumber: 1,
        code: "REQUIRED_FIELD_MISSING",
        message: "x",
        severity: "ERROR",
        sourceRef: "tekrar-slug",
        rawData: { title: "" },
        createdAt: OLD_31_DAYS,
      },
    });

    const first = await runImportRetentionSweep(app);
    expect(first.redactedErrorRows).toBeGreaterThanOrEqual(1);

    // İkinci çalıştırma: aynı satır artık `rawData: null` — bir daha "redakte edilen satır" olarak SAYILMAMALI.
    const second = await runImportRetentionSweep(app);
    expect(second.redactedErrorRows).toBe(0);
    expect(second.deletedJobs).toBe(0);
  });
});
