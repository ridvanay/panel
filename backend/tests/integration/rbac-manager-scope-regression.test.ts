import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { hashPassword } from "../../src/lib/password";
import { signAccessToken } from "../../src/lib/jwt";

/**
 * qa-agent — `.claude/architect-scope-rbac-5-tier.md` §5.3, satır 6/8/12/17/21 (`import`,
 * `logs`, `outbound-webhooks`, `api-keys`, `system/health`, `users`): bu 6 modül MANAGER için
 * (a)/(b)/(c)/(d)/(f) kategorilerinden en az birine gireceği için AÇIKÇA ADMIN-ONLY'dir —
 * MANAGER, `/admin/*`'ın geri kalanında (blog/pages/media/orders/…) geniş erişime sahip
 * olduğundan, bu 6 modülde 403 aldığını doğrulayan AÇIK bir regresyon testi eksikti (kod
 * doğru — `requireSiteRole(...ROLES_ADMIN)` — ama kapsam yoktu, bkz. görev talimatı). Her modül
 * için TEK bir temsili istek (genelde GET/liste okuma, "okuma dahil" notu olan satırlar için
 * özellikle önemli çünkü MANAGER'ın diğer modüllerde okuma serbesttir — burada DEĞİL).
 *
 * Ayrıca: `DELETE /admin/pages/{id}/permanent` için MANAGER'ın GERÇEK backend davranışı
 * doğrulanır (frontend-agent'ın bildirdiği openapi.yaml tutarsızlığı — `summary` alanı hâlâ
 * "yalnızca ADMIN" diyor ama §5.3/kod `ROLES_ADMIN_MANAGER` kullanıyor). Bu test SADECE gerçek
 * davranışı kanıtlar; openapi metnini düzeltmek documentation/architect işidir (qa-agent burada
 * ürün kodunu/dokümanını DEĞİŞTİRMEZ, yalnızca bulguyu raporlar).
 */
describe("RBAC — MANAGER kapsam dışı modüller (§5.3 ADMIN-only satırları, regresyon)", () => {
  let app: FastifyInstance;
  let managerToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createUserWithRole(role: "ADMIN" | "MANAGER" | "EDITOR" | "CUSTOMER" | "USER") {
    const passwordHash = await hashPassword("Sifre12345!");
    const user = await app.prisma.user.create({
      data: {
        email: `rbac-scope-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
        name: "Test Kullanıcı",
        passwordHash,
        role,
        status: "ACTIVE",
      },
    });
    return { user, token: signAccessToken({ sub: user.id, email: user.email }).token };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const manager = await createUserWithRole("MANAGER");
    managerToken = manager.token;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("MANAGER — GET /admin/users → 403 (§5.3 satır 21, (a) ayrıcalık yükseltme yüzeyi, okuma dahil)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/users", headers: authHeader(managerToken) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("MANAGER — GET /admin/import/jobs → 403 (§5.3 satır 6, (a) rol atayabilen içe aktarma)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/import/jobs", headers: authHeader(managerToken) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("MANAGER — GET /admin/logs → 403 (§5.3 satır 8, (f) denetim izi — denetleyen/denetlenen ayrılığı)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/logs", headers: authHeader(managerToken) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("MANAGER — GET /admin/settings/api-keys → 403 (§5.3 satır 1, (b) kimlik bilgisi yüzeyi, okuma dahil)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/settings/api-keys",
      headers: authHeader(managerToken),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("MANAGER — GET /admin/settings/webhooks → 403 (§5.3 satır 12, (b) kimlik bilgisi yüzeyi, okuma dahil)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/settings/webhooks",
      headers: authHeader(managerToken),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("MANAGER — GET /admin/health → 403 (§5.3 satır 20, (d) site-geneli kill switch/sistem)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/health", headers: authHeader(managerToken) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  describe("bulgu doğrulaması — DELETE /admin/pages/{id}/permanent (openapi.yaml summary ile kod arasındaki tutarsızlık)", () => {
    it("MANAGER, çöpteki bir sayfayı KALICI silebilir (204) — kod ROLES_ADMIN_MANAGER kullanıyor; openapi.yaml `summary` metni ('yalnızca ADMIN') GÜNCEL DEĞİL", async () => {
      const admin = await createUserWithRole("ADMIN");
      const createRes = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(admin.token),
        payload: { title: `RBAC Scope Permanent Delete ${crypto.randomUUID()}` },
      });
      expect(createRes.statusCode).toBe(201);
      const pageId = createRes.json().data.id as string;

      const trashRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/pages/${pageId}`,
        headers: authHeader(managerToken),
      });
      expect(trashRes.statusCode).toBe(204);

      const permanentRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/pages/${pageId}/permanent`,
        headers: authHeader(managerToken),
      });
      // GERÇEK backend davranışı — §5.3/kod ile TUTARLI (ADMIN+MANAGER). openapi.yaml'daki
      // `summary: "Sayfayı KALICI sil — geri alınamaz (yalnızca ADMIN)"` metni bu davranışı
      // YANLIŞ tarif ediyor (aynı dosyanın description'ı ve §6/§6.2 doğru: ADMIN+MANAGER).
      expect(permanentRes.statusCode).toBe(204);
    });
  });
});
