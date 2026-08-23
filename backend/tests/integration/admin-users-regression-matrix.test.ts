import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { hashPassword } from "../../src/lib/password";
import { signAccessToken } from "../../src/lib/jwt";

/**
 * qa-agent — kullanıcının admin kullanıcı yönetimi bug raporunda açıkça istediği 3 regresyon
 * senaryosu (a/b/c) için `admin-users.test.ts` + `admin-users-soft-delete.test.ts`'in
 * BIRAKTIĞI iki gerçek boşluğu kapatır:
 *
 * 1. Boşluk — "self-block" testleri (self-delete, self-suspend) SADECE aktörün AYNI ZAMANDA
 *    sistemin TEK aktif admini olduğu durumda çalıştırılmıştı (`admin-users.test.ts` satır
 *    ~115-125, `admin-users-soft-delete.test.ts` satır ~75-84). Bu, backend'in `DELETE`/`PATCH
 *    /status` uçlarındaki koşulsuz "kendi hesabın" kontrolünü (`admin-users.routes.ts`
 *    `request.params.userId === request.user!.id`, `assertNotLastActiveAdmin` ÇAĞRILMADAN ÖNCE)
 *    "son aktif admin" kuralından (`assertNotLastActiveAdmin`) AYRIŞTIRMADAN test eder — 2+ aktif
 *    admin varken bu koşulsuz kontrol KALDIRILSA bile mevcut testler YEŞİL kalırdı (çünkü
 *    `assertNotLastActiveAdmin` da aynı senaryoda 409 üretiyordu, tesadüfen). Aşağıdaki testler
 *    kontrolü izole eder: 2+ aktif admin varken bile self-delete/self-suspend YİNE 409 vermeli.
 *
 * 2. Boşluk — `PATCH /role` ve `PATCH /status`'ün "admin olmayan bir kullanıcı" hedefinde
 *    BAŞARILI olma yolu (senaryo c) hiçbir testte doğrudan sınanmamıştı: mevcut testlerin tamamı
 *    ya ADMIN hedefler (`admin-users.test.ts`) ya da DELETED hedefler (`admin-users-soft-delete.test.ts`)
 *    üzerinde çalışıyordu. Bu dosya EDITOR/USER hedefler üzerinde başarı yolunu doğrudan sınar.
 */
describe("admin-users — regresyon matrisi (a/b/c senaryoları, izole self-check + non-admin hedef)", () => {
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

  async function createUserDirect(role: "ADMIN" | "EDITOR" | "USER", status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
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

  describe("boşluk 1 — self-block koşulsuzdur, 'son admin' kuralıyla AYNI ŞEY DEĞİLDİR", () => {
    it("2+ aktif admin varken bile kendi hesabını SUSPENDED yapamaz (409, 'son admin' kuralından bağımsız)", async () => {
      const self = await createUserDirect("ADMIN");
      // İkinci (hatta üçüncü) aktif admin — assertNotLastActiveAdmin'in `self` HARİÇ en az 1 aktif
      // admin bulacağını garanti eder; bu yüzden EĞER koşulsuz self-check KALDIRILSAYDI istek 200
      // dönerdi (assertNotLastActiveAdmin engellemezdi). Test bunun OLMADIĞINI doğrular.
      await createUserDirect("ADMIN");
      await createUserDirect("ADMIN");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${self.id}/status`,
        headers: authHeader(tokenFor(self)),
        payload: { status: "SUSPENDED" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toMatch(/kendi hesabınızı askıya alamazsınız/i);

      const dbUser = await app.prisma.user.findUnique({ where: { id: self.id } });
      expect(dbUser?.status).toBe("ACTIVE");
    });

    it("2+ aktif admin varken bile kendi hesabını silemez (409, 'son admin' kuralından bağımsız)", async () => {
      const self = await createUserDirect("ADMIN");
      await createUserDirect("ADMIN");
      await createUserDirect("ADMIN");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/users/${self.id}`,
        headers: authHeader(tokenFor(self)),
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toMatch(/kendi hesabınızı silemezsiniz/i);

      const dbUser = await app.prisma.user.findUnique({ where: { id: self.id } });
      expect(dbUser?.status).toBe("ACTIVE");
    });
  });

  describe("boşluk 2 — senaryo (c): admin olmayan bir hedefte PATCH /role ve PATCH /status başarı yolu", () => {
    it("bir ADMIN, bir EDITOR'ün rolünü USER'a düşürebilir (200) — hiçbir 'son admin' kısıtı YOKTUR", async () => {
      const admin = await createUserDirect("ADMIN");
      const target = await createUserDirect("EDITOR");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${target.id}/role`,
        headers: authHeader(tokenFor(admin)),
        payload: { role: "USER" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.role).toBe("USER");

      const dbUser = await app.prisma.user.findUnique({ where: { id: target.id } });
      expect(dbUser?.role).toBe("USER");
    });

    it("bir ADMIN, bir USER'ı EDITOR'a yükseltebilir (200)", async () => {
      const admin = await createUserDirect("ADMIN");
      const target = await createUserDirect("USER");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${target.id}/role`,
        headers: authHeader(tokenFor(admin)),
        payload: { role: "EDITOR" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.role).toBe("EDITOR");
    });

    it("bir ADMIN, bir EDITOR'ü askıya alıp tekrar aktifleştirebilir (200/200) — 'son admin' kısıtı tetiklenmez", async () => {
      const admin = await createUserDirect("ADMIN");
      const target = await createUserDirect("EDITOR");
      const actorHeader = authHeader(tokenFor(admin));

      const suspend = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${target.id}/status`,
        headers: actorHeader,
        payload: { status: "SUSPENDED" },
      });
      expect(suspend.statusCode).toBe(200);
      expect(suspend.json().data.status).toBe("SUSPENDED");

      const reactivate = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${target.id}/status`,
        headers: actorHeader,
        payload: { status: "ACTIVE" },
      });
      expect(reactivate.statusCode).toBe(200);
      expect(reactivate.json().data.status).toBe("ACTIVE");
    });

    it("bir ADMIN, bir USER'ı askıya alabilir (200)", async () => {
      const admin = await createUserDirect("ADMIN");
      const target = await createUserDirect("USER");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${target.id}/status`,
        headers: authHeader(tokenFor(admin)),
        payload: { status: "SUSPENDED" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe("SUSPENDED");
    });
  });

  describe("tamamlayıcı — daha önce yalnızca EDITOR/USER hedeflerle sınanan restore, bir ADMIN hedefte de çalışır", () => {
    it("DELETED bir ADMIN restore edilince status=ACTIVE döner ve rolü ADMIN olarak korunur", async () => {
      const activeAdmin = await createUserDirect("ADMIN");
      // İkinci bir aktif admin daha ekliyoruz ki hedefin silinmesi 'son admin' kuralına takılmasın.
      await createUserDirect("ADMIN");
      const target = await createUserDirect("ADMIN");
      const actorHeader = authHeader(tokenFor(activeAdmin));

      const del = await app.inject({ method: "DELETE", url: `/api/v1/admin/users/${target.id}`, headers: actorHeader });
      expect(del.statusCode).toBe(200);

      const restore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/users/${target.id}/restore`,
        headers: actorHeader,
      });
      expect(restore.statusCode).toBe(200);
      expect(restore.json().data.status).toBe("ACTIVE");
      expect(restore.json().data.role).toBe("ADMIN");
    });
  });
});
