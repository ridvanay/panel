import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * On-demand ISR webhook tetikleyicisi (bkz. src/lib/revalidate.ts, src/config/env.ts::REVALIDATE_SECRET,
 * pages.routes.ts'teki `triggerPublicPageRevalidation` çağrı noktaları). `backend/.env.test`
 * `REVALIDATE_SECRET=test-revalidate-secret` set eder (bkz. o dosyadaki yorum) — yani bu
 * dosyanın DIŞINDAKİ tüm entegrasyon testlerinde de gerçek `fetch()` çağrısı yapılır (frontend
 * ayakta olmadığı için ECONNREFUSED ile başarısız olur, best-effort try/catch bunu yutar). Bu
 * dosya `globalThis.fetch`'i spy'layarak: (1) doğru URL/header/body üretildiğini, (2) hangi
 * aksiyonların tetiklediğini/tetiklemediğini, (3) frontend'in hata dönmesinin/ulaşılamamasının
 * asıl admin isteğini ASLA etkilemediğini doğrular.
 */
describe("on-demand revalidation webhook tetikleyicisi (lib/revalidate.ts)", () => {
  let app: FastifyInstance;
  let accessToken: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // İlk kayıt olan kullanıcı otomatik ADMIN olur (bkz. auth.service.ts) — pages/settings/bulk/
    // revisions uçlarının hepsine erişebilsin diye burada bilerek tek (ADMIN) kullanıcı kullanılıyor.
    ({ accessToken } = await registerTestUser(app));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` };
  }

  function lastCallBody(): { paths: string[]; tags?: string[] } {
    const init = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]?.[1] as RequestInit;
    return JSON.parse(init.body as string);
  }

  it("PUBLISHED olarak oluşturulan bir sayfa, doğru URL/secret header/path ile webhook'u tetikler", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Yayında Doğar", status: "PUBLISHED" },
    });
    expect(res.statusCode).toBe(201);
    const slug = res.json().data.slug;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/revalidate");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-revalidate-secret"]).toBe("test-revalidate-secret");
    // `pages`: layout'taki yayınlanmış sayfa listesi (menü) de yenilenir.
    expect(JSON.parse(init.body as string)).toEqual({ paths: [`/tr/${slug}`], tags: ["pages"] });
  });

  it("DRAFT olarak oluşturulan bir sayfa webhook'u TETİKLEMEZ", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Taslak Kalır" },
    });
    expect(res.statusCode).toBe(201);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("DRAFT -> PUBLISHED geçişinde (PATCH) webhook tetiklenir", async () => {
    const create = await app.inject({ method: "POST", url: "/api/v1/admin/pages", headers: authHeader(), payload: { title: "Sonradan Yayınla" } });
    const pageId = create.json().data.id;
    fetchSpy.mockClear();

    const update = await app.inject({ method: "PATCH", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader(), payload: { status: "PUBLISHED" } });
    expect(update.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("PUBLISHED -> DRAFT geçişinde (yayından kaldırma) webhook YİNE tetiklenir", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Yayından Kaldır", status: "PUBLISHED" },
    });
    const pageId = create.json().data.id;
    fetchSpy.mockClear();

    const update = await app.inject({ method: "PATCH", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader(), payload: { status: "DRAFT" } });
    expect(update.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("zaten PUBLISHED olan bir sayfanın sadece içeriği güncellenince de webhook tetiklenir", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "İçerik Güncelle", status: "PUBLISHED" },
    });
    const pageId = create.json().data.id;
    fetchSpy.mockClear();

    const update = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${pageId}`,
      headers: authHeader(),
      payload: { title: "İçerik Güncellendi" },
    });
    expect(update.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("DRAFT bir sayfanın DRAFT kalarak güncellenmesi webhook'u TETİKLEMEZ", async () => {
    const create = await app.inject({ method: "POST", url: "/api/v1/admin/pages", headers: authHeader(), payload: { title: "Taslak Güncelle" } });
    const pageId = create.json().data.id;
    fetchSpy.mockClear();

    const update = await app.inject({ method: "PATCH", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader(), payload: { title: "Hala Taslak" } });
    expect(update.statusCode).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("çevirisi olan (en) yayındaki bir sayfa için TÜM etkin dillerin path'leri gönderilir", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: {
        title: "Çok Dilli Sayfa",
        status: "PUBLISHED",
        translations: { en: { title: "Multilingual Page", slug: "multilingual-page" } },
      },
    });
    expect(create.statusCode).toBe(201);
    const slug = create.json().data.slug;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lastCallBody().paths.sort()).toEqual([`/en/multilingual-page`, `/tr/${slug}`].sort());
  });

  it("boş/silinmiş bir çeviri için path ÜRETİLMEZ (yalnızca varsayılan dilin path'i gönderilir)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Tek Dilli Sayfa", status: "PUBLISHED" },
    });
    expect(create.statusCode).toBe(201);
    const slug = create.json().data.slug;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lastCallBody().paths).toEqual([`/tr/${slug}`]);
  });

  it("ana sayfa olarak ayarlanmış PUBLISHED bir sayfa güncellendiğinde path slug'sız (/tr) üretilir", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Ana Sayfa Adayı", status: "PUBLISHED" },
    });
    const pageId = create.json().data.id;

    const setHome = await app.inject({ method: "PATCH", url: "/api/v1/admin/settings", headers: authHeader(), payload: { homePageId: pageId } });
    expect(setHome.statusCode).toBe(200);
    fetchSpy.mockClear();

    const update = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${pageId}`,
      headers: authHeader(),
      payload: { title: "Ana Sayfa Adayı Güncellendi" },
    });
    expect(update.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lastCallBody().paths).toEqual(["/tr"]);

    // Temizlik — sonraki testler etkilenmesin diye ana sayfa atamasını geri al.
    await app.inject({ method: "PATCH", url: "/api/v1/admin/settings", headers: authHeader(), payload: { homePageId: null } });
  });

  it("toplu (bulk) trash aksiyonu, yayındaki sayfalar için webhook'u tetikler", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Toplu Çöp", status: "PUBLISHED" },
    });
    const pageId = create.json().data.id;
    fetchSpy.mockClear();

    const bulk = await app.inject({ method: "POST", url: "/api/v1/admin/pages/bulk", headers: authHeader(), payload: { ids: [pageId], action: "trash" } });
    expect(bulk.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("toplu (bulk) trash aksiyonu, TASLAK sayfalar için webhook'u TETİKLEMEZ", async () => {
    const create = await app.inject({ method: "POST", url: "/api/v1/admin/pages", headers: authHeader(), payload: { title: "Toplu Çöp Taslak" } });
    const pageId = create.json().data.id;
    fetchSpy.mockClear();

    const bulk = await app.inject({ method: "POST", url: "/api/v1/admin/pages/bulk", headers: authHeader(), payload: { ids: [pageId], action: "trash" } });
    expect(bulk.statusCode).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("toplu (bulk) restore aksiyonu, önceden yayındaki bir sayfa için webhook'u tetikler", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Toplu Geri Yükle", status: "PUBLISHED" },
    });
    const pageId = create.json().data.id;
    await app.inject({ method: "POST", url: "/api/v1/admin/pages/bulk", headers: authHeader(), payload: { ids: [pageId], action: "trash" } });
    fetchSpy.mockClear();

    const bulk = await app.inject({ method: "POST", url: "/api/v1/admin/pages/bulk", headers: authHeader(), payload: { ids: [pageId], action: "restore" } });
    expect(bulk.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("toplu (bulk) publish aksiyonu webhook'u tetikler", async () => {
    const create = await app.inject({ method: "POST", url: "/api/v1/admin/pages", headers: authHeader(), payload: { title: "Toplu Yayınla" } });
    const pageId = create.json().data.id;
    fetchSpy.mockClear();

    const bulk = await app.inject({ method: "POST", url: "/api/v1/admin/pages/bulk", headers: authHeader(), payload: { ids: [pageId], action: "publish" } });
    expect(bulk.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("revizyon geri yükleme, sayfa YAYINDAYSA webhook'u tetikler", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Revizyon v1", status: "PUBLISHED" },
    });
    const pageId = create.json().data.id;
    await app.inject({ method: "PATCH", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader(), payload: { title: "Revizyon v2" } });

    const revisions = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${pageId}/revisions`, headers: authHeader() });
    const revisionId = revisions.json().data[0].id;
    fetchSpy.mockClear();

    const restore = await app.inject({
      method: "POST",
      url: `/api/v1/admin/pages/${pageId}/revisions/${revisionId}/restore`,
      headers: authHeader(),
    });
    expect(restore.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("frontend webhook'u 500 dönerse dahi asıl istek başarıyla tamamlanır (best-effort tolerans)", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "500 Toleransı", status: "PUBLISHED" },
    });
    expect(res.statusCode).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("frontend'e ağ hatası (fetch reddi) oluşsa dahi asıl istek başarıyla tamamlanır (best-effort tolerans)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Ağ Hatası Toleransı", status: "PUBLISHED" },
    });
    expect(res.statusCode).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * Etiket (tag) revalidation — `lib/revalidate.ts::triggerTagRevalidation` / `revalidateTagsOnWrite`.
 * Tek bir alanı değiştiren admin kayıtları TÜM siteyi (`{ paths: ["/"], type: "layout" }`) DEĞİL,
 * yalnızca o veriyi kullanan sayfaları yeniler: frontend `{ tags }` alır ve `revalidateTag` çağırır.
 * Kapsamlı bir modül test suite'i DEĞİLDİR — her alanın DOĞRU etiketi gönderdiğinin regresyon testi.
 */
