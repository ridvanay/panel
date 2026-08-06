import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * §10.8.10 Analitik Rapor Dışa Aktarma — RBAC (security-agent denetimi, 2026-08-06).
 * `/admin/reports/exports/*` TÜM uçlar yalnızca ADMIN (bkz. reports.routes.ts üstündeki not) —
 * bu dosyanın var olmaması RBAC boşluğuydu (backend-agent'ın raporunda geçmiyordu), eklendi.
 */
describe("reports/exports (§10.8.10)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let editorToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // İlk kayıt otomatik ADMIN olur (bkz. auth.service.ts::register).
    ({ accessToken: adminToken } = await registerTestUser(app, { email: "reports-admin1@example.com" }));

    const editor = await registerTestUser(app, { email: "reports-editor1@example.com" });
    await app.prisma.user.update({ where: { id: editor.userId }, data: { role: "EDITOR" } });
    editorToken = editor.accessToken;

    const viewer = await registerTestUser(app, { email: "reports-viewer1@example.com" });
    viewerToken = viewer.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  const VALID_BODY = { type: "VIEWS", format: "CSV", from: "2026-01-01", to: "2026-01-31" };

  it("kimliği doğrulanmamış istekler 401 alır", async () => {
    const list = await app.inject({ method: "GET", url: "/api/v1/admin/reports/exports" });
    expect(list.statusCode).toBe(401);

    const create = await app.inject({ method: "POST", url: "/api/v1/admin/reports/exports", payload: VALID_BODY });
    expect(create.statusCode).toBe(401);
  });

  describe("RBAC guard (requireSiteRole(\"ADMIN\")) — TÜM uçlar", () => {
    it("VIEWER hiçbir export ucuna erişemez (403)", async () => {
      const headers = authHeader(viewerToken);

      const list = await app.inject({ method: "GET", url: "/api/v1/admin/reports/exports", headers });
      expect(list.statusCode).toBe(403);
      expect(list.json().error.code).toBe("FORBIDDEN");

      const create = await app.inject({ method: "POST", url: "/api/v1/admin/reports/exports", headers, payload: VALID_BODY });
      expect(create.statusCode).toBe(403);

      const detail = await app.inject({ method: "GET", url: "/api/v1/admin/reports/exports/00000000-0000-0000-0000-000000000000", headers });
      expect(detail.statusCode).toBe(403);

      const download = await app.inject({
        method: "GET",
        url: "/api/v1/admin/reports/exports/00000000-0000-0000-0000-000000000000/download",
        headers,
      });
      expect(download.statusCode).toBe(403);
    });

    // §10.8.10 kararı: `/admin/stats/*`'in aksine (EDITOR+ADMIN içerik analitiği görebilir),
    // export uçlarında tip ayrımı YAPILMAZ — VIEWS/BREAKDOWN gibi PII içermeyen türler dahi
    // EDITOR'a AÇILMAZ (export dosyası indirilebilir/paylaşılabilir bir kalıcı çıktı üretir).
    it("EDITOR hiçbir export ucuna erişemez (403) — PII içermeyen VIEWS türü dahil", async () => {
      const headers = authHeader(editorToken);

      const list = await app.inject({ method: "GET", url: "/api/v1/admin/reports/exports", headers });
      expect(list.statusCode).toBe(403);

      const create = await app.inject({ method: "POST", url: "/api/v1/admin/reports/exports", headers, payload: VALID_BODY });
      expect(create.statusCode).toBe(403);
    });
  });

  it("ADMIN bir export job oluşturabilir, listeleyebilir ve detayını görebilir", async () => {
    const headers = authHeader(adminToken);

    const create = await app.inject({ method: "POST", url: "/api/v1/admin/reports/exports", headers, payload: VALID_BODY });
    expect(create.statusCode).toBe(202);
    const job = create.json().data;
    expect(job.type).toBe("VIEWS");
    expect(job.id).toBeTruthy();
    // `storagePath` API yanıtında ASLA dönmez (bkz. export-storage.ts üstündeki not).
    expect(job.storagePath).toBeUndefined();

    const detail = await app.inject({ method: "GET", url: `/api/v1/admin/reports/exports/${job.id}`, headers });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.id).toBe(job.id);

    const list = await app.inject({ method: "GET", url: "/api/v1/admin/reports/exports", headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((j: { id: string }) => j.id === job.id)).toBe(true);
  });

  it("var olmayan bir job için 404 döner", async () => {
    const headers = authHeader(adminToken);
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/reports/exports/00000000-0000-0000-0000-000000000000", headers });
    expect(res.statusCode).toBe(404);
  });

  it("geçersiz tarih aralığı (366 günü aşan) 422 ile reddedilir, job HİÇ oluşturulmaz", async () => {
    const headers = authHeader(adminToken);
    const before = await app.prisma.exportJob.count();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/reports/exports",
      headers,
      payload: { type: "VIEWS", format: "CSV", from: "2020-01-01", to: "2026-01-01" },
    });
    expect(res.statusCode).toBe(422);

    const after = await app.prisma.exportJob.count();
    expect(after).toBe(before);
  });
});
