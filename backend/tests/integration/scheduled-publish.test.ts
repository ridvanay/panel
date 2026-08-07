import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
});
