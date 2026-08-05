import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

describe("blog posts (§10.7 çöp kutusu / toplu işlem / yazar / SEO skoru)", () => {
  let app: FastifyInstance;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // İlk kayıt olan kullanıcı otomatik ADMIN olur (bkz. auth.service.ts).
    ({ accessToken, userId } = await registerTestUser(app));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` };
  }

  it("creates a draft post with an auto-generated slug and default author", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/blog",
      headers: authHeader(),
      payload: { title: "İlk Yazı" },
    });

    expect(res.statusCode).toBe(201);
    const post = res.json().data;
    expect(post.slug).toBe("ilk-yaz");
    expect(post.status).toBe("DRAFT");
    expect(post.deletedAt).toBeNull();
    expect(post.authorId).toBe(userId);
    expect(post.author).toMatchObject({ id: userId, name: expect.any(String), email: expect.any(String) });
  });

  it("soft-deletes a post (moves to trash) — it still 200s on GET with deletedAt set, and is idempotent", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/blog",
      headers: authHeader(),
      payload: { title: "Silinecek Yazı" },
    });
    const postId = create.json().data.id;

    const del = await app.inject({ method: "DELETE", url: `/api/v1/admin/blog/${postId}`, headers: authHeader() });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({ method: "GET", url: `/api/v1/admin/blog/${postId}`, headers: authHeader() });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.deletedAt).not.toBeNull();

    const delAgain = await app.inject({ method: "DELETE", url: `/api/v1/admin/blog/${postId}`, headers: authHeader() });
    expect(delAgain.statusCode).toBe(204);
  });

  it("excludes trashed posts from the default list, includes via trashed=only/include, and returns meta.counts", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/blog",
      headers: authHeader(),
      payload: { title: "Çöp Testi Yazısı" },
    });
    const postId = create.json().data.id;
    await app.inject({ method: "DELETE", url: `/api/v1/admin/blog/${postId}`, headers: authHeader() });

    const excludeList = await app.inject({ method: "GET", url: "/api/v1/admin/blog?trashed=exclude", headers: authHeader() });
    expect(excludeList.json().data.map((p: { id: string }) => p.id)).not.toContain(postId);
    expect(excludeList.json().meta.counts).toHaveProperty("trashed");

    const onlyList = await app.inject({ method: "GET", url: "/api/v1/admin/blog?trashed=only", headers: authHeader() });
    expect(onlyList.json().data.map((p: { id: string }) => p.id)).toContain(postId);

    const includeList = await app.inject({ method: "GET", url: "/api/v1/admin/blog?trashed=include", headers: authHeader() });
    expect(includeList.json().data.map((p: { id: string }) => p.id)).toContain(postId);
  });

  it("restores a trashed post — status unchanged, idempotent", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/blog",
      headers: authHeader(),
      payload: { title: "Geri Yüklenecek Yazı", status: "PUBLISHED" },
    });
    const postId = create.json().data.id;
    await app.inject({ method: "DELETE", url: `/api/v1/admin/blog/${postId}`, headers: authHeader() });

    const restore = await app.inject({ method: "POST", url: `/api/v1/admin/blog/${postId}/restore`, headers: authHeader() });
    expect(restore.statusCode).toBe(200);
    expect(restore.json().data.deletedAt).toBeNull();
    expect(restore.json().data.status).toBe("PUBLISHED");

    const restoreAgain = await app.inject({ method: "POST", url: `/api/v1/admin/blog/${postId}/restore`, headers: authHeader() });
    expect(restoreAgain.statusCode).toBe(200);
  });

  it("rejects editing a trashed post with 409, and requires trash before permanent delete", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/blog",
      headers: authHeader(),
      payload: { title: "Kalıcı Silme Testi Yazısı" },
    });
    const postId = create.json().data.id;

    const permanentBeforeTrash = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/blog/${postId}/permanent`,
      headers: authHeader(),
    });
    expect(permanentBeforeTrash.statusCode).toBe(409);

    await app.inject({ method: "DELETE", url: `/api/v1/admin/blog/${postId}`, headers: authHeader() });

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/blog/${postId}`,
      headers: authHeader(),
      payload: { title: "Değişmemeli" },
    });
    expect(patch.statusCode).toBe(409);

    const permanent = await app.inject({ method: "DELETE", url: `/api/v1/admin/blog/${postId}/permanent`, headers: authHeader() });
    expect(permanent.statusCode).toBe(204);

    const get = await app.inject({ method: "GET", url: `/api/v1/admin/blog/${postId}`, headers: authHeader() });
    expect(get.statusCode).toBe(404);
  });

  it("applies a bulk trash action with partial success (skippedIds)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/blog",
      headers: authHeader(),
      payload: { title: "Toplu İşlem Yazısı" },
    });
    const postId = create.json().data.id;
    const missingId = "00000000-0000-0000-0000-000000000099";

    const bulk = await app.inject({
      method: "POST",
      url: "/api/v1/admin/blog/bulk",
      headers: authHeader(),
      payload: { ids: [postId, missingId], action: "trash" },
    });

    expect(bulk.statusCode).toBe(200);
    const result = bulk.json().data;
    expect(result.action).toBe("trash");
    expect(result.requestedCount).toBe(2);
    expect(result.affectedCount).toBe(1);
    expect(result.skippedIds).toContain(missingId);

    const get = await app.inject({ method: "GET", url: `/api/v1/admin/blog/${postId}`, headers: authHeader() });
    expect(get.json().data.deletedAt).not.toBeNull();
  });

  it("computes a low SEO score with issues for a bare-minimum post, and a full score once completed", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/blog",
      headers: authHeader(),
      payload: { title: "SEO Yazı Testi" },
    });
    const postId = create.json().data.id;
    expect(create.json().data.seoScore).toBeLessThan(100);
    expect(create.json().data.seoScoreIssues.length).toBeGreaterThan(0);

    const longWords = Array.from({ length: 320 }, (_, i) => `kelime${i}`).join(" ");
    const seoTitle = "T".repeat(55);
    const seoDescription = "D".repeat(140);

    const update = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/blog/${postId}`,
      headers: authHeader(),
      payload: {
        seoTitle,
        seoDescription,
        coverImageUrl: "https://example.com/cover.jpg",
        contentHtml: `<p>${longWords}</p><img src="https://example.com/img.jpg" alt="Açıklayıcı alt metin" />`,
      },
    });

    expect(update.statusCode).toBe(200);
    expect(update.json().data.seoScore).toBe(100);
    expect(update.json().data.seoScoreIssues).toEqual([]);
  });

  // Güvenlik: EDITOR de yazı yazabildiği için (ADMIN'den daha az güvenilir bir rol), `contentHtml`
  // public sitede `dangerouslySetInnerHTML` ile DOĞRUDAN render edilir (bkz.
  // frontend/src/app/(site)/blog/[slug]/page.tsx) — bu yüzden DB'ye yazılmadan önce sanitize
  // edilmelidir (bkz. lib/html-sanitize.ts).
  it("sanitizes a <script>-injected contentHtml on create, keeping legitimate formatting", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/blog",
      headers: authHeader(),
      payload: {
        title: "XSS Denemesi",
        contentHtml: '<p>Merhaba <b>dünya</b></p><script>alert(1)</script><a href="javascript:alert(2)">tıkla</a>',
      },
    });

    expect(create.statusCode).toBe(201);
    const html = create.json().data.contentHtml as string;
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<p>Merhaba <b>dünya</b></p>");
  });

  it("sanitizes a <script>-injected contentHtml on update", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/blog",
      headers: authHeader(),
      payload: { title: "XSS Update Denemesi" },
    });
    const postId = create.json().data.id;

    const update = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/blog/${postId}`,
      headers: authHeader(),
      payload: { contentHtml: '<p onclick="alert(1)">Merhaba</p><iframe src="evil.com"></iframe>' },
    });

    expect(update.statusCode).toBe(200);
    const html = update.json().data.contentHtml as string;
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("iframe");
    expect(html).toContain("Merhaba");
  });

  // §10.2 Gelişmiş SEO & Social Card — frontend generateMetadata() bu alanlara bağlıdır;
  // public detay ucu bunları eksiksiz döndürmelidir.
  it("returns full SEO/OG fields (ogTitle, ogImageUrl, canonicalUrl, noIndex) on the public detail endpoint", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/blog",
      headers: authHeader(),
      payload: {
        title: "SEO Alanları Yazısı",
        status: "PUBLISHED",
        seoTitle: "Özel SEO Başlığı",
        seoDescription: "Özel SEO açıklaması.",
        ogTitle: "Özel OG Başlığı",
        ogImageUrl: "https://example.com/og-image.jpg",
        canonicalUrl: "https://example.com/seo-alanlari-yazisi",
        noIndex: true,
      },
    });
    expect(create.statusCode).toBe(201);
    const post = create.json().data;

    const publicGet = await app.inject({ method: "GET", url: `/api/v1/blog/${post.slug}` });
    expect(publicGet.statusCode).toBe(200);
    const dto = publicGet.json().data;
    expect(dto.seoTitle).toBe("Özel SEO Başlığı");
    expect(dto.seoDescription).toBe("Özel SEO açıklaması.");
    expect(dto.ogTitle).toBe("Özel OG Başlığı");
    expect(dto.ogImageUrl).toBe("https://example.com/og-image.jpg");
    expect(dto.canonicalUrl).toBe("https://example.com/seo-alanlari-yazisi");
    expect(dto.noIndex).toBe(true);
  });

  it("does not surface soft-deleted posts on public endpoints", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/blog",
      headers: authHeader(),
      payload: { title: "Yayında Ama Çöpe Gidecek", status: "PUBLISHED" },
    });
    const post = create.json().data;

    const publicBefore = await app.inject({ method: "GET", url: `/api/v1/blog/${post.slug}` });
    expect(publicBefore.statusCode).toBe(200);

    await app.inject({ method: "DELETE", url: `/api/v1/admin/blog/${post.id}`, headers: authHeader() });

    const publicAfter = await app.inject({ method: "GET", url: `/api/v1/blog/${post.slug}` });
    expect(publicAfter.statusCode).toBe(404);

    const publicList = await app.inject({ method: "GET", url: "/api/v1/blog" });
    expect(publicList.json().data.map((p: { slug: string }) => p.slug)).not.toContain(post.slug);
  });
});
