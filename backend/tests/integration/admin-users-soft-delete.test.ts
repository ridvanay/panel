import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { hashPassword } from "../../src/lib/password";
import { generateOpaqueToken, hashToken } from "../../src/lib/tokens";
import { signAccessToken } from "../../src/lib/jwt";

/**
 * `DELETE /admin/users/{userId}` (yumuşak silme) ve `POST /admin/users/{userId}/restore` —
 * bkz. admin-users.routes.ts. `admin-users.test.ts` (RBAC/son-admin/role-status) ile AYNI
 * "tek dosya, sıralı testler" deseni kullanılır ama ayrı bir dosyadadır. Çoğu test kendi
 * izole admin/hedef kullanıcı çiftini `createUserDirect` ile üretir — bu yüzden sistemdeki
 * TOPLAM aktif admin sayısının testler arasında birikmesi (diğer testlerin oluşturduğu
 * admin'ler dahil) sonuçları ETKİLEMEZ; yalnızca "son admin" senaryoları ortamı bilinçli
 * olarak tek/iki aktif admine indirger.
 *
 * NOT — rate limit: `/auth/login` route-bazlı olarak dakikada 5 istekle sınırlıdır (bkz.
 * auth.routes.ts::AUTH_RATE_LIMIT, tests/integration/auth.test.ts'teki AYNI kısıt). Bu
 * dosyada aktör (admin) token'ları GERÇEK login ÜZERİNDEN DEĞİL, `tokenFor()` ile doğrudan
 * `signAccessToken()` çağrılarak üretilir (authenticate.ts token'ın NASIL üretildiğini
 * umursamaz, yalnızca imzayı ve DB'deki kullanıcı durumunu kontrol eder) — gerçek
 * `POST /auth/login` çağrıları YALNIZCA login davranışının kendisini doğrulayan birkaç
 * testte kullanılır.
 */
