import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { requireApiKey } from "../../src/middleware/api-key-auth";
import { ForbiddenError, UnauthorizedError } from "../../src/lib/errors";
import { __resetApiKeyCacheForTests } from "../../src/lib/api-key";
import { __resetApiKeyRateLimitForTests } from "../../src/lib/api-key-rate-limit";
import { PUBLIC_API_KEY_BURST_RATE_LIMIT, PUBLIC_API_KEY_RATE_LIMIT } from "../../src/lib/rate-limit";

/**
 * qa-agent kritik akışlar — ARCHITECTURE.md §10.13.10, "qa-agent için kritik akışlar" listesi,
 * madde (b) süresi dolmuş anahtar → 401, madde (c) READ anahtarın scope korumalı uca 403'ü,
 * madde (e) anahtar kotası aşımında 429. Bu üç senaryo security-agent denetiminde AYRI TEST
 * GÖRMEDİĞİ tespit edildi — `api-keys.test.ts` bu üçünü kapsamaz (bkz. o dosyanın mevcut testleri).
 */
describe("api-keys — süresi dolmuş anahtar → 401 (§10.13.10 madde b)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  function authHeader() {
    return { authorization: `Bearer ${adminToken}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    __resetApiKeyCacheForTests();
    ({ accessToken: adminToken } = await registerTestUser(app, { email: "api-keys-expiry-admin@example.com" }));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("expiresAt geçmişte olan bir anahtarla public API'ye istek 401 döner", async () => {
    // `CreateApiKeyRequestSchema.expiresAt` yalnızca GELECEK bir tarihi kabul eder (bkz.
    // api-keys.schemas.ts refine kuralı) — bu yüzden geçmiş bir `expiresAt` API üzerinden
    // OLUŞTURULAMAZ. Gerçekçi senaryo: anahtar geçerliyken oluşturulur, zaman geçer, süresi
    // dolar. Burada bunu deterministik biçimde (gerçek bir bekleme OLMADAN, flaky'e yol
    // açmadan) simüle etmek için oluşturduktan hemen sonra `expiresAt`'i doğrudan Prisma ile
    // geçmişe alıyoruz — route katmanının validasyonunu atlıyoruz ama gerçek DB durumunu
    // (anahtar süresi dolmuş) birebir üretiyoruz. Anahtar HENÜZ HİÇ KULLANILMADIĞI için pozitif
    // doğrulama cache'inde bir kaydı YOKTUR — sonraki `/public/*` çağrısı DB'den taze okur.
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/api-keys",
      headers: authHeader(),
      payload: { name: "Süresi Dolacak Anahtar", scope: "READ", expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(createRes.statusCode).toBe(201);
    const { plainKey, apiKey } = createRes.json().data as { plainKey: string; apiKey: { id: string } };

    await app.prisma.apiKey.update({ where: { id: apiKey.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });

    const res = await app.inject({ method: "GET", url: "/api/v1/public/me", headers: { "x-api-key": plainKey } });
    expect(res.statusCode).toBe(401);
    // §10.13.4 numaralandırma koruması — "yok" ile "süresi dolmuş" AYNI genel mesajı taşımalı.
    const missing = await app.inject({ method: "GET", url: "/api/v1/public/me" });
    expect(res.json().error.message).toBe(missing.json().error.message);
  });

  it("süresi dolmuş anahtar admin panelde HÂLÂ görünür (soft-fail, kayıt silinmez) ama iptal edilmiş DEĞİLDİR", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/api-keys",
      headers: authHeader(),
      payload: { name: "Süre Kontrolü", scope: "READ", expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
    const { apiKey } = createRes.json().data as { apiKey: { id: string } };
    await app.prisma.apiKey.update({ where: { id: apiKey.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });

    const list = await app.inject({ method: "GET", url: "/api/v1/admin/settings/api-keys", headers: authHeader() });
    const found = list.json().data.find((k: { id: string }) => k.id === apiKey.id);
    expect(found).toBeTruthy();
    expect(found.status).toBe("ACTIVE"); // süre dolması `status`'u REVOKED yapmaz — yalnızca doğrulamada reddedilir.
  });
});

/**
 * §10.13.5 — public API yüzeyi tamamen GET-only'dir, bu yüzden `requireApiKey("READ_WRITE")`
 * gerektiren gerçek bir uç YOKTUR (doğrulandı: `grep requireApiKey` yalnızca
 * `public-api.routes.ts`'te ve tek çağrıda `requireApiKey("READ")` olarak bulunuyor). Kontratın
 * §10.13.10 madde (c) "READ anahtarın scope korumalı uca 403'ü" gereksinimini karşılamak için
 * middleware fonksiyonu doğrudan çağrılır (görev talimatındaki fallback tam olarak bu).
 */
describe("requireApiKey — scope kontrolü doğrudan çağrı ile (§10.13.10 madde c)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  function authHeader() {
    return { authorization: `Bearer ${adminToken}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    __resetApiKeyCacheForTests();
    ({ accessToken: adminToken } = await registerTestUser(app, { email: "api-keys-scope-admin@example.com" }));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  async function createKey(scope: "READ" | "READ_WRITE"): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/api-keys",
      headers: authHeader(),
      payload: { name: `Scope Test (${scope})`, scope },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.plainKey as string;
  }

  function fakeRequest(plainKey: string): FastifyRequest {
    return {
      headers: { "x-api-key": plainKey },
      server: app,
      ip: "127.0.0.1",
    } as unknown as FastifyRequest;
  }

  it("READ scope'lu anahtar, READ_WRITE gerektiren bir işlemde 403 (ForbiddenError) ile reddedilir", async () => {
    const plainKey = await createKey("READ");
    const guard = requireApiKey("READ_WRITE");
    const request = fakeRequest(plainKey);

    await expect(guard(request, {} as FastifyReply)).rejects.toThrow(ForbiddenError);
    await expect(guard(fakeRequest(plainKey), {} as FastifyReply)).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });

  it("READ_WRITE scope'lu anahtar, AYNI korumalı işlemde başarıyla geçer (scope sıralaması doğru yönde çalışıyor)", async () => {
    const plainKey = await createKey("READ_WRITE");
    const guard = requireApiKey("READ_WRITE");
    const request = fakeRequest(plainKey);

    await expect(guard(request, {} as FastifyReply)).resolves.toBeUndefined();
    expect(request.apiKey).toMatchObject({ scope: "READ_WRITE" });
  });

  it("READ scope'lu anahtar, READ gerektiren (varsayılan) bir işlemde normal şekilde geçer", async () => {
    const plainKey = await createKey("READ");
    const guard = requireApiKey("READ");
    const request = fakeRequest(plainKey);

    await expect(guard(request, {} as FastifyReply)).resolves.toBeUndefined();
    expect(request.apiKey).toMatchObject({ scope: "READ" });
  });

  it("geçersiz anahtarla scope kontrolüne ULAŞILMADAN 401 (UnauthorizedError) fırlatılır", async () => {
    const guard = requireApiKey("READ_WRITE");
    const request = fakeRequest("cmsk_000000000000_" + "0".repeat(64));
    await expect(guard(request, {} as FastifyReply)).rejects.toThrow(UnauthorizedError);
  });
});

/**
 * §10.13.10 "qa-agent için kritik akışlar" madde (e): "anahtar kotası aşımında 429".
 *
 * DÜZELTME (koordinatör tarafından): önceki sürümü bu satırı "hesap başına en fazla N API
 * anahtarı" (create-time max-count) olarak yorumlamış ve `outbound-webhooks.service.ts::
 * WEBHOOK_MAX_COUNT` (409, site genelinde en fazla 20 webhook) desenine benzeterek bir
 * `it.fails` testi eklemişti. Bu YANLIŞ bir kontrat okumasıydı: §10.13.10 madde (e), §10.13.6
 * "Katman 2 — anahtar başına kota" ile AYNI cümledir — `GET /public/me`'nin "kalan kota"
 * alanına, §10.13.6'daki "aşımda 429 RATE_LIMITED + Retry-After" yanıt sözleşmesine ve
 * §10.13.10'un kendi hata kodu tablosundaki "429 | RATE_LIMITED | Kota aşıldı" satırına işaret
 * eder. Kontratta (ve `docs/architecture/ARCHITECTURE.md`'nin hiçbir yerinde) "en fazla N API
 * anahtarı oluşturulabilir" gibi bir create-time sınır YOKTUR — `api-keys.service.ts::
 * createApiKey`'de böyle bir kontrolün eksik olması bir kontrat ihlali DEĞİLDİR, o yüzden burada
 * test edilmez (backend-agent'a yönlendirilecek bir bulgu yoktur).
 *
 * Asıl madde (e), `lib/api-key-rate-limit.ts::checkApiKeyRateLimit` içinde unit seviyede zaten
 * kapsanıyor (`tests/unit/api-key-rate-limit.test.ts`) — burada eksik olan, bu mantığın gerçek
 * bir `/public/*` isteğine uçtan uca (route → preHandler → 429 yanıtı → `Retry-After` header'ı)
 * doğru şekilde bağlandığını kanıtlayan bir entegrasyon testidir. Deterministik ve hızlı olması
 * için dakikalık (120/dk) değil, saniyelik burst kovası (20/sn) tetiklenir — `rate-limits.test.ts`
 * dosyasındaki mevcut "N istek başarılı, N+1. istek 429" pattern'iyle tutarlı.
 */
describe("public-api — anahtar başına kota aşımı → 429 RATE_LIMITED (§10.13.6 Katman 2, §10.13.10 madde e)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let plainKey: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    __resetApiKeyCacheForTests();
    __resetApiKeyRateLimitForTests();
    ({ accessToken: adminToken } = await registerTestUser(app, { email: "api-keys-quota-admin@example.com" }));

    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/api-keys",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "Kota Testi Anahtarı", scope: "READ" },
    });
    expect(createRes.statusCode).toBe(201);
    ({ plainKey } = createRes.json().data as { plainKey: string });
  });

  afterAll(async () => {
    __resetApiKeyRateLimitForTests();
    await resetDatabase(app.prisma);
    await app.close();
  });

  it(`burst limitindeki (${PUBLIC_API_KEY_BURST_RATE_LIMIT.max}/sn) istek başarılı, ${PUBLIC_API_KEY_BURST_RATE_LIMIT.max + 1}. istek 429 RATE_LIMITED + Retry-After döner`, async () => {
    for (let i = 0; i < PUBLIC_API_KEY_BURST_RATE_LIMIT.max; i++) {
      const res = await app.inject({ method: "GET", url: "/api/v1/public/me", headers: { "x-api-key": plainKey } });
      expect(res.statusCode).toBe(200);
    }

    const res = await app.inject({ method: "GET", url: "/api/v1/public/me", headers: { "x-api-key": plainKey } });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("RATE_LIMITED");
    expect(res.headers["retry-after"]).toBeDefined();
    // Header'lar HER ZAMAN dakikalık (120/dk) kovayı taşır (§10.13.6) — reddedilen istek o kovayı
    // artırmaz, bu yüzden burst tetiklendiğinde bile "remaining" burst'ün DEĞİL, dakikalık kovanın
    // kalanını (120 - başarılı 20 istek = 100) gösterir.
    expect(res.headers["x-ratelimit-remaining"]).toBe(String(PUBLIC_API_KEY_RATE_LIMIT.max - PUBLIC_API_KEY_BURST_RATE_LIMIT.max));
  });
});
