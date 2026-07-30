import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

describe("pages", () => {
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

  it("rejects creating a page without authentication (401)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      payload: { title: "Hakkımızda" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates a draft page with an auto-generated slug", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "About Us" },
    });

    expect(res.statusCode).toBe(201);
    const page = res.json().data;
    expect(page.slug).toBe("about-us");
    expect(page.status).toBe("DRAFT");
    expect(page.publishedAt).toBeNull();
    expect(page.viewCount).toBe(0);
  });

  it("is not visible on the public site while a draft", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Gizli Taslak" },
    });
    const slug = create.json().data.slug;

    const publicList = await app.inject({ method: "GET", url: "/api/v1/pages" });
    expect(publicList.json().data.map((p: { slug: string }) => p.slug)).not.toContain(slug);

    const publicGet = await app.inject({ method: "GET", url: `/api/v1/pages/${slug}` });
    expect(publicGet.statusCode).toBe(404);
  });

  it("becomes visible on the public site once published, and sets publishedAt", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Yayında Sayfa", status: "PUBLISHED" },
    });
    const page = create.json().data;
    expect(page.publishedAt).not.toBeNull();

    const publicGet = await app.inject({ method: "GET", url: `/api/v1/pages/${page.slug}` });
    expect(publicGet.statusCode).toBe(200);
    expect(publicGet.json().data.title).toBe("Yayında Sayfa");

    const publicList = await app.inject({ method: "GET", url: "/api/v1/pages" });
    expect(publicList.json().data.map((p: { slug: string }) => p.slug)).toContain(page.slug);
  });

  it("updates a page's title and blocks", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Düzenlenecek" },
    });
    const pageId = create.json().data.id;

    const update = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${pageId}`,
      headers: authHeader(),
      payload: { title: "Güncellendi", blocks: [{ id: "b1", type: "hero", data: { heading: "Merhaba" } }] },
    });

    expect(update.statusCode).toBe(200);
    expect(update.json().data.title).toBe("Güncellendi");
    expect(update.json().data.blocks).toHaveLength(1);
  });

  it("increments viewCount on the public view-tracking endpoint", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Sayaç Testi", status: "PUBLISHED" },
    });
    const page = create.json().data;

    await app.inject({ method: "POST", url: `/api/v1/pages/${page.slug}/view` });
    await app.inject({ method: "POST", url: `/api/v1/pages/${page.slug}/view` });

    const after = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${page.id}`, headers: authHeader() });
    expect(after.json().data.viewCount).toBe(2);
  });

  it("deletes a page, after which it 404s", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Silinecek" },
    });
    const pageId = create.json().data.id;

    const del = await app.inject({ method: "DELETE", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({ method: "GET", url: `/api/v1/admin/pages/${pageId}`, headers: authHeader() });
    expect(get.statusCode).toBe(404);
  });

  it("404s when deleting a nonexistent page", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/admin/pages/00000000-0000-0000-0000-000000000000",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });
});
