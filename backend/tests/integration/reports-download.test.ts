import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { exportStorage } from "../../src/lib/export-storage";
import type { ExportJobStatus } from "../../src/schemas/entities";

/**
 * `GET /admin/reports/exports/:jobId/download` — `reports.test.ts` yalnızca RBAC (403) ve
 * 404 (var olmayan job) senaryosunu kapsıyordu. Bu dosya asıl durum-makinesi davranışını
 * (COMPLETED olmayan işler için 409, süresi dolmuş iş için 404, gerçek dosya akışı) doğrular.
 * `ExportJob` satırları doğrudan `app.prisma` ile (worker'ı atlayarak) oluşturulur — durum
 * kombinasyonları üzerinde tam kontrol sağlar.
 */
describe("GET /admin/reports/exports/:jobId/download — durum makinesi (§10.8.10)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const admin = await registerTestUser(app, { email: "download-admin@example.com" });
    adminToken = admin.accessToken;
    adminId = admin.userId;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createJob(overrides: { status: ExportJobStatus; storagePath?: string | null; expiresAt?: Date | null }) {
    return app.prisma.exportJob.create({
      data: {
        type: "VIEWS",
        format: "CSV",
        status: overrides.status,
        filters: { from: "2026-01-01", to: "2026-01-31", granularity: "day", filters: {}, unmaskPii: false } as Prisma.InputJsonValue,
        storagePath: overrides.storagePath ?? null,
        containsPii: false,
        createdById: adminId,
        expiresAt: overrides.expiresAt === undefined ? new Date(Date.now() + 60_000) : overrides.expiresAt,
      },
    });
  }

  it("PENDING durumundaki bir iş için indirme 409 CONFLICT döner", async () => {
    const job = await createJob({ status: "PENDING" });
    const res = await app.inject({ method: "GET", url: `/api/v1/admin/reports/exports/${job.id}/download`, headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
  });

  it("PROCESSING durumundaki bir iş için indirme 409 CONFLICT döner", async () => {
    const job = await createJob({ status: "PROCESSING" });
    const res = await app.inject({ method: "GET", url: `/api/v1/admin/reports/exports/${job.id}/download`, headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(409);
  });

  it("FAILED durumundaki bir iş için indirme 409 CONFLICT döner", async () => {
    const job = await createJob({ status: "FAILED" });
    const res = await app.inject({ method: "GET", url: `/api/v1/admin/reports/exports/${job.id}/download`, headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(409);
  });

  it("COMPLETED ama (veri bütünlüğü hatası senaryosu) storagePath eksik bir iş için 409 CONFLICT döner", async () => {
    const job = await createJob({ status: "COMPLETED", storagePath: null });
    const res = await app.inject({ method: "GET", url: `/api/v1/admin/reports/exports/${job.id}/download`, headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(409);
  });

  it("süresi dolmuş (expiresAt geçmiş) COMPLETED bir iş için indirme 404 NOT_FOUND döner — dosya hazır olsa bile", async () => {
    const storagePath = await exportStorage.save(Buffer.from("date,pageViews,postViews\n2026-01-01,1,0\n", "utf8"));
    const job = await createJob({ status: "COMPLETED", storagePath, expiresAt: new Date(Date.now() - 1000) });
    const res = await app.inject({ method: "GET", url: `/api/v1/admin/reports/exports/${job.id}/download`, headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("var olmayan bir iş için indirme 404 NOT_FOUND döner", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/reports/exports/00000000-0000-0000-0000-000000000000/download",
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("COMPLETED ve süresi dolmamış bir iş 200 ile dosyayı doğru Content-Type/Content-Disposition ile döner", async () => {
    const csvContent = "date,pageViews,postViews\n2026-01-01,3,1\n";
    const storagePath = await exportStorage.save(Buffer.from(csvContent, "utf8"));
    const job = await createJob({ status: "COMPLETED", storagePath });

    const res = await app.inject({ method: "GET", url: `/api/v1/admin/reports/exports/${job.id}/download`, headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain(`export-views-${job.id}.csv`);
    expect(res.body).toBe(csvContent);
  });
});