describe("admin-users — yumuşak silme (soft-delete) ve geri alma", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  function tokenFor(user: { id: string; email: string }): string {
    return signAccessToken({ sub: user.id, email: user.email }).token;
  }

  async function createUserDirect(role: "ADMIN" | "EDITOR" | "VIEWER", status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
    const passwordHash = await hashPassword("Sifre12345!");
    return app.prisma.user.create({
      data: {
        email: `user-${crypto.randomUUID()}@example.com`,
        name: "Test Kullanıcı",
        passwordHash,
        role,
        status,
      },
    });
  }

  async function loginAs(email: string, password = "Sifre12345!"): Promise<string> {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
    expect(res.statusCode).toBe(200);
    return res.json().data.tokens.accessToken as string;
  }

  it("kurulum: ilk kullanıcı otomatik ADMIN olur", async () => {
    const admin1 = await registerTestUser(app, { email: "sd-admin1@example.com" });

    const me = await app.inject({ method: "GET", url: "/api/v1/users/me", headers: authHeader(admin1.accessToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.role).toBe("ADMIN");

    // Self-delete engeli — architect kontratının 409 kuralı (a): hedef isteği yapanın kendisi.
    const selfDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/users/${admin1.userId}`,
      headers: authHeader(admin1.accessToken),
    });
    expect(selfDelete.statusCode).toBe(409);
    expect(selfDelete.json().error.code).toBe("CONFLICT");
    expect(selfDelete.json().error.message).toMatch(/kendi hesabınızı silemezsiniz/i);
  });

  describe("son aktif admin koruması (409 kuralı b)", () => {
    it("iki admin aynı anda birbirini silmeye çalışırsa ikisi birden başarılı OLAMAZ (write-skew koruması)", async () => {
      // İzole ortam: sistemdeki TÜM diğer aktif adminleri SUSPENDED yap, sadece adminP ve
      // adminQ aktif kalsın (bkz. admin-users.test.ts'teki AYNI desen, PATCH /status için).
      await app.prisma.user.updateMany({ where: { role: "ADMIN", status: "ACTIVE" }, data: { status: "SUSPENDED" } });
      const adminP = await createUserDirect("ADMIN");
      const adminQ = await createUserDirect("ADMIN");
      const tokenP = tokenFor(adminP);
      const tokenQ = tokenFor(adminQ);

      expect(await app.prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE" } })).toBe(2);

      const [resPtoQ, resQtoP] = await Promise.all([
        app.inject({ method: "DELETE", url: `/api/v1/admin/users/${adminQ.id}`, headers: authHeader(tokenP) }),
        app.inject({ method: "DELETE", url: `/api/v1/admin/users/${adminP.id}`, headers: authHeader(tokenQ) }),
      ]);

      // KRİTİK: ikisi de 200 ile başarılı OLAMAZ — bu, sistemde sıfır aktif admin kalması demektir.
      const codes = [resPtoQ.statusCode, resQtoP.statusCode].sort();
      expect(codes).not.toEqual([200, 200]);
      for (const res of [resPtoQ, resQtoP]) {
        expect([200, 409]).toContain(res.statusCode);
      }

      const remainingActiveAdmins = await app.prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
      expect(remainingActiveAdmins).toBeGreaterThanOrEqual(1);
    });

    it("iki admin varken biri diğerini normal şekilde silebilir (son admin değilse serbest)", async () => {
      const admin = await createUserDirect("ADMIN");
      const target = await createUserDirect("ADMIN");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/users/${target.id}`,
        headers: authHeader(tokenFor(admin)),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe("DELETED");
    });
  });

  describe("başarılı silme + yan etkiler", () => {
    it("bir EDITOR silinince status=DELETED, deletedAt dolu döner; refresh token + bekleyen reset token geçersizleşir; audit log yazılır", async () => {
      const activeAdmin = await createUserDirect("ADMIN");

      const target = await createUserDirect("EDITOR");
      // Gerçek login: hedefin en az bir AKTİF refresh token satırı olduğundan emin oluyoruz
      // (issueTokenPair() bunu yalnızca gerçek /auth/login akışında yazar).
      const targetToken = await loginAs(target.email);

      const activeRefreshBefore = await app.prisma.refreshToken.count({
        where: { userId: target.id, revoked: false },
      });
      expect(activeRefreshBefore).toBeGreaterThan(0);

      // Bekleyen bir şifre sıfırlama token'ı ekle (doğrudan DB'ye — SMTP'ye bağımlı olmadan).
      await app.prisma.passwordResetToken.create({
        data: {
          userId: target.id,
          tokenHash: hashToken(generateOpaqueToken()),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/users/${target.id}`,
        headers: authHeader(tokenFor(activeAdmin)),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      expect(body.status).toBe("DELETED");
      expect(body.deletedAt).not.toBeNull();

      const activeRefreshAfter = await app.prisma.refreshToken.count({
        where: { userId: target.id, revoked: false },
      });
      expect(activeRefreshAfter).toBe(0);

      const pendingResetAfter = await app.prisma.passwordResetToken.count({
        where: { userId: target.id, usedAt: null },
      });
      expect(pendingResetAfter).toBe(0);

      const auditEntry = await app.prisma.auditLog.findFirst({
        where: { action: "user.delete", targetId: target.id },
        orderBy: { createdAt: "desc" },
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry?.actorId).toBe(activeAdmin.id);

      // Silinen kullanıcının ESKİ access token'ı ARTIK korumalı bir uca erişemez
      // (bkz. middleware/authenticate.ts DELETED kontrolü — defense-in-depth).
      const meAfterDelete = await app.inject({
        method: "GET",
        url: "/api/v1/users/me",
        headers: authHeader(targetToken),
      });
      expect(meAfterDelete.statusCode).toBe(403);
      expect(meAfterDelete.json().error.message).toMatch(/askıya alınmış/i);
    });

    it("silme idempotent DEĞİLDİR — zaten DELETED bir kullanıcıya tekrar DELETE atılırsa 404 döner", async () => {
      const activeAdmin = await createUserDirect("ADMIN");
      const target = await createUserDirect("VIEWER");
      const actorHeader = authHeader(tokenFor(activeAdmin));

      const first = await app.inject({ method: "DELETE", url: `/api/v1/admin/users/${target.id}`, headers: actorHeader });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({ method: "DELETE", url: `/api/v1/admin/users/${target.id}`, headers: actorHeader });
      expect(second.statusCode).toBe(404);
      expect(second.json().error.code).toBe("NOT_FOUND");
    });

    it("var olmayan kullanıcı silinmeye çalışılırsa 404 döner", async () => {
      const activeAdmin = await createUserDirect("ADMIN");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/users/${crypto.randomUUID()}`,
        headers: authHeader(tokenFor(activeAdmin)),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("DELETED kullanıcının giriş denemesi reddedilir", () => {
    it("silinmiş bir kullanıcı doğru şifreyle login denerse 403 döner", async () => {
      const activeAdmin = await createUserDirect("ADMIN");
      const target = await createUserDirect("EDITOR");

      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/users/${target.id}`,
        headers: authHeader(tokenFor(activeAdmin)),
      });
      expect(del.statusCode).toBe(200);

      const loginRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: target.email, password: "Sifre12345!" },
      });
      expect(loginRes.statusCode).toBe(403);
      expect(loginRes.json().error.message).toMatch(/askıya alınmış/i);
    });
  });

  describe("PATCH /status, DELETED bir kullanıcıya uygulanamaz", () => {
    it("DELETED bir kullanıcıya PATCH /status atılırsa 404 döner (yok sayılmış gibi)", async () => {
      const activeAdmin = await createUserDirect("ADMIN");
      const target = await createUserDirect("EDITOR");
      const actorHeader = authHeader(tokenFor(activeAdmin));

      const del = await app.inject({ method: "DELETE", url: `/api/v1/admin/users/${target.id}`, headers: actorHeader });
      expect(del.statusCode).toBe(200);

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${target.id}/status`,
        headers: actorHeader,
        payload: { status: "ACTIVE" },
      });
      expect(patch.statusCode).toBe(404);
      expect(patch.json().error.code).toBe("NOT_FOUND");
    });
  });

  describe("PATCH /role, DELETED bir kullanıcıya uygulanamaz", () => {
    it("DELETED bir kullanıcıya PATCH /role atılırsa 404 döner (yok sayılmış gibi) — sessiz ayrıcalık değişikliği önlenir", async () => {
      const activeAdmin = await createUserDirect("ADMIN");
      const target = await createUserDirect("EDITOR");
      const actorHeader = authHeader(tokenFor(activeAdmin));

      const del = await app.inject({ method: "DELETE", url: `/api/v1/admin/users/${target.id}`, headers: actorHeader });
      expect(del.statusCode).toBe(200);

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${target.id}/role`,
        headers: actorHeader,
        payload: { role: "ADMIN" },
      });
      expect(patch.statusCode).toBe(404);
      expect(patch.json().error.code).toBe("NOT_FOUND");

      // Rol gerçekten değişmemiş olmalı — restore sonrası eski rolüyle geri döner.
      const restore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/users/${target.id}/restore`,
        headers: actorHeader,
      });
      expect(restore.statusCode).toBe(200);
      expect(restore.json().data.role).toBe("EDITOR");
    });
  });

  describe("PATCH /builder-access, DELETED bir kullanıcıya uygulanamaz", () => {
    // qa-agent (§10.20 kapsamı) — security-agent'ın bıraktığı kapsam notu: implementasyon
    // (`admin-users.routes.ts` satır ~264-265) doğru (`/role`/`/status` ile BİREBİR aynı
    // "DELETED = yok sayılmış gibi 404" deseni), ama bunun için AYRI bir entegrasyon testi
    // yoktu. Bu test, üstteki iki `describe` bloğuyla (PATCH /status, PATCH /role) AYNI
    // kurulum/iddia şeklini `advancedBuilderEnabled` alanına uygular.
    it("DELETED bir kullanıcıya PATCH /builder-access atılırsa 404 döner (yok sayılmış gibi) — sessiz yetenek değişikliği önlenir", async () => {
      const activeAdmin = await createUserDirect("ADMIN");
      const target = await createUserDirect("EDITOR");
      const actorHeader = authHeader(tokenFor(activeAdmin));

      // Silinmeden önceki durum bilinçli olarak `false` — 404 sonrası restore ile bu değerin
      // DEĞİŞMEDİĞİNİ (sessizce `true` olmadığını) doğrulayabilmek için.
      expect(target.advancedBuilderEnabled).toBe(false);

      const del = await app.inject({ method: "DELETE", url: `/api/v1/admin/users/${target.id}`, headers: actorHeader });
      expect(del.statusCode).toBe(200);

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${target.id}/builder-access`,
        headers: actorHeader,
        payload: { advancedBuilderEnabled: true },
      });
      expect(patch.statusCode).toBe(404);
      expect(patch.json().error.code).toBe("NOT_FOUND");

      // Yetenek bayrağı gerçekten değişmemiş olmalı — restore sonrası eski (false) değeriyle geri döner.
      const restore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/users/${target.id}/restore`,
        headers: actorHeader,
      });
      expect(restore.statusCode).toBe(200);
      expect(restore.json().data.advancedBuilderEnabled).toBe(false);
    });
  });

  describe("restore akışı", () => {
    it("DELETED bir kullanıcı restore edilince status=ACTIVE, deletedAt=null döner, rolü korunur ve tekrar giriş yapabilir", async () => {
      const activeAdmin = await createUserDirect("ADMIN");
      const target = await createUserDirect("EDITOR");
      const actorHeader = authHeader(tokenFor(activeAdmin));

      const del = await app.inject({ method: "DELETE", url: `/api/v1/admin/users/${target.id}`, headers: actorHeader });
      expect(del.statusCode).toBe(200);

      const restore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/users/${target.id}/restore`,
        headers: actorHeader,
      });
      expect(restore.statusCode).toBe(200);
      const body = restore.json().data;
      expect(body.status).toBe("ACTIVE");
      expect(body.deletedAt).toBeNull();
      expect(body.role).toBe("EDITOR");

      const auditEntry = await app.prisma.auditLog.findFirst({
        where: { action: "user.restore", targetId: target.id },
      });
      expect(auditEntry).not.toBeNull();

      // Restore edilen kullanıcı artık normal şekilde tekrar giriş yapabilmeli (gerçek login).
      const loginRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: target.email, password: "Sifre12345!" },
      });
      expect(loginRes.statusCode).toBe(200);
    });

    it("DELETED olmayan bir kullanıcı restore edilmeye çalışılırsa 409 döner", async () => {
      const activeAdmin = await createUserDirect("ADMIN");
      const target = await createUserDirect("VIEWER");

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/users/${target.id}/restore`,
        headers: authHeader(tokenFor(activeAdmin)),
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toMatch(/bu kullanıcı silinmemiş/i);
    });

    it("var olmayan kullanıcı restore edilmeye çalışılırsa 404 döner", async () => {
      const activeAdmin = await createUserDirect("ADMIN");

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/users/${crypto.randomUUID()}/restore`,
        headers: authHeader(tokenFor(activeAdmin)),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /admin/users — includeDeleted filtresi", () => {
    it("varsayılan olarak DELETED kullanıcılar listede görünmez, includeDeleted=true ile görünür", async () => {
      const activeAdmin = await createUserDirect("ADMIN");
      const target = await createUserDirect("VIEWER");
      const actorHeader = authHeader(tokenFor(activeAdmin));

      const del = await app.inject({ method: "DELETE", url: `/api/v1/admin/users/${target.id}`, headers: actorHeader });
      expect(del.statusCode).toBe(200);

      const withoutDeleted = await app.inject({
        method: "GET",
        url: "/api/v1/admin/users?limit=100",
        headers: actorHeader,
      });
      expect(withoutDeleted.statusCode).toBe(200);
      const idsWithout = withoutDeleted.json().data.map((u: { id: string }) => u.id);
      expect(idsWithout).not.toContain(target.id);

      const withDeleted = await app.inject({
        method: "GET",
        url: "/api/v1/admin/users?limit=100&includeDeleted=true",
        headers: actorHeader,
      });
      expect(withDeleted.statusCode).toBe(200);
      const dataWith = withDeleted.json().data as { id: string; status: string }[];
      const deletedRow = dataWith.find((u) => u.id === target.id);
      expect(deletedRow).toBeDefined();
      expect(deletedRow?.status).toBe("DELETED");
    });
  });

  describe("POST /admin/users — silinmiş kullanıcının e-postasıyla yeni kayıt engellenir", () => {
    it("DELETED bir kullanıcının e-postasıyla yeni kullanıcı oluşturulamaz (409 CONFLICT)", async () => {
      const activeAdmin = await createUserDirect("ADMIN");
      const target = await createUserDirect("VIEWER");
      const actorHeader = authHeader(tokenFor(activeAdmin));

      const del = await app.inject({ method: "DELETE", url: `/api/v1/admin/users/${target.id}`, headers: actorHeader });
      expect(del.statusCode).toBe(200);

      const createRes = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        headers: actorHeader,
        payload: { name: "Yeniden", email: target.email, role: "EDITOR" },
      });
      expect(createRes.statusCode).toBe(409);
      expect(createRes.json().error.message).toMatch(/silinmiş bir kullanıcıya ait/i);
    });
  });
});
