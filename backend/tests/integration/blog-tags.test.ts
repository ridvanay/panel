import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

// §10.14 Blog Etiketleri (Tag) — çoka-çok sınıflandırma. `BlogCategory` uçlarının birebir
// simetriği + `tagIds` TAM SET (replace) semantiği (bkz. ARCHITECTURE.md §10.14).
describe("blog tags (§10.14 çoka-çok sınıflandırma)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let editorToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    // İlk kayıt olan kullanıcı otomatik ADMIN olur (bkz. auth.service.ts).
    const admin = await registerTestUser(app, { email: "tags-admin@example.com" });
    adminToken = admin.accessToken;

    const editor = await registerTestUser(app, { email: "tags-editor@example.com" });
    await app.prisma.user.update({ where: { id: editor.userId }, data: { role: "EDITOR" } });
    editorToken = editor.accessToken;

    const viewer = await registerTestUser(app, { email: "tags-viewer@example.com" });
    viewerToken = viewer.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createTag(name: string, token = editorToken) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/blog/tags",
      headers: authHeader(token),
      payload: { name },
    });
    return res;
  }

  describe("CRUD + yetki eşikleri", () => {
    it("EDITOR bir etiket oluşturabilir; slug otomatik türetilir, postCount 0 döner", async () => {
      const res = await createTag("React");
      expect(res.statusCode).toBe(201);
      const tag = res.json().data;
      expect(tag.slug).toBe("react");
      expect(tag.postCount).toBe(0);
    });

    it("aynı slug'a sahip ikinci etiket 409 CONFLICT alır", async () => {
      await createTag("Vue");
      const dup = await createTag("vue");
      expect(dup.statusCode).toBe(409);
    });

    it("USER etiket oluşturamaz (403)", async () => {
      const res = await createTag("Yasak Etiket", viewerToken);
      expect(res.statusCode).toBe(403);
    });

    it("kimliksiz istek 401 alır", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/blog/tags" });
      expect(res.statusCode).toBe(401);
    });

    it("PATCH ile ad güncellenir, slug OTOMATİK değişmez", async () => {
      const create = await createTag("Angular");
      const tagId = create.json().data.id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/blog/tags/${tagId}`,
        headers: authHeader(editorToken),
        payload: { name: "AngularJS" },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().data.name).toBe("AngularJS");
      expect(patch.json().data.slug).toBe("angular");
    });

    it("EDITOR etiket silemez (403), yalnızca ADMIN silebilir", async () => {
      const create = await createTag("Silinecek Etiket");
      const tagId = create.json().data.id;

      const forbidden = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/blog/tags/${tagId}`,
        headers: authHeader(editorToken),
      });
      expect(forbidden.statusCode).toBe(403);

      const deleted = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/blog/tags/${tagId}`,
        headers: authHeader(adminToken),
      });
      expect(deleted.statusCode).toBe(204);

      const patchAfterDelete = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/blog/tags/${tagId}`,
        headers: authHeader(adminToken),
        payload: { name: "x" },
      });
      expect(patchAfterDelete.statusCode).toBe(404);
    });
  });

  describe("postCount (§10.14.2 — çöptekileri saymaz)", () => {
    it("etiket bir yazıya atandığında postCount artar; yazı çöpe/geri alındığında güncellenir", async () => {
      const tag = (await createTag("Sayaç Etiketi")).json().data;

      const post = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(editorToken),
        payload: { title: "Sayaç Yazısı", tagIds: [tag.id] },
      });
      expect(post.statusCode).toBe(201);
      const postId = post.json().data.id;

      const listAfterCreate = await app.inject({ method: "GET", url: "/api/v1/admin/blog/tags", headers: authHeader(adminToken) });
      expect(listAfterCreate.json().data.find((t: { id: string }) => t.id === tag.id).postCount).toBe(1);

      await app.inject({ method: "DELETE", url: `/api/v1/admin/blog/${postId}`, headers: authHeader(editorToken) });
      const listAfterTrash = await app.inject({ method: "GET", url: "/api/v1/admin/blog/tags", headers: authHeader(adminToken) });
      expect(listAfterTrash.json().data.find((t: { id: string }) => t.id === tag.id).postCount).toBe(0);

      await app.inject({ method: "POST", url: `/api/v1/admin/blog/${postId}/restore`, headers: authHeader(editorToken) });
      const listAfterRestore = await app.inject({ method: "GET", url: "/api/v1/admin/blog/tags", headers: authHeader(adminToken) });
      expect(listAfterRestore.json().data.find((t: { id: string }) => t.id === tag.id).postCount).toBe(1);
    });

    it("BlogPost.tags[] içindeki etiket nesneleri postCount TAŞIMAZ", async () => {
      const tag = (await createTag("Gömülü Etiket")).json().data;
      const post = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(editorToken),
        payload: { title: "Gömülü Etiket Yazısı", tagIds: [tag.id] },
      });
      const dto = post.json().data;
      expect(dto.tags).toHaveLength(1);
      expect(dto.tags[0].id).toBe(tag.id);
      expect(dto.tags[0].postCount).toBeUndefined();
    });
  });

  describe("tagIds — yazıya atama (§10.14.4 TAM SET / delta değil)", () => {
    it("etiket yoksa yazı tags: [] ile oluşur", async () => {
      const post = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(editorToken),
        payload: { title: "Etiketsiz Yazı" },
      });
      expect(post.statusCode).toBe(201);
      expect(post.json().data.tags).toEqual([]);
    });

    it("create sırasında var olmayan bir tagId 422 alır", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(editorToken),
        payload: { title: "Geçersiz Etiketli Yazı", tagIds: ["00000000-0000-0000-0000-000000000099"] },
      });
      expect(res.statusCode).toBe(422);
    });

    it("50'den fazla tagId gönderilirse 422 (şema seviyesinde reddedilir)", async () => {
      const tooMany = Array.from({ length: 51 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(editorToken),
        payload: { title: "Çok Etiketli Yazı", tagIds: tooMany },
      });
      expect(res.statusCode).toBe(422);
    });

    it("tekrarlanan tagId'ler sessizce tekilleştirilir", async () => {
      const tag = (await createTag("Tekrarlı Etiket")).json().data;
      const post = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(editorToken),
        payload: { title: "Tekrarlı Etiket Yazısı", tagIds: [tag.id, tag.id] },
      });
      expect(post.statusCode).toBe(201);
      expect(post.json().data.tags).toHaveLength(1);
    });

    it("PATCH tagIds GÖNDERİLMEZSE etiketlere DOKUNULMAZ (undefined ≠ [])", async () => {
      const tag = (await createTag("Dokunulmaz Etiket")).json().data;
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(editorToken),
        payload: { title: "Dokunulmazlık Testi", tagIds: [tag.id] },
      });
      const postId = create.json().data.id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/blog/${postId}`,
        headers: authHeader(editorToken),
        payload: { title: "Başlık Güncellendi" },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().data.tags.map((t: { id: string }) => t.id)).toEqual([tag.id]);
    });

    it("PATCH tagIds: [] TÜM etiketleri kaldırır", async () => {
      const tag = (await createTag("Kaldırılacak Etiket")).json().data;
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(editorToken),
        payload: { title: "Kaldırma Testi", tagIds: [tag.id] },
      });
      const postId = create.json().data.id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/blog/${postId}`,
        headers: authHeader(editorToken),
        payload: { tagIds: [] },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().data.tags).toEqual([]);
    });

    it("PATCH tagIds tam set (replace) uygular — listede olmayan mevcut etiket KALDIRILIR", async () => {
      const tagA = (await createTag("Replace A")).json().data;
      const tagB = (await createTag("Replace B")).json().data;
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(editorToken),
        payload: { title: "Replace Testi", tagIds: [tagA.id] },
      });
      const postId = create.json().data.id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/blog/${postId}`,
        headers: authHeader(editorToken),
        payload: { tagIds: [tagB.id] },
      });
      expect(patch.statusCode).toBe(200);
      const ids = patch.json().data.tags.map((t: { id: string }) => t.id);
      expect(ids).toEqual([tagB.id]);
    });

    it("PATCH sırasında var olmayan bir tagId 422 alır", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(editorToken),
        payload: { title: "PATCH 422 Testi" },
      });
      const postId = create.json().data.id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/blog/${postId}`,
        headers: authHeader(editorToken),
        payload: { tagIds: ["00000000-0000-0000-0000-000000000099"] },
      });
      expect(patch.statusCode).toBe(422);
    });

    it("çöpteki yazıda tagIds değiştirilemez (409)", async () => {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(editorToken),
        payload: { title: "Çöpteki Etiket Testi" },
      });
      const postId = create.json().data.id;
      await app.inject({ method: "DELETE", url: `/api/v1/admin/blog/${postId}`, headers: authHeader(editorToken) });

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/blog/${postId}`,
        headers: authHeader(editorToken),
        payload: { tagIds: [] },
      });
      expect(patch.statusCode).toBe(409);
    });

    it("bir etiket silinirse yazılardaki ilişkisi düşer ama yazı silinmez (§10.14.2)", async () => {
      const tag = (await createTag("Silinen İlişki Etiketi")).json().data;
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(editorToken),
        payload: { title: "İlişki Testi Yazısı", tagIds: [tag.id] },
      });
      const postId = create.json().data.id;

      await app.inject({ method: "DELETE", url: `/api/v1/admin/blog/tags/${tag.id}`, headers: authHeader(adminToken) });

      const get = await app.inject({ method: "GET", url: `/api/v1/admin/blog/${postId}`, headers: authHeader(editorToken) });
      expect(get.statusCode).toBe(200);
      expect(get.json().data.tags).toEqual([]);
    });

    it("yazı çöpe taşınırsa etiket ilişkileri KORUNUR (geri yüklenince geri gelir)", async () => {
      const tag = (await createTag("Korunan Etiket")).json().data;
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(editorToken),
        payload: { title: "Koruma Testi Yazısı", tagIds: [tag.id] },
      });
      const postId = create.json().data.id;

      await app.inject({ method: "DELETE", url: `/api/v1/admin/blog/${postId}`, headers: authHeader(editorToken) });
      const trashed = await app.inject({ method: "GET", url: `/api/v1/admin/blog/${postId}`, headers: authHeader(editorToken) });
      expect(trashed.json().data.tags.map((t: { id: string }) => t.id)).toEqual([tag.id]);

      await app.inject({ method: "POST", url: `/api/v1/admin/blog/${postId}/restore`, headers: authHeader(editorToken) });
      const restored = await app.inject({ method: "GET", url: `/api/v1/admin/blog/${postId}`, headers: authHeader(editorToken) });
      expect(restored.json().data.tags.map((t: { id: string }) => t.id)).toEqual([tag.id]);
    });

    it("etiketler `seq ASC` (eklenme sırası) ile deterministik döner", async () => {
      const tagA = (await createTag("Sıra A")).json().data;
      const tagB = (await createTag("Sıra B")).json().data;
      const tagC = (await createTag("Sıra C")).json().data;

      const post = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(editorToken),
        payload: { title: "Sıra Testi", tagIds: [tagC.id, tagA.id, tagB.id] },
      });
      const ids = post.json().data.tags.map((t: { id: string }) => t.id);
      expect(ids).toEqual([tagA.id, tagB.id, tagC.id]);
    });
  });

  describe("revizyon geri yükleme — tagIds snapshot'a dahildir (§10.14.4)", () => {
    it("eski revizyona dönüldüğünde etiket seti de geri gelir; silinmiş etiket id'si sessizce atlanır (422 DEĞİL)", async () => {
      const tagA = (await createTag("Revizyon A")).json().data;
      const tagB = (await createTag("Revizyon B")).json().data;

      const create = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog",
        headers: authHeader(editorToken),
        payload: { title: "Revizyon Testi v1", tagIds: [tagA.id] },
      });
      const postId = create.json().data.id;

      // Bu PATCH'ten ÖNCEKİ state (tagIds: [tagA.id]) bir revizyon olarak kaydedilir.
      const patch1 = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/blog/${postId}`,
        headers: authHeader(editorToken),
        payload: { title: "Revizyon Testi v2", tagIds: [tagB.id] },
      });
      expect(patch1.statusCode).toBe(200);

      const revisions = (
        await app.inject({ method: "GET", url: `/api/v1/admin/blog/${postId}/revisions`, headers: authHeader(editorToken) })
      ).json().data;
      expect(revisions.length).toBeGreaterThan(0);
      const firstRevisionId = revisions[revisions.length - 1].id;

      const revisionDetail = await app.inject({
        method: "GET",
        url: `/api/v1/admin/blog/${postId}/revisions/${firstRevisionId}`,
        headers: authHeader(editorToken),
      });
      expect(revisionDetail.json().data.snapshot.tagIds).toEqual([tagA.id]);

      // tagA artık silinsin — eski revizyona dönüş bu id'yi sessizce atlamalı.
      await app.inject({ method: "DELETE", url: `/api/v1/admin/blog/tags/${tagA.id}`, headers: authHeader(adminToken) });

      const restore = await app.inject({
        method: "POST",
        url: `/api/v1/admin/blog/${postId}/revisions/${firstRevisionId}/restore`,
        headers: authHeader(editorToken),
      });
      expect(restore.statusCode).toBe(200);
      expect(restore.json().data.title).toBe("Revizyon Testi v1");
      // tagA silindiği için geri yüklenen sette YER ALMAZ, ama istek 422 İLE REDDEDİLMEZ.
      expect(restore.json().data.tags).toEqual([]);
    });
  });
});
