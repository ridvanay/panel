import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { runScheduledPublishSweep } from "../../src/lib/scheduled-publish";

/**
 * İçerik editörü Faz 4 (zamanlanmış yayın) — `runScheduledPublishSweep` doğrudan çağrılır
 * (gerçek zaman-tetiklemeli `setInterval` zamanlayıcısı — bkz. `registerScheduledPublishSweeper`
 * — production sarmalayıcısıdır, burada test edilen ASIL iş mantığı değildir; `import-retention.test.ts`
 * ile AYNI desen).
 */
describe("zamanlanmış yayın (Faz 4)", () => {
  let app: FastifyInstance;
  let accessToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    ({ accessToken } = await registerTestUser(app));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` };
  }

  const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  describe("blog posts", () => {
    it("rejects create with status=SCHEDULED and a past scheduledAt (422)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(),
        payload: { title: "Geçmişe Zamanlanmış Yazı", status: "SCHEDULED", scheduledAt: PAST },
      });
      expect(res.statusCode).toBe(422);
    });

    it("rejects create with status=SCHEDULED and no scheduledAt (422)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(),
        payload: { title: "Tarihsiz Zamanlanmış Yazı", status: "SCHEDULED" },
      });
      expect(res.statusCode).toBe(422);
    });

    it("creates a SCHEDULED post with a future scheduledAt, leaves publishedAt null, and the sweeper publishes it once due", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(),
        payload: { title: "Zamanlanmış Yazı", status: "SCHEDULED", scheduledAt: FUTURE },
      });
      expect(create.statusCode).toBe(201);
      const post = create.json().data;
      expect(post.status).toBe("SCHEDULED");
      expect(post.publishedAt).toBeNull();

      // Zamanı simüle et: sweeper'ın yakalayacağı şekilde `scheduledAt`'i geçmişe çek
      // (doğrudan DB üzerinden — API'nin kendi validasyonunu BYPASS eder, bilerek).
      await app.prisma.blogPost.update({ where: { id: post.id }, data: { scheduledAt: new Date(PAST) } });

      const result = await runScheduledPublishSweep(app);
      expect(result.publishedBlogPosts).toBeGreaterThanOrEqual(1);

      const get = await app.inject({ method: "GET", url: `/api/v1/admin/blog/${post.id}`, headers: authHeader() });
      const dto = get.json().data;
      expect(dto.status).toBe("PUBLISHED");
      expect(dto.publishedAt).not.toBeNull();
      expect(dto.scheduledAt ?? null).toBeNull();
    });

    it("clears a stale scheduledAt when manually publishing (status=PUBLISHED overrides scheduling)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(),
        payload: { title: "Elle Yayınlanacak Zamanlanmış Yazı", status: "SCHEDULED", scheduledAt: FUTURE },
      });
      const postId = create.json().data.id;

      const update = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/blog/${postId}`,
        headers: authHeader(),
        payload: { status: "PUBLISHED" },
      });
      expect(update.statusCode).toBe(200);
      expect(update.json().data.status).toBe("PUBLISHED");
      expect(update.json().data.publishedAt).not.toBeNull();

      const stored = await app.prisma.blogPost.findUniqueOrThrow({ where: { id: postId } });
      expect(stored.scheduledAt).toBeNull();
    });

    it("leaves an existing schedule untouched when an unrelated field is updated without status", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(),
        payload: { title: "Dokunulmayacak Zamanlama", status: "SCHEDULED", scheduledAt: FUTURE },
      });
      const postId = create.json().data.id;

      const update = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/blog/${postId}`,
        headers: authHeader(),
        payload: { excerpt: "Sadece özet değişti" },
      });
      expect(update.statusCode).toBe(200);
      expect(update.json().data.status).toBe("SCHEDULED");

      const stored = await app.prisma.blogPost.findUniqueOrThrow({ where: { id: postId } });
      expect(stored.scheduledAt).not.toBeNull();
    });
  });

  describe("pages", () => {
    it("rejects update to status=SCHEDULED without a valid future scheduledAt (422)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Zamanlanacak Sayfa" },
      });
      const pageId = create.json().data.id;

      const update = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${pageId}`,
        headers: authHeader(),
        payload: { status: "SCHEDULED", scheduledAt: PAST },
      });
      expect(update.statusCode).toBe(422);
    });

    it("creates a SCHEDULED page and the sweeper publishes it once due", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Zamanlanmış Sayfa", status: "SCHEDULED", scheduledAt: FUTURE },
      });
      expect(create.statusCode).toBe(201);
      const page = create.json().data;
      expect(page.status).toBe("SCHEDULED");
      expect(page.publishedAt).toBeNull();

      await app.prisma.page.update({ where: { id: page.id }, data: { scheduledAt: new Date(PAST) } });

      const result = await runScheduledPublishSweep(app);
      expect(result.publishedPages).toBeGreaterThanOrEqual(1);

      const get = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${page.id}`, headers: authHeader() });
      const dto = get.json().data;
      expect(dto.status).toBe("PUBLISHED");
      expect(dto.publishedAt).not.toBeNull();
    });
  });

  describe("products", () => {
    it("creates a SCHEDULED product and the sweeper publishes it once due", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(),
        payload: {
          title: "Zamanlanmış Ürün",
          priceCents: 1000,
          status: "SCHEDULED",
          scheduledAt: FUTURE,
        },
      });
      expect(create.statusCode).toBe(201);
      const product = create.json().data;
      expect(product.status).toBe("SCHEDULED");
      expect(product.publishedAt).toBeNull();

      // Zamanı simüle et: sweeper'ın yakalayacağı şekilde `scheduledAt`'i geçmişe çek
      // (doğrudan DB üzerinden — API'nin kendi validasyonunu BYPASS eder, bilerek).
      await app.prisma.product.update({ where: { id: product.id }, data: { scheduledAt: new Date(PAST) } });

      const result = await runScheduledPublishSweep(app);
      expect(result.publishedProducts).toBeGreaterThanOrEqual(1);

      const get = await app.inject({
        method: "GET",
        url: `/api/v1/admin/products/${product.id}`,
        headers: authHeader(),
      });
      const dto = get.json().data;
      expect(dto.status).toBe("PUBLISHED");
      expect(dto.publishedAt).not.toBeNull();
      expect(dto.scheduledAt ?? null).toBeNull();
    });

    it("leaves a future-scheduled product untouched", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/products",
        headers: authHeader(),
        payload: {
          title: "Gelecekteki Zamanlanmış Ürün",
          priceCents: 1000,
          status: "SCHEDULED",
          scheduledAt: FUTURE,
        },
      });
      const productId = create.json().data.id;

      await runScheduledPublishSweep(app);

      const stored = await app.prisma.product.findUniqueOrThrow({ where: { id: productId } });
      expect(stored.status).toBe("SCHEDULED");
      expect(stored.publishedAt).toBeNull();
    });
  });

  describe("portfolio items", () => {
    it("creates a SCHEDULED portfolio item and the sweeper publishes it once due", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: authHeader(),
        payload: {
          title: "Zamanlanmış Portföy Öğesi",
          status: "SCHEDULED",
          scheduledAt: FUTURE,
        },
      });
      expect(create.statusCode).toBe(201);
      const item = create.json().data;
      expect(item.status).toBe("SCHEDULED");
      expect(item.publishedAt).toBeNull();

      // Zamanı simüle et: sweeper'ın yakalayacağı şekilde `scheduledAt`'i geçmişe çek
      // (doğrudan DB üzerinden — API'nin kendi validasyonunu BYPASS eder, bilerek).
      await app.prisma.portfolioItem.update({ where: { id: item.id }, data: { scheduledAt: new Date(PAST) } });

      const result = await runScheduledPublishSweep(app);
      expect(result.publishedPortfolioItems).toBeGreaterThanOrEqual(1);

      const get = await app.inject({
        method: "GET",
        url: `/api/v1/admin/portfolio/${item.id}`,
        headers: authHeader(),
      });
      const dto = get.json().data;
      expect(dto.status).toBe("PUBLISHED");
      expect(dto.publishedAt).not.toBeNull();
      expect(dto.scheduledAt ?? null).toBeNull();
    });

    it("leaves a future-scheduled portfolio item untouched", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/portfolio",
        headers: authHeader(),
        payload: {
          title: "Gelecekteki Zamanlanmış Portföy Öğesi",
          status: "SCHEDULED",
          scheduledAt: FUTURE,
        },
      });
      const itemId = create.json().data.id;

      await runScheduledPublishSweep(app);

      const stored = await app.prisma.portfolioItem.findUniqueOrThrow({ where: { id: itemId } });
      expect(stored.status).toBe("SCHEDULED");
      expect(stored.publishedAt).toBeNull();
    });
  });

  // Boşluk taraması (bkz. görev notu) — sınır durumu, çoklu-tablo tek-tarama, ve status=DRAFT
  // ile elle zamanlamanın temizlenmesi.
  describe("edge case'ler", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("scheduledAt tam olarak sweeper'ın `now`'ına eşit olduğunda da yayınlanır (lte, lt DEĞİL)", async () => {
      // Yalnızca `Date` sahtelenir — setTimeout/network zamanlayıcıları GERÇEK kalır (DB
      // sürücüsünün/undici'nin iç zamanlayıcılarını bozmamak için `toFake: ["Date"]`).
      const fixedNow = new Date("2026-06-01T12:00:00.000Z");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(fixedNow);

      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(),
        payload: { title: "Sınırda Zamanlanmış Yazı", status: "SCHEDULED", scheduledAt: new Date(fixedNow.getTime() + 1).toISOString() },
      });
      const postId = create.json().data.id;
      // DB'ye API validasyonunu bypass ederek TAM `fixedNow` değerini yaz (create sırasında
      // gelecek zorunluluğu var, bu yüzden 1ms sonrası ile oluşturulup burada eşitlenir).
      await app.prisma.blogPost.update({ where: { id: postId }, data: { scheduledAt: fixedNow } });

      const result = await runScheduledPublishSweep(app);
      expect(result.publishedBlogPosts).toBeGreaterThanOrEqual(1);

      const stored = await app.prisma.blogPost.findUniqueOrThrow({ where: { id: postId } });
      expect(stored.status).toBe("PUBLISHED");
    });

    it("aynı taramada hem due bir blog yazısını hem de due bir sayfayı yayınlar (biri diğerini atlamaz)", async () => {
      const createPost = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(),
        payload: { title: "Ortak Tarama Yazısı", status: "SCHEDULED", scheduledAt: FUTURE },
      });
      const postId = createPost.json().data.id;
      await app.prisma.blogPost.update({ where: { id: postId }, data: { scheduledAt: new Date(PAST) } });

      const createPage = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Ortak Tarama Sayfası", status: "SCHEDULED", scheduledAt: FUTURE },
      });
      const pageId = createPage.json().data.id;
      await app.prisma.page.update({ where: { id: pageId }, data: { scheduledAt: new Date(PAST) } });

      const result = await runScheduledPublishSweep(app);
      expect(result.publishedBlogPosts).toBeGreaterThanOrEqual(1);
      expect(result.publishedPages).toBeGreaterThanOrEqual(1);

      const [storedPost, storedPage] = await Promise.all([
        app.prisma.blogPost.findUniqueOrThrow({ where: { id: postId } }),
        app.prisma.page.findUniqueOrThrow({ where: { id: pageId } }),
      ]);
      expect(storedPost.status).toBe("PUBLISHED");
      expect(storedPage.status).toBe("PUBLISHED");
    });

    it("status=SCHEDULED'dan status=DRAFT'a EXPLICIT geçişte scheduledAt null'a temizlenir (blog yazısı)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(),
        payload: { title: "Taslağa Döndürülecek Yazı", status: "SCHEDULED", scheduledAt: FUTURE },
      });
      const postId = create.json().data.id;

      const update = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/blog/${postId}`,
        headers: authHeader(),
        payload: { status: "DRAFT" },
      });
      expect(update.statusCode).toBe(200);
      expect(update.json().data.status).toBe("DRAFT");
      expect(update.json().data.scheduledAt ?? null).toBeNull();

      const stored = await app.prisma.blogPost.findUniqueOrThrow({ where: { id: postId } });
      expect(stored.scheduledAt).toBeNull();
    });

    it("status=SCHEDULED'dan status=DRAFT'a EXPLICIT geçişte scheduledAt null'a temizlenir (sayfa)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/pages",
        headers: authHeader(),
        payload: { title: "Taslağa Döndürülecek Sayfa", status: "SCHEDULED", scheduledAt: FUTURE },
      });
      const pageId = create.json().data.id;

      const update = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/pages/${pageId}`,
        headers: authHeader(),
        payload: { status: "DRAFT" },
      });
      expect(update.statusCode).toBe(200);
      expect(update.json().data.status).toBe("DRAFT");
      expect(update.json().data.scheduledAt ?? null).toBeNull();

      const stored = await app.prisma.page.findUniqueOrThrow({ where: { id: pageId } });
      expect(stored.scheduledAt).toBeNull();
    });
  });
});
