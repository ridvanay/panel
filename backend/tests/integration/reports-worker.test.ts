import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { hashPassword } from "../../src/lib/password";
import { exportStorage } from "../../src/lib/export-storage";
import { recoverStuckExportJobs, runExportJob } from "../../src/modules/reports/reports.worker";
import type { ExportFileFormat, ExportJobStatus, ExportJobType } from "../../src/schemas/entities";

/**
 * §10.8.10 — `reports.worker.ts` doğrudan (route/kuyruk katmanı ATLANARAK) çağrılır:
 * `runExportJob`'un PENDING→PROCESSING→COMPLETED/FAILED geçişini, `unmaskPii`'nin worker
 * seviyesinde GERÇEKTEN maskeli/maskesiz dosya ürettiğini ve `recoverStuckExportJobs`'un
 * `import.worker.ts::recoverStuckImportJobs` ile AYNI çökme/restart kurtarma davranışını
 * (bkz. o dosyadaki yorum) doğrular. `reports.test.ts` (RBAC/route sözleşmesi) ile ÖRTÜŞMEZ.
 */
describe("reports export worker — PENDING→PROCESSING→COMPLETED/FAILED, unmaskPii, restart kurtarma (§10.8.10)", () => {
  let app: FastifyInstance;
  let adminId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const admin = await registerTestUser(app, { email: "worker-admin@example.com" });
    adminId = admin.userId;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  async function createJob(overrides: {
    type?: ExportJobType;
    format?: ExportFileFormat;
    status?: ExportJobStatus;
    filters?: Record<string, unknown>;
    expiresAt?: Date | null;
  } = {}) {
    return app.prisma.exportJob.create({
      data: {
        type: overrides.type ?? "VIEWS",
        format: overrides.format ?? "CSV",
        status: overrides.status ?? "PENDING",
        filters: (overrides.filters ?? {
          from: "2026-01-01",
          to: "2026-01-31",
          granularity: "day",
          filters: {},
          unmaskPii: false,
        }) as Prisma.InputJsonValue,
        expiresAt: overrides.expiresAt === undefined ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : overrides.expiresAt,
        createdById: adminId,
      },
    });
  }

  it("PENDING bir işi PROCESSING'e alır ve başarıyla COMPLETED yapar; storagePath/containsPii/startedAt/finishedAt doğru set edilir", async () => {
    const job = await createJob();
    await runExportJob(app, job.id);

    const after = await app.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("COMPLETED");
    expect(after.storagePath).toBeTruthy();
    expect(after.containsPii).toBe(false); // VIEWS tipi PII içermez (bkz. reports.worker.ts::buildExportTable)
    expect(after.startedAt).not.toBeNull();
    expect(after.finishedAt).not.toBeNull();
  });

  it("atomic claim — zaten PENDING olmayan (ör. COMPLETED) bir işi tekrar çalıştırmak no-op'tur", async () => {
    const job = await createJob();
    await runExportJob(app, job.id);
    const firstStoragePath = (await app.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } })).storagePath;

    await runExportJob(app, job.id);
    const after = await app.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("COMPLETED");
    expect(after.storagePath).toBe(firstStoragePath);
  });

  it("geçersiz tarih aralığı (from > to) worker seviyesinde işi FAILED'a düşürür, errorSummary set edilir", async () => {
    const job = await createJob({ filters: { from: "2026-05-10", to: "2026-05-01", granularity: "day", filters: {}, unmaskPii: false } });
    await runExportJob(app, job.id);

    const after = await app.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("FAILED");
    expect(after.errorSummary).toBeTruthy();
    expect(after.finishedAt).not.toBeNull();
  });

  describe("unmaskPii — worker seviyesinde GERÇEK maskeleme (route seviyesi DEĞİL)", () => {
    it("unmaskPii=false (varsayılan) — USERS export dosyasında e-posta MASKELENİR", async () => {
      const targetEmail = "pii-masked-user@example.com";
      await app.prisma.user.create({
        data: {
          email: targetEmail,
          passwordHash: await hashPassword("Sifre12345!"),
          name: "Maskeli Kullanıcı",
          createdAt: new Date("2026-06-15T00:00:00.000Z"),
        },
      });

      const job = await createJob({
        type: "USERS",
        filters: { from: "2026-06-01", to: "2026-06-30", granularity: "day", filters: {}, unmaskPii: false },
      });
      await runExportJob(app, job.id);

      const after = await app.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe("COMPLETED");
      expect(after.containsPii).toBe(true);

      const buffer = await exportStorage.read(after.storagePath!);
      const csv = buffer.toString("utf8");
      expect(csv).not.toContain(targetEmail);
      expect(csv).toContain("p***@example.com");
    });

    it("unmaskPii=true — USERS export dosyasında e-posta HAM (maskesiz) döner", async () => {
      const targetEmail = "pii-unmasked-user@example.com";
      await app.prisma.user.create({
        data: {
          email: targetEmail,
          passwordHash: await hashPassword("Sifre12345!"),
          name: "Maskesiz Kullanıcı",
          createdAt: new Date("2026-06-16T00:00:00.000Z"),
        },
      });

      const job = await createJob({
        type: "USERS",
        filters: { from: "2026-06-01", to: "2026-06-30", granularity: "day", filters: {}, unmaskPii: true },
      });
      await runExportJob(app, job.id);

      const after = await app.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe("COMPLETED");
      expect(after.containsPii).toBe(true);

      const buffer = await exportStorage.read(after.storagePath!);
      const csv = buffer.toString("utf8");
      expect(csv).toContain(targetEmail);
    });

    it("unmaskPii=false — REVENUE export dosyasında abonelik sahibinin e-postası MASKELENİR", async () => {
      const targetEmail = "pii-masked-owner@example.com";
      const owner = await app.prisma.user.create({
        data: { email: targetEmail, passwordHash: await hashPassword("Sifre12345!"), name: "Abonelik Sahibi" },
      });
      const plan = await app.prisma.plan.create({ data: { name: "Pro", priceMonthlyCents: 2999, priceYearlyCents: 29990 } });
      const org = await app.prisma.organization.create({ data: { name: "Maskeli Org", slug: "worker-masked-org", ownerId: owner.id } });
      await app.prisma.subscription.create({
        data: {
          organizationId: org.id,
          planId: plan.id,
          status: "ACTIVE",
          currentPeriodEnd: new Date("2026-07-01T00:00:00.000Z"),
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
        },
      });

      const job = await createJob({
        type: "REVENUE",
        filters: { from: "2026-06-01", to: "2026-06-30", granularity: "day", filters: {}, unmaskPii: false },
      });
      await runExportJob(app, job.id);

      const after = await app.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe("COMPLETED");
      const csv = (await exportStorage.read(after.storagePath!)).toString("utf8");
      expect(csv).not.toContain(targetEmail);
      expect(csv).toContain("p***@example.com");
    });
  });

  describe("recoverStuckExportJobs — çökme/restart kurtarma (import.worker.ts::recoverStuckImportJobs ile AYNI desen)", () => {
    it("PROCESSING'de kalmış bir iş FAILED'a çevrilir", async () => {
      const job = await createJob({ status: "PROCESSING" });
      await recoverStuckExportJobs(app);

      const after = await app.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe("FAILED");
      expect(after.errorSummary).toContain("yeniden başlatıldığı");
      expect(after.finishedAt).not.toBeNull();
    });

    it("süresi dolmamış PENDING bir iş yeniden kuyruğa alınır ve otomatik COMPLETED olur", async () => {
      const job = await createJob({ status: "PENDING" });
      await recoverStuckExportJobs(app);

      const deadline = Date.now() + 5000;
      let after = await app.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
      while (after.status === "PENDING" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        after = await app.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
      }
      expect(after.status).toBe("COMPLETED");
    });

    it("süresi dolmuş (expiresAt geçmiş) PENDING bir iş yeniden kuyruğa ALINMAZ — PENDING kalır", async () => {
      const job = await createJob({ status: "PENDING", expiresAt: new Date(Date.now() - 1000) });
      await recoverStuckExportJobs(app);

      // Kuyruğa hiç girmediğini doğrulamak için bir süre bekleyip TEKRAR kontrol ederiz.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const after = await app.prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(after.status).toBe("PENDING");
    });
  });
});