describe("etiket revalidation — admin kayıtları yalnızca ilgili veriyi yeniler", () => {
  let app: FastifyInstance;
  let accessToken: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // İlk kayıt olan kullanıcı otomatik ADMIN olur — appearance custom-code (ADMIN-only), settings
    // (ADMIN) ve diğer ADMIN+MANAGER uçlarının hepsine erişebilsin diye.
    ({ accessToken } = await registerTestUser(app));
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` };
  }

  function lastCallBody(): { paths?: string[]; tags?: string[]; type?: string } {
    const init = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]?.[1] as RequestInit;
    return JSON.parse(init.body as string);
  }

  it.each([
    ["PATCH /admin/appearance", "PATCH", "/api/v1/admin/appearance", { primaryColor: "#123456" }],
    ["POST /admin/appearance/reset", "POST", "/api/v1/admin/appearance/reset", {}],
    ["PUT /admin/appearance/custom-code/css", "PUT", "/api/v1/admin/appearance/custom-code/css", { css: "body { color: red; }", acknowledged: true }],
    ["PUT /admin/appearance/custom-code/js", "PUT", "/api/v1/admin/appearance/custom-code/js", { js: "console.log('hi')", acknowledged: true }],
  ] as const)("%s → yalnızca `appearance` etiketi (tüm site DEĞİL)", async (_label, method, url, payload) => {
    const res = await app.inject({ method, url, headers: authHeader(), payload });
    expect(res.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lastCallBody()).toEqual({ tags: ["appearance"] });
  });

  it("PUT /admin/navigation → `navigation` etiketi", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/navigation",
      headers: authHeader(),
      payload: { headerCtaLabel: null, headerCtaHref: null, footerCopyrightText: null, navigationItems: [], socialLinks: [], footerColumns: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lastCallBody()).toEqual({ tags: ["navigation"] });
  });

  it("PATCH /admin/settings (logo, favicon, anasayfa seçimi) → `settings` etiketi", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/v1/admin/settings", headers: authHeader(), payload: { logoUrl: "/uploads/yeni-logo.png" } });
    expect(res.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lastCallBody()).toEqual({ tags: ["settings"] });
  });

  it("blog yazısı oluşturma/güncelleme/autosave → `blog` etiketi", async () => {
    const create = await app.inject({ method: "POST", url: "/api/v1/admin/blog", headers: authHeader(), payload: { title: "Etiket Testi", status: "PUBLISHED" } });
    expect(create.statusCode).toBe(201);
    expect(lastCallBody()).toEqual({ tags: ["blog"] });
    const postId = create.json().data.id;

    fetchSpy.mockClear();
    const autosave = await app.inject({ method: "POST", url: `/api/v1/admin/blog/${postId}/autosave`, headers: authHeader(), payload: { title: "Canlı düzeltme" } });
    expect(autosave.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lastCallBody()).toEqual({ tags: ["blog"] });
  });

  it("başarısız yazma (404/400) ve okuma (GET) tetiklemez", async () => {
    const missing = await app.inject({ method: "PATCH", url: "/api/v1/admin/blog/00000000-0000-4000-8000-000000000000", headers: authHeader(), payload: { title: "x" } });
    expect(missing.statusCode).toBe(404);
    const list = await app.inject({ method: "GET", url: "/api/v1/admin/blog", headers: authHeader() });
    expect(list.statusCode).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uzmanlık kaydı → `specialties` + `doctors` etiketleri", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/admin/telehealth/specialties", headers: authHeader(), payload: { name: "Etiket Kardiyoloji", icon: "HeartPulse" } });
    expect(res.statusCode).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lastCallBody()).toEqual({ tags: ["specialties", "doctors"] });
  });

  it("slider güncelleme → yalnızca o slider'ın `slider:<id>` etiketi; oluşturma tetiklemez", async () => {
    const create = await app.inject({ method: "POST", url: "/api/v1/admin/sliders", headers: authHeader(), payload: { name: "Etiket Slider" } });
    expect(create.statusCode).toBe(201);
    expect(fetchSpy).not.toHaveBeenCalled();
    const sliderId = create.json().data.id;

    const update = await app.inject({ method: "PATCH", url: `/api/v1/admin/sliders/${sliderId}`, headers: authHeader(), payload: { name: "Etiket Slider 2" } });
    expect(update.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lastCallBody()).toEqual({ tags: [`slider:${sliderId}`] });
  });
});

/**
 * `REVALIDATE_SECRET` boşken (yapılandırılmamışken) özellik SESSİZCE devre dışı kalmalı — `env`
 * modülü process başına BİR KEZ `process.env`'den okunduğu için (bkz. config/env.ts) taze bir
 * uygulama grafiği elde etmek üzere `vi.resetModules()` + dinamik `import()` kullanılır
 * (`appearance.test.ts`'teki CUSTOM_CODE_ENABLED kill-switch testiyle AYNI yaklaşım).
 */
describe("REVALIDATE_SECRET boşken revalidation tamamen no-op olur", () => {
  let app: FastifyInstance;
  let accessToken: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const originalSecret = process.env.REVALIDATE_SECRET;

  beforeAll(async () => {
    process.env.REVALIDATE_SECRET = "";
    vi.resetModules();

    const { buildApp } = await import("../../src/app");
    app = buildApp();
    await app.ready();
    await resetDatabase(app.prisma);
    ({ accessToken } = await registerTestUser(app));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
    process.env.REVALIDATE_SECRET = originalSecret;
    vi.resetModules();
  });

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("açılış uyarısı: sır yoksa `warnIfRevalidationDisabled` bir uyarı loglar", async () => {
    const { warnIfRevalidationDisabled } = await import("../../src/lib/revalidate");
    const warn = vi.spyOn(app.log, "warn");
    warnIfRevalidationDisabled(app);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("REVALIDATE_SECRET");
    warn.mockRestore();
  });

  it("etiket tetikleyicisi (ayarlar kaydı) da fetch ÇAĞIRMAZ", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { siteName: "Sırsız" },
    });
    expect(res.statusCode).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("PUBLISHED bir sayfa oluşturulsa dahi fetch hiç ÇAĞRILMAZ", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { title: "Sessiz Devre Dışı", status: "PUBLISHED" },
    });
    expect(res.statusCode).toBe(201);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
