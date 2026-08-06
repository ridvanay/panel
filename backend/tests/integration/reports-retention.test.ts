import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { exportStorage } from "../../src/lib/export-storage";
import { runExportRetentionSweep } from "../../src/modules/reports/reports.retention";
import { EXPORT_JOB_RETENTION_MS, EXPORT_JOB_RETENTION_UNMASKED_MS } from "../../src/modules/reports/reports.constants";

/**
 * §10.8.10 compliance-agent kararı (2026-08-06) — `runExportRetentionSweep`'in `expiresAt`
 * geçmiş `ExportJob`'ları dosyalarıyla BİRLİKTE tamamen sildiğini (import.retention.ts'teki
 * "job zarfı" silme adımıyla AYNI desen, ama `ExportJob`'da ayrı bir redaksiyon aşaması YOK)
 * VE `unmaskPii: true` işlerin (48 saat) `false` işlerden (7 gün) ÇOK DAHA KISA yaşadığını
 * (route seviyesinde `expiresAt` hesabı üzerinden) doğrular.
 */
describe("export saklama süresi taraması (§10.8.10 compliance-agent)", () => {
  let app: FastifyInstance;
  let adminId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const admin = await registerTestUser(app, { email: "retention-admin@example.com" });
    adminId = admin.userId;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  async function createJobWithFile(expiresAt: Date | null) {
    const storagePath = await exportStorage.save(Buffer.from("id,views\n1,10\n", "utf8"));
    const job = await app.prisma.exportJob.create({
      data: {
        type: "VIEWS",
        format: "CSV",
        status: "COMPLETED",
        filters: { from: "2026-01-01", to: "2026-01-31", granularity: "day", filters: {}, unmaskPii: false } as Prisma.InputJsonValue,
        storagePath,
        containsPii: false,
        createdById: adminId,
        expiresAt,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
    return { job, storagePath };
  }

  it("expiresAt geçmiş bir ExportJob, depolanan dosyasıyla BİRLİKTE tamamen silinir", async () => {
    const { job, storagePath } = await createJobWithFile(new Date(Date.now() - 1000));

    const result = await runExportRetentionSweep(app);
    expect(result.deletedJobs).toBeGreaterThanOrEqual(1);

    const after = await app.prisma.exportJob.findUnique({ where: { id: job.id } });
    expect(after).toBeNull();
    await expect(exportStorage.read(storagePath)).rejects.toThrow();
  });

  it("expiresAt henüz gelmemiş bir ExportJob DOKUNULMAZ", async () => {
    const { job } = await createJobWithFile(new Date(Date.now() + 24 * 60 * 60 * 1000));

    await runExportRetentionSweep(app);

    const after = await app.prisma.exportJob.findUnique({ where: { id: job.id } });
    expect(after).not.toBeNull();
  });

  it("expiresAt: null olan (süresiz) bir ExportJob sweep tarafından DOKUNULMAZ", async () => {
    const { job } = await createJobWithFile(null);

    await runExportRetentionSweep(app);

    const after = await app.prisma.exportJob.findUnique({ where: { id: job.id } });
    expect(after).not.toBeNull();
  });

  it("idempotenttir — ikinci çalıştırma zaten silinmiş bir iş için tekrar SAYILMAZ (deletedJobs: 0)", async () => {
    await createJobWithFile(new Date(Date.now() - 1000));

    const first = await runExportRetentionSweep(app);
    expect(first.deletedJobs).toBeGreaterThanOrEqual(1);

    const second = await runExportRetentionSweep(app);
    expect(second.deletedJobs).toBe(0);
  });

  describe("unmaskPii saklama süresi farkı — 48 saat vs 7 gün (POST /admin/reports/exports route seviyesinde)", () => {
    it("unmaskPii=true bir işin expiresAt'i ~48 saat sonrasına, unmaskPii=false ~7 gün sonrasına ayarlanır", async () => {
      const routeAdmin = await registerTestUser(app, { email: "retention-route-admin@example.com" });
      await app.prisma.user.update({ where: { id: routeAdmin.userId }, data: { role: "ADMIN" } });
      const headers = { authorization: `Bearer ${routeAdmin.accessToken}` };

      const before = Date.now();
      const maskedRes = await app.inject({
        method: "POST",
        url: "/api/v1/admin/reports/exports",
        headers,
        payload: { type: "VIEWS", format: "CSV", from: "2026-01-01", to: "2026-01-31", unmaskPii: false },
      });
      const unmaskedRes = await app.inject({
        method: "POST",
        url: "/api/v1/admin/reports/exports",
        headers,
        payload: { type: "VIEWS", format: "CSV", from: "2026-01-01", to: "2026-01-31", unmaskPii: true },
      });
      expect(maskedRes.statusCode).toBe(202);
      expect(unmaskedRes.statusCode).toBe(202);

      const maskedExpiresAt = new Date(maskedRes.json().data.expiresAt).getTime();
      const unmaskedExpiresAt = new Date(unmaskedRes.json().data.expiresAt).getTime();

      // ±5 saniye tolerans — test yürütme süresi.
      expect(maskedExpiresAt - before).toBeGreaterThan(EXPORT_JOB_RETENTION_MS - 5000);
      expect(maskedExpiresAt - before).toBeLessThan(EXPORT_JOB_RETENTION_MS + 5000);
      expect(unmaskedExpiresAt - before).toBeGreaterThan(EXPORT_JOB_RETENTION_UNMASKED_MS - 5000);
      expect(unmaskedExpiresAt - before).toBeLessThan(EXPORT_JOB_RETENTION_UNMASKED_MS + 5000);
      expect(maskedExpiresAt).toBeGreaterThan(unmaskedExpiresAt);
    });
  });
});
