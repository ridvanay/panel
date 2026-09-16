import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * `.claude/architect-scope-products-catalog.md` §2.5 (bağlayıcı) — `SiteSettings.
 * shippingEstimatedDaysMin/Max` tahmini teslimat süresi. İKİSİ de `null` iken PDP satırı HİÇ
 * render etmez (frontend-agent sahası); backend yalnızca çapraz-alan doğrulamasından (`Max <
 * Min` → 422) ve public `GET /settings`'in bu alanları döndüğünden sorumludur.
 */
describe("settings — shippingEstimatedDaysMin/Max (§2.5)", () => {
  let app: FastifyInstance;
  let accessToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    ({ accessToken } = await registerTestUser(app, { email: "settings-shipping-admin@example.com" }));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` };
  }

  it("public GET /settings varsayılan olarak shippingEstimatedDaysMin/Max: null döner (satır kaydı yoksa)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/settings" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.shippingEstimatedDaysMin).toBeNull();
    expect(res.json().data.shippingEstimatedDaysMax).toBeNull();
  });

  it("ADMIN her ikisini de ayarlayabilir; public GET /settings güncel değerleri döner", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { shippingEstimatedDaysMin: 2, shippingEstimatedDaysMax: 4 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.shippingEstimatedDaysMin).toBe(2);
    expect(patch.json().data.shippingEstimatedDaysMax).toBe(4);

    const publicGet = await app.inject({ method: "GET", url: "/api/v1/settings" });
    expect(publicGet.json().data.shippingEstimatedDaysMin).toBe(2);
    expect(publicGet.json().data.shippingEstimatedDaysMax).toBe(4);
  });

  it("Max < Min AYNI istekte gönderilirse 422 döner (şema seviyesi çapraz-alan kuralı)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { shippingEstimatedDaysMin: 10, shippingEstimatedDaysMax: 5 },
    });
    expect(res.statusCode).toBe(422);
  });

  it("Min === Max geçerlidir (arayüz tek sayı gösterir)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { shippingEstimatedDaysMin: 3, shippingEstimatedDaysMax: 3 },
    });
    expect(res.statusCode).toBe(200);
  });

  it("Max, mevcut kayıttaki Min'e göre TEK BAŞINA gönderildiğinde de çapraz kontrol edilir (route handler)", async () => {
    // Önce Min=5, Max=8 ayarla.
    await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { shippingEstimatedDaysMin: 5, shippingEstimatedDaysMax: 8 },
    });

    // Yalnızca Max gönder — mevcut Min (5) ile çapraz kontrol edilmeli, 3 < 5 olduğu için 422.
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { shippingEstimatedDaysMax: 3 },
    });
    expect(res.statusCode).toBe(422);

    // Mevcut satır DEĞİŞMEMİŞ olmalı.
    const afterFailedPatch = await app.inject({ method: "GET", url: "/api/v1/settings" });
    expect(afterFailedPatch.json().data.shippingEstimatedDaysMax).toBe(8);
  });

  it("yalnızca Min'i null'a çekmek (Max dolu kalırken) geçerlidir — çapraz kural yalnızca İKİSİ de doluyken uygulanır", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { shippingEstimatedDaysMin: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.shippingEstimatedDaysMin).toBeNull();
  });

  it("min/max 0-90 aralığı dışında 422 döner", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { shippingEstimatedDaysMin: 91 },
    });
    expect(res.statusCode).toBe(422);
  });
});

/**
 * `.claude/security-review-demo-payment-toggle.md` Madde 2/4 + architect "Ek Karar A/B"
 * (`.claude/architect-scope-demo-payment-doctor-counters.md`, "EK KARAR — 2026-09-15") —
 * NİHAİ bayrak `isDemoPaymentsEnabled (env) && SiteSettings.demoPaymentsEnabled (DB)`
 * AND-gate'inin HEM `DEFAULTS` (hiç PATCH edilmemiş taze kurulum) HEM normal DB-satırı
 * dönüş yolunda DOĞRU hesaplandığını doğrular. `isDemoPaymentsEnabled` DEĞERİ `config/env.ts`
 * modül-seviyesi bir sabit olduğu için env kombinasyonlarını test etmek `vi.resetModules()` +
 * `ENABLE_DEMO_PAYMENTS` process env değişikliği + `../../src/app`'in YENİDEN import edilmesini
 * gerektirir (`tests/integration/telehealth-demo-payment.test.ts` İLE AYNI desen).
 */
describe("settings — demoPaymentsEnabled/demoPaymentsSupported (AND-gate, DB admin toggle)", () => {
  describe("env KAPALI (ENABLE_DEMO_PAYMENTS tanımsız, varsayılan test ortamı)", () => {
    let app: FastifyInstance;
    let accessToken: string;

    beforeAll(async () => {
      app = await buildTestApp();
      await resetDatabase(app.prisma);
      ({ accessToken } = await registerTestUser(app, { email: "settings-demo-pay-env-off@example.com" }));
    });

    afterAll(async () => {
      await resetDatabase(app.prisma);
      await app.close();
    });

    function authHeader() {
      return { authorization: `Bearer ${accessToken}` };
    }

    it("DEFAULTS yolu (hiç PATCH edilmemiş taze kurulum) — demoPaymentsEnabled: false, demoPaymentsSupported: false (env kapalı, DB ham varsayılanı `true` olsa BİLE sızdırılmaz)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/settings" });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.demoPaymentsEnabled).toBe(false);
      expect(res.json().data.demoPaymentsSupported).toBe(false);
    });

    it("PATCH ile DB'ye ham `true` yazılsa BİLE env kapalıyken nihai bayrak `false` kalır (DB KISITLAYICI, GENİŞLETİCİ DEĞİL)", async () => {
      const patch = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/settings",
        headers: authHeader(),
        payload: { demoPaymentsEnabled: true },
      });
      expect(patch.statusCode).toBe(200);
      // PATCH isteği REDDEDİLMEZ (422 DEĞİL) — ham sütun yazılır ama nihai bayrak env
      // tarafından hâlâ kısıtlanır.
      expect(patch.json().data.demoPaymentsEnabled).toBe(false);
      expect(patch.json().data.demoPaymentsSupported).toBe(false);

      const publicGet = await app.inject({ method: "GET", url: "/api/v1/settings" });
      expect(publicGet.json().data.demoPaymentsEnabled).toBe(false);
      expect(publicGet.json().data.demoPaymentsSupported).toBe(false);

      // Ham DB sütunu GERÇEKTEN `true` yazıldı (DTO'nun HAM değeri değil, NİHAİ AND'li
      // değeri döndürdüğünün kanıtı).
      const row = await app.prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } });
      expect(row.demoPaymentsEnabled).toBe(true);
    });
  });

  describe("env AÇIK (ENABLE_DEMO_PAYMENTS=true, NODE_ENV=test)", () => {
    let app: FastifyInstance;
    let buildApp: () => FastifyInstance;
    let accessToken: string;

    beforeAll(async () => {
      process.env.ENABLE_DEMO_PAYMENTS = "true";
      vi.resetModules();
      ({ buildApp } = await import("../../src/app"));
    });

    beforeEach(async () => {
      app = buildApp();
      await app.ready();
      await resetDatabase(app.prisma);
      ({ accessToken } = await registerTestUser(app, { email: `settings-demo-pay-env-on-${Date.now()}@example.com` }));
    });

    afterEach(async () => {
      await resetDatabase(app.prisma);
      await app.close();
    });

    afterAll(() => {
      delete process.env.ENABLE_DEMO_PAYMENTS;
      vi.resetModules();
    });

    function authHeader() {
      return { authorization: `Bearer ${accessToken}` };
    }

    it("DEFAULTS yolu (hiç PATCH edilmemiş taze kurulum) — env açık + DB ham varsayılanı `true` → nihai bayrak `true`, `demoPaymentsSupported: true`", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/settings" });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.demoPaymentsEnabled).toBe(true);
      expect(res.json().data.demoPaymentsSupported).toBe(true);
    });

    it("ADMIN `demoPaymentsEnabled: false` gönderirse nihai bayrak `false` olur (kapatma çalışır)", async () => {
      const patch = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/settings",
        headers: authHeader(),
        payload: { demoPaymentsEnabled: false },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().data.demoPaymentsEnabled).toBe(false);
      expect(patch.json().data.demoPaymentsSupported).toBe(true);

      const publicGet = await app.inject({ method: "GET", url: "/api/v1/settings" });
      expect(publicGet.json().data.demoPaymentsEnabled).toBe(false);
    });

    it("ADMIN `false`dan sonra `true` gönderirse nihai bayrak TEKRAR `true` olur (geri açma)", async () => {
      await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/settings",
        headers: authHeader(),
        payload: { demoPaymentsEnabled: false },
      });

      const patch = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/settings",
        headers: authHeader(),
        payload: { demoPaymentsEnabled: true },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().data.demoPaymentsEnabled).toBe(true);

      const publicGet = await app.inject({ method: "GET", url: "/api/v1/settings" });
      expect(publicGet.json().data.demoPaymentsEnabled).toBe(true);
    });

    it("`settings.update` audit kaydına YENİ değer (`metadata.demoPaymentsEnabled`) açıkça yazılır (security-agent Madde 3)", async () => {
      await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/settings",
        headers: authHeader(),
        payload: { demoPaymentsEnabled: false },
      });

      const audit = await app.prisma.auditLog.findFirst({
        where: { action: "settings.update" },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit!.metadata).toMatchObject({ demoPaymentsEnabled: false });
    });
  });
});

/**
 * NOT — 2026-09-15: Sağ alt canlı destek widget'ı (`liveChatEnabled`/`liveChatProvider`/
 * `liveChatScriptId`) — `demoPaymentsEnabled`in AKSİNE env-tabanlı bir AND-gate YOKTUR, HAM DB
 * sütunları doğrudan DTO'ya yansır (bkz. mappers/index.ts::toSiteSettingsDto). Bu blok, önceki
 * turda mapper/şema/DEFAULTS kablolamasının UNUTULMASI nedeniyle PATCH'in DB'ye sessizce
 * yazmadığı regresyonu bir daha yaşanmayacak şekilde kilitler.
 */
describe("settings — liveChatEnabled/liveChatProvider/liveChatScriptId", () => {
  let app: FastifyInstance;
  let accessToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    ({ accessToken } = await registerTestUser(app, { email: "settings-live-chat-admin@example.com" }));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` };
  }

  it("DEFAULTS yolu (hiç PATCH edilmemiş taze kurulum) — liveChatEnabled: false, liveChatProvider: internal, liveChatScriptId: null", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/settings" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.liveChatEnabled).toBe(false);
    expect(res.json().data.liveChatProvider).toBe("internal");
    expect(res.json().data.liveChatScriptId).toBeNull();
  });

  it("ADMIN PATCH ile DEĞİŞTİRİLEN değerler HAM DB sütununa GERÇEKTEN yazılır VE public GET /settings'te geri döner", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { liveChatEnabled: true, liveChatProvider: "crisp", liveChatScriptId: "abc123" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.liveChatEnabled).toBe(true);
    expect(patch.json().data.liveChatProvider).toBe("crisp");
    expect(patch.json().data.liveChatScriptId).toBe("abc123");

    // HAM DB satırı gerçekten yazıldı — önceki turdaki "200 dönüyor ama DB'ye yazmıyor"
    // regresyonunun tam olarak KANITLANMASI gereken kısım.
    const row = await app.prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(row.liveChatEnabled).toBe(true);
    expect(row.liveChatProvider).toBe("crisp");
    expect(row.liveChatScriptId).toBe("abc123");

    const publicGet = await app.inject({ method: "GET", url: "/api/v1/settings" });
    expect(publicGet.json().data.liveChatEnabled).toBe(true);
    expect(publicGet.json().data.liveChatProvider).toBe("crisp");
    expect(publicGet.json().data.liveChatScriptId).toBe("abc123");
  });

  it("liveChatScriptId null'a geri çekilebilir", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { liveChatScriptId: null },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.liveChatScriptId).toBeNull();

    const row = await app.prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(row.liveChatScriptId).toBeNull();
  });

  it("geçersiz liveChatProvider (frontend'in sunmadığı bir sağlayıcı) 422 döner", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: { liveChatProvider: "whatsapp" },
    });
    expect(res.statusCode).toBe(422);
  });
});

