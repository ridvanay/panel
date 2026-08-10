import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { recoverStuckImportJobs } from "../../src/modules/import/import.worker";
import { importStorage } from "../../src/lib/import-storage";

/**
 * §10.8.9.1 compliance-agent BLOKER düzeltmesi (2026-08-10) — çökme/restart kurtarması
 * (`recoverStuckImportJobs`) `FAILED` yaptığı işlerin ham kaynak dosyasını (`storagePath`)
 * DA temizlemeli; aksi hâlde büyük WordPress/WooCommerce dosyaları (sipariş/müşteri PII'si
 * taşıyabilir) sunucu çökmesi sonrası süresiz öksüz kalır.
 */
describe("recoverStuckImportJobs — storagePath temizliği (§10.8.9.1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  async function createStuckJob(status: "QUEUED" | "PROCESSING", storagePath: string | null) {
    return app.prisma.importJob.create({
      data: {
        type: "PAGES",
        format: "CSV",
        status,
        filename: "test.csv",
        sizeBytes: 10,
        totalCount: 1,
        storagePath,
      },
    });
  }

  it("QUEUED/PROCESSING'de asılı kalmış işleri FAILED yapar VE storagePath'teki ham dosyayı siler", async () => {
    const storagePath = await importStorage.save(Buffer.from("title\nHello\n"));
    // Dosyanın gerçekten yazıldığını doğrula.
    await expect(importStorage.read(storagePath)).resolves.toBeInstanceOf(Buffer);

    const queuedJob = await createStuckJob("QUEUED", storagePath);
    const processingJob = await createStuckJob("PROCESSING", null);

    await recoverStuckImportJobs(app);

    const queuedAfter = await app.prisma.importJob.findUniqueOrThrow({ where: { id: queuedJob.id } });
    expect(queuedAfter.status).toBe("FAILED");
    expect(queuedAfter.storagePath).toBeNull();

    const processingAfter = await app.prisma.importJob.findUniqueOrThrow({ where: { id: processingJob.id } });
    expect(processingAfter.status).toBe("FAILED");
    expect(processingAfter.storagePath).toBeNull();

    // Ham dosya diskten/depodan gerçekten silinmiş olmalı.
    await expect(importStorage.read(storagePath)).rejects.toBeTruthy();
  });

  it("storagePath'i olmayan asılı bir işte hata FIRLATMAZ (best-effort, no-op)", async () => {
    const job = await createStuckJob("QUEUED", null);
    await expect(recoverStuckImportJobs(app)).resolves.not.toThrow();
    const after = await app.prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("FAILED");
    expect(after.storagePath).toBeNull();
  });
});
