import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { hashPassword } from "../../src/lib/password";

/**
 * `/admin/users/*` uçları: RBAC guard (`requireSiteRole("ADMIN")`) ve "en az bir aktif
 * ADMIN kalmalı" kuralı (`assertNotLastActiveAdmin` + `runSerializable`, bkz.
 * admin-users.routes.ts). Testler tek bir dosyada SIRALI çalışır (vitest varsayılanı) —
 * sıra önemlidir çünkü sistemdeki aktif admin sayısı testler arasında birikimli değişir.
 */
describe("admin-users — RBAC ve son-admin koruması", () => {
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

  /** Rate limit'e takılmadan (register/login API'lerini yormadan) doğrudan Prisma ile kullanıcı oluşturur. */
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

  // İlk register çağrısı boş bir veritabanında otomatik ADMIN olur (bkz. auth.service.ts::register,
  // `role: userCount === 0 ? "ADMIN" : undefined`) — bu yüzden `admin1` sistemin TEK admin'i olarak başlar.
  let admin1Token: string;
  let admin1Id: string;

  it("kayıt akışı: boş veritabanında ilk kullanıcı otomatik ADMIN olur", async () => {
    const admin1 = await registerTestUser(app, { email: "admin1@example.com" });
    admin1Token = admin1.accessToken;
    admin1Id = admin1.userId;

    const me = await app.inject({ method: "GET", url: "/api/v1/users/me", headers: authHeader(admin1Token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.role).toBe("ADMIN");
  });

  describe("RBAC guard (requireSiteRole)", () => {
    it("ADMIN olmayan (VIEWER) bir kullanıcı /admin/users uçlarına erişemez (403)", async () => {
      // İkinci register: userCount artık 0 değil -> şema varsayılanı VIEWER (bkz. schema.prisma::User.role).
      const viewer = await registerTestUser(app, { email: "viewer1@example.com" });

      const me = await app.inject({ method: "GET", url: "/api/v1/users/me", headers: authHeader(viewer.accessToken) });
      expect(me.json().data.role).toBe("VIEWER");

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/users",
        headers: authHeader(viewer.accessToken),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");

      const patchRole = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${viewer.userId}/role`,
        headers: authHeader(viewer.accessToken),
        payload: { role: "ADMIN" },
      });
      expect(patchRole.statusCode).toBe(403);
    });

    it("kimliği doğrulanmamış istek 401 döner", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/users" });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("son aktif admin koruması — tek admin senaryosu", () => {
    it("tek admin kendi rolünü EDITOR'a düşüremez (409 CONFLICT)", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${admin1Id}/role`,
        headers: authHeader(admin1Token),
        payload: { role: "EDITOR" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("CONFLICT");
      expect(res.json().error.message).toMatch(/en az bir yönetici/i);

      // Değişiklik gerçekten uygulanmamış olmalı.
      const me = await app.inject({ method: "GET", url: "/api/v1/users/me", headers: authHeader(admin1Token) });
      expect(me.json().data.role).toBe("ADMIN");
    });

    it("bir kullanıcı kendi hesabını SUSPENDED yapamaz (ayrı self-check, 409 CONFLICT)", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${admin1Id}/status`,
        headers: authHeader(admin1Token),
        payload: { status: "SUSPENDED" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("CONFLICT");
      expect(res.json().error.message).toMatch(/kendi hesabınızı askıya alamazsınız/i);
    });
  });

  describe("birden fazla admin varken normal işlemler", () => {
    it("başka bir ADMIN'in rolü normal şekilde değiştirilebilir (200)", async () => {
      const admin2 = await createUserDirect("ADMIN");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${admin2.id}/role`,
        headers: authHeader(admin1Token),
        payload: { role: "EDITOR" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.role).toBe("EDITOR");
    });

    it("başka bir ADMIN'in durumu normal şekilde SUSPENDED yapılabilir (200)", async () => {
      const admin3 = await createUserDirect("ADMIN");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${admin3.id}/status`,
        headers: authHeader(admin1Token),
        payload: { status: "SUSPENDED" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe("SUSPENDED");
    });

    it("iki admin varken biri kendi rolünü düşürebilir (son admin değilse serbest, bkz. assertNotLastActiveAdmin)", async () => {
      const admin4 = await createUserDirect("ADMIN");
      const admin4Token = await loginAs(admin4.email);

      // admin1 hâlâ ACTIVE+ADMIN olduğu için admin4 kendi rolünü düşürebilmeli.
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${admin4.id}/role`,
        headers: authHeader(admin4Token),
        payload: { role: "VIEWER" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.role).toBe("VIEWER");
    });
  });

  describe("race condition — eşzamanlı karşılıklı suspend (TOCTOU koruması)", () => {
    it("iki admin aynı anda birbirini suspend etmeye çalışırsa sistemde sıfır aktif admin kalmaz", async () => {
      const adminX = await createUserDirect("ADMIN");
      const adminY = await createUserDirect("ADMIN");
      const [tokenX, tokenY] = await Promise.all([loginAs(adminX.email), loginAs(adminY.email)]);

      // Bu noktada sistemde en az 3 aktif admin var (admin1, adminX, adminY) — race'in
      // kendisini test etmek için X ve Y'yi BİRBİRİNİ suspend etmeye zorluyoruz; admin1'in
      // varlığı sonucu etkilemez (assertNotLastActiveAdmin her ikisi için de admin1'i sayar),
      // bu yüzden aşağıdaki assertion'lar spesifik olarak X/Y çiftinin kendi arasındaki
      // write-skew senaryosuna değil, genel "asla 0 admin'e düşme" değişmezine bakar.
      const [resXtoY, resYtoX] = await Promise.all([
        app.inject({
          method: "PATCH",
          url: `/api/v1/admin/users/${adminY.id}/status`,
          headers: authHeader(tokenX),
          payload: { status: "SUSPENDED" },
        }),
        app.inject({
          method: "PATCH",
          url: `/api/v1/admin/users/${adminX.id}/status`,
          headers: authHeader(tokenY),
          payload: { status: "SUSPENDED" },
        }),
      ]);

      // admin1 zaten aktif admin olarak sayıldığından iki isteğin de başarılı olması BEKLENEN
      // (geçerli) bir sonuçtur — asıl kritik invariant, hiçbir zaman aktif admin sayısının
      // sıfıra düşmemesidir. Serializable + retry mekanizmasının write-conflict'i sessizce
      // yutup tutarsız bir duruma İZİN VERMEDİĞİNİ doğruluyoruz.
      for (const res of [resXtoY, resYtoX]) {
        expect([200, 409]).toContain(res.statusCode);
      }

      const remainingActiveAdmins = await app.prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
      expect(remainingActiveAdmins).toBeGreaterThanOrEqual(1);
    });

    it("gerçek write-skew senaryosu: son iki aktif admin birbirini aynı anda suspend ederse biri reddedilir", async () => {
      // Sistemdeki TÜM diğer admin hesaplarını (admin1 dahil) suspend/demote ederek tam olarak
      // iki aktif admin bırakıyoruz: adminP ve adminQ. Böylece her biri diğerini suspend etmeye
      // çalıştığında, kendini saymadığı için say(admin) = 1 (karşı taraf) olur ve senaryo
      // gerçek bir write-skew'e (ikisi de "diğeri kalıyor" varsayımıyla ilerler) dönüşür.
      await app.prisma.user.updateMany({
        where: { role: "ADMIN", status: "ACTIVE" },
        data: { status: "SUSPENDED" },
      });
      // NOT: yukarıdaki toplu suspend admin1'i de etkiler; admin1Token bundan sonra 403/401
      // dönebilir, bu testten sonra dosyada admin1'e bağımlı başka test YOK (sondaki test bu).

      const adminP = await createUserDirect("ADMIN");
      const adminQ = await createUserDirect("ADMIN");
      const [tokenP, tokenQ] = await Promise.all([loginAs(adminP.email), loginAs(adminQ.email)]);

      const activeAdminsBefore = await app.prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
      expect(activeAdminsBefore).toBe(2);

      const [resPtoQ, resQtoP] = await Promise.all([
        app.inject({
          method: "PATCH",
          url: `/api/v1/admin/users/${adminQ.id}/status`,
          headers: authHeader(tokenP),
          payload: { status: "SUSPENDED" },
        }),
        app.inject({
          method: "PATCH",
          url: `/api/v1/admin/users/${adminP.id}/status`,
          headers: authHeader(tokenQ),
          payload: { status: "SUSPENDED" },
        }),
      ]);

      const codes = [resPtoQ.statusCode, resQtoP.statusCode].sort();
      // KRİTİK: ikisi de 200 ile başarılı OLAMAZ — bu, sistemde sıfır aktif admin kalması
      // (kilitli kalma) anlamına gelir. Serializable izolasyon bu write-skew'i yakalayıp
      // taraflardan birini reddetmeli (409) ya da en azından ikisi birden başarılı olmamalı.
      expect(codes).not.toEqual([200, 200]);

      const remainingActiveAdmins = await app.prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
      expect(remainingActiveAdmins).toBeGreaterThanOrEqual(1);
    });
  });
});