/**
 * EK KARAR — 2026-09-16 (`.claude/architect-scope-support-desk-and-reminders.md` §7.1/§7.3) —
 * Ön görüşme (pre-chat) formu ayarları. HAM DB sütunları, `liveChatEnabled` İLE AYNI şekilde
 * env-tabanlı bir AND-gate GEREKTİRMEZ ve PUBLIC `GET /settings`'te de döner (widget'ın bilmesi
 * gerekiyor).
 */
describe("settings — liveChatPreChatEnabled/liveChatRequireName/Phone/Email", () => {
  let app: FastifyInstance;
  let accessToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    ({ accessToken } = await registerTestUser(app, { email: "settings-pre-chat-admin@example.com" }));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` };
  }

  it("DEFAULTS yolu — liveChatPreChatEnabled: false, liveChatRequireName: true, liveChatRequirePhone: true, liveChatRequireEmail: false", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/settings" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.liveChatPreChatEnabled).toBe(false);
    expect(res.json().data.liveChatRequireName).toBe(true);
    expect(res.json().data.liveChatRequirePhone).toBe(true);
    expect(res.json().data.liveChatRequireEmail).toBe(false);
  });

  it("ADMIN PATCH ile dördü de değiştirilir, HAM DB sütununa yazılır ve public GET /settings'te geri döner", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: authHeader(),
      payload: {
        liveChatPreChatEnabled: true,
        liveChatRequireName: false,
        liveChatRequirePhone: false,
        liveChatRequireEmail: true,
      },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.liveChatPreChatEnabled).toBe(true);
    expect(patch.json().data.liveChatRequireName).toBe(false);
    expect(patch.json().data.liveChatRequirePhone).toBe(false);
    expect(patch.json().data.liveChatRequireEmail).toBe(true);

    const row = await app.prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(row.liveChatPreChatEnabled).toBe(true);
    expect(row.liveChatRequireName).toBe(false);
    expect(row.liveChatRequirePhone).toBe(false);
    expect(row.liveChatRequireEmail).toBe(true);

    const publicGet = await app.inject({ method: "GET", url: "/api/v1/settings" });
    expect(publicGet.json().data.liveChatPreChatEnabled).toBe(true);
    expect(publicGet.json().data.liveChatRequireName).toBe(false);
    expect(publicGet.json().data.liveChatRequirePhone).toBe(false);
    expect(publicGet.json().data.liveChatRequireEmail).toBe(true);
  });
});
