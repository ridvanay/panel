import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * qa-agent bulgusu (2026-08-17, orta öncelik, gerçek kilitlenme senaryosu): `purpose=CUSTOM`
 * bir e-posta şablonu bir kez aktif edildikten sonra `PATCH .../{templateId}`'nin `isActive`
 * alanını hiç kabul etmemesi yüzünden ASLA deaktif/silinemiyordu (`DELETE` `isActive=true`
 * iken koşulsuz 409 döner). Bu dosya hem düzeltmeyi hem de `purpose != CUSTOM` şablonlarda
 * `/activate`'in transaction'a dayalı teklik kuralının BOZULMADIĞINI doğrular.
 */
describe("EmailTemplates — CUSTOM purpose isActive lifecycle (PATCH unlocks DELETE)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createCustomTemplate(name: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/notifications/templates",
      headers: authHeader(adminToken),
      payload: { name, purpose: "CUSTOM" },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data as { id: string; isActive: boolean };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // İlk kayıt olan kullanıcı otomatik ADMIN olur (bkz. auth.service.ts::register).
    const admin = await registerTestUser(app, { email: "email-templates-admin@example.com" });
    adminToken = admin.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("a CUSTOM template can be activated, then deactivated via PATCH, then deleted (no more permanent lock)", async () => {
    const template = await createCustomTemplate("Test CUSTOM Şablonu 1");
    expect(template.isActive).toBe(false);

    const activateRes = await app.inject({
      method: "POST",
      url: `/api/v1/admin/notifications/templates/${template.id}/activate`,
      headers: authHeader(adminToken),
    });
    expect(activateRes.statusCode).toBe(200);
    expect(activateRes.json().data.isActive).toBe(true);

    // Aktifken silme denemesi hâlâ 409 döner (davranış BOZULMADI).
    const blockedDeleteRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/notifications/templates/${template.id}`,
      headers: authHeader(adminToken),
    });
    expect(blockedDeleteRes.statusCode).toBe(409);

    // DÜZELTME: PATCH ile isActive=false yapılabiliyor.
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/notifications/templates/${template.id}`,
      headers: authHeader(adminToken),
      payload: { isActive: false },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().data.isActive).toBe(false);

    // Artık silinebiliyor — kalıcı kilitlenme YOK.
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/notifications/templates/${template.id}`,
      headers: authHeader(adminToken),
    });
    expect(deleteRes.statusCode).toBe(204);
  });

  it("multiple CUSTOM templates can be active at the same time (no per-purpose uniqueness for CUSTOM)", async () => {
    const first = await createCustomTemplate("Test CUSTOM Şablonu A");
    const second = await createCustomTemplate("Test CUSTOM Şablonu B");

    await app.prisma.emailTemplate.update({ where: { id: first.id }, data: { isActive: true } });

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/notifications/templates/${second.id}`,
      headers: authHeader(adminToken),
      payload: { isActive: true },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().data.isActive).toBe(true);

    const firstStillActive = await app.prisma.emailTemplate.findUnique({ where: { id: first.id } });
    expect(firstStillActive?.isActive).toBe(true);
  });

  it("rejects isActive on PATCH for non-CUSTOM purposes with 422 — /activate's single-active-per-purpose transaction is NOT bypassable", async () => {
    const welcomeTemplate = await app.prisma.emailTemplate.create({
      data: {
        name: "Hoş Geldin (test)",
        purpose: "WELCOME",
        editorMode: "RAW",
        isSystem: true,
        isActive: true,
        subject: "Hoş geldin {{user_name}}",
        bodyHtml: "<p>{{user_name}}</p>",
        availableVariables: ["user_name", "login_url"],
      },
    });

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/notifications/templates/${welcomeTemplate.id}`,
      headers: authHeader(adminToken),
      payload: { isActive: false },
    });

    expect(patchRes.statusCode).toBe(422);
    expect(patchRes.json().error.details.isActive).toBeDefined();

    // Reddedilen istek şablonu DEĞİŞTİRMEMİŞ olmalı.
    const stillActive = await app.prisma.emailTemplate.findUnique({ where: { id: welcomeTemplate.id } });
    expect(stillActive?.isActive).toBe(true);
  });
});
