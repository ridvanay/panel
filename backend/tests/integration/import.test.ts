import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import yazl from "yazl";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { buildMultipartPayload } from "../helpers/multipart";

// 1x1 transparent PNG (gerçek PNG magic byte'ları) — tests/unit/import-zip-parser.test.ts /
// tests/integration/media.test.ts ile aynı sabit.
const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000" + "01f15c4890000000a4944415478da6360000002000155bb84770000000049454e44ae426082",
  "hex"
);

async function buildZipBuffer(entries: { name: string; content: Buffer }[]): Promise<Buffer> {
  const zipfile = new yazl.ZipFile();
  for (const entry of entries) zipfile.addBuffer(entry.content, entry.name);
  zipfile.end();
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    zipfile.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zipfile.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zipfile.outputStream.on("error", reject);
  });
}

/**
 * §10.8 Toplu İçe Aktarma — uçtan uca (RBAC, upload→preview→start→poll→errors→cancel→delete).
 * `buildMultipartPayload` (bkz. tests/helpers/multipart.ts) `media.test.ts` ile PAYLAŞILIR.
 */
describe("import (§10.8)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let editorToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // İlk kayıt otomatik ADMIN olur (bkz. auth.service.ts::register).
    const admin = await registerTestUser(app, { email: "import-admin@example.com" });
    adminToken = admin.accessToken;
    const editor = await registerTestUser(app, { email: "import-editor@example.com" });
    editorToken = editor.accessToken;
    await app.prisma.user.update({ where: { id: editor.userId }, data: { role: "EDITOR" } });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function pollJobUntilTerminal(jobId: string, token: string, timeoutMs = 15000): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await app.inject({ method: "GET", url: `/api/v1/admin/import/jobs/${jobId}`, headers: authHeader(token) });
      const data = res.json().data;
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(data.status)) return data;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`İş ${jobId} zaman aşımına uğradı (terminal duruma ulaşmadı).`);
  }

  describe("RBAC", () => {
    it("kimliği doğrulanmamış istek 401 döner", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/import/jobs" });
      expect(res.statusCode).toBe(401);
    });

    it("ADMIN olmayan (EDITOR) kullanıcı listeleme ve yükleme uçlarına erişemez (403)", async () => {
      const list = await app.inject({ method: "GET", url: "/api/v1/admin/import/jobs", headers: authHeader(editorToken) });
      expect(list.statusCode).toBe(403);
      expect(list.json().error.code).toBe("FORBIDDEN");

      const { body, contentType } = buildMultipartPayload({
        fields: { type: "PAGES" },
        file: { filename: "pages.csv", contentType: "text/csv", content: Buffer.from("title\nHello\n") },
      });
      const upload = await app.inject({
        method: "POST",
        url: "/api/v1/admin/import/jobs",
        headers: { ...authHeader(editorToken), "content-type": contentType },
        payload: body,
      });
      expect(upload.statusCode).toBe(403);
    });
  });

  describe("PAGES CSV — happy path (upload → preview → start → poll → DB kaydı)", () => {
    it("dosyayı yükler, önizleme üretir ve HİÇBİR kayıt YAZMAZ", async () => {
      const csv = "title,slug,status,contentHtml\nMerhaba Dunya,,DRAFT,<p>Hi <script>alert(1)</script></p>\n";
      const { body, contentType } = buildMultipartPayload({
        fields: { type: "PAGES" },
        file: { filename: "pages.csv", contentType: "text/csv", content: Buffer.from(csv) },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/import/jobs",
        headers: { ...authHeader(adminToken), "content-type": contentType },
        payload: body,
      });

      expect(res.statusCode).toBe(201);
      const job = res.json().data;
      expect(job.status).toBe("PENDING");
      expect(job.format).toBe("CSV");
      expect(job.type).toBe("PAGES");
      expect(job.totalCount).toBe(1);
      expect(job.preview.canStart).toBe(true);
      expect(job.preview.fields.some((f: { targetField: string | null }) => f.targetField === "title")).toBe(true);
      // API asla `storagePath` döndürmemeli (bkz. ARCHITECTURE.md §10.8.2).
      expect(job).not.toHaveProperty("storagePath");

      const pageCountBefore = await app.prisma.page.count();
      expect(pageCountBefore).toBe(0);

      // 2. ADIM — onayla ve başlat.
      const start = await app.inject({
        method: "POST",
        url: `/api/v1/admin/import/jobs/${job.id}/start`,
        headers: authHeader(adminToken),
        payload: {},
      });
      expect(start.statusCode).toBe(202);
      expect(start.json().data.status).toBe("QUEUED");

      const finished = await pollJobUntilTerminal(job.id, adminToken);
      expect(finished.status).toBe("COMPLETED");
      expect(finished.successCount).toBe(1);
      expect(finished.errorCount).toBe(0);
      expect(finished.processedCount).toBe(1);

      const page = await app.prisma.page.findFirst({ where: { slug: "merhaba-dunya" } });
      expect(page).not.toBeNull();
      expect(page!.status).toBe("DRAFT");
      // HTML sanitize edilmiş olmalı — <script> DB'ye YAZILMAMALI (bkz. ARCHITECTURE.md §10.8.4).
      const html = JSON.stringify(page!.blocks);
      expect(html).not.toContain("script");
      expect(html).toContain("Hi");
    });

    it("çift tıklama koruması: PENDING olmayan bir işi tekrar başlatmak 409 döner", async () => {
      const csv = "title\nTekil Sayfa\n";
      const { body, contentType } = buildMultipartPayload({
        fields: { type: "PAGES" },
        file: { filename: "p2.csv", contentType: "text/csv", content: Buffer.from(csv) },
      });
      const upload = await app.inject({
        method: "POST",
        url: "/api/v1/admin/import/jobs",
        headers: { ...authHeader(adminToken), "content-type": contentType },
        payload: body,
      });
      const jobId = upload.json().data.id;

      const first = await app.inject({ method: "POST", url: `/api/v1/admin/import/jobs/${jobId}/start`, headers: authHeader(adminToken), payload: {} });
      expect(first.statusCode).toBe(202);

      const second = await app.inject({ method: "POST", url: `/api/v1/admin/import/jobs/${jobId}/start`, headers: authHeader(adminToken), payload: {} });
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe("CONFLICT");

      await pollJobUntilTerminal(jobId, adminToken);
    });

    it("`type` alanı dosyadan SONRA gönderilse bile doğru işlenir (alan sırası bağımsızlığı)", async () => {
      const csv = "title\nSira Testi\n";
      const { body, contentType } = buildMultipartPayload({
        fields: { type: "PAGES" },
        file: { filename: "order.csv", contentType: "text/csv", content: Buffer.from(csv) },
        fileFirst: true,
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/import/jobs",
        headers: { ...authHeader(adminToken), "content-type": contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.type).toBe("PAGES");
    });
  });

  describe("Satır hataları — GET /:jobId/errors", () => {
    it("başlığı eksik bir satır REQUIRED_FIELD_MISSING olarak raporlanır, kayıt YAZILMAZ", async () => {
      const csv = "title,status\n,DRAFT\nGecerli Baslik,DRAFT\n";
      const { body, contentType } = buildMultipartPayload({
        fields: { type: "PAGES" },
        file: { filename: "errors.csv", contentType: "text/csv", content: Buffer.from(csv) },
      });
      const upload = await app.inject({
        method: "POST",
        url: "/api/v1/admin/import/jobs",
        headers: { ...authHeader(adminToken), "content-type": contentType },
        payload: body,
      });
      const jobId = upload.json().data.id;

      await app.inject({ method: "POST", url: `/api/v1/admin/import/jobs/${jobId}/start`, headers: authHeader(adminToken), payload: {} });
      const finished = await pollJobUntilTerminal(jobId, adminToken);
      expect(finished.status).toBe("COMPLETED");
      expect(finished.successCount).toBe(1);
      expect(finished.errorCount).toBe(1);

      const errors = await app.inject({ method: "GET", url: `/api/v1/admin/import/jobs/${jobId}/errors`, headers: authHeader(adminToken) });
      expect(errors.statusCode).toBe(200);
      const rows = errors.json().data;
      expect(rows).toHaveLength(1);
      expect(rows[0].code).toBe("REQUIRED_FIELD_MISSING");
      expect(rows[0].severity).toBe("error");
      expect(errors.json().meta.truncated).toBe(false);
    });
  });

  describe("USERS — overwrite/createNew yasak (yetki yükseltme koruması)", () => {
    it("USERS içe aktarımında duplicateStrategy: overwrite → 422 (iş başlatılamaz)", async () => {
      const csv = "name,email,role\nYeni Kullanici,new-user@example.com,EDITOR\n";
      const { body, contentType } = buildMultipartPayload({
        fields: { type: "USERS" },
        file: { filename: "users.csv", contentType: "text/csv", content: Buffer.from(csv) },
      });
      const upload = await app.inject({
        method: "POST",
        url: "/api/v1/admin/import/jobs",
        headers: { ...authHeader(adminToken), "content-type": contentType },
        payload: body,
      });
      expect(upload.statusCode).toBe(201);
      const jobId = upload.json().data.id;

      const start = await app.inject({
        method: "POST",
        url: `/api/v1/admin/import/jobs/${jobId}/start`,
        headers: authHeader(adminToken),
        payload: { duplicateStrategy: "overwrite" },
      });
      expect(start.statusCode).toBe(422);
    });
  });

  describe("İptal ve silme", () => {
    it("PENDING bir iş anında CANCELLED olur ve kaynak dosyası silinir", async () => {
      const csv = "title\nIptal Edilecek\n";
      const { body, contentType } = buildMultipartPayload({
        fields: { type: "PAGES" },
        file: { filename: "cancel.csv", contentType: "text/csv", content: Buffer.from(csv) },
      });
      const upload = await app.inject({
        method: "POST",
        url: "/api/v1/admin/import/jobs",
        headers: { ...authHeader(adminToken), "content-type": contentType },
        payload: body,
      });
      const jobId = upload.json().data.id;

      const cancel = await app.inject({ method: "POST", url: `/api/v1/admin/import/jobs/${jobId}/cancel`, headers: authHeader(adminToken) });
      expect(cancel.statusCode).toBe(200);
      expect(cancel.json().data.status).toBe("CANCELLED");

      const again = await app.inject({ method: "POST", url: `/api/v1/admin/import/jobs/${jobId}/cancel`, headers: authHeader(adminToken) });
      expect(again.statusCode).toBe(409);
    });

    it("bir iş silinebilir ve tekrar GET edildiğinde 404 döner", async () => {
      const csv = "title\nSilinecek\n";
      const { body, contentType } = buildMultipartPayload({
        fields: { type: "PAGES" },
        file: { filename: "delete.csv", contentType: "text/csv", content: Buffer.from(csv) },
      });
      const upload = await app.inject({
        method: "POST",
        url: "/api/v1/admin/import/jobs",
        headers: { ...authHeader(adminToken), "content-type": contentType },
        payload: body,
      });
      const jobId = upload.json().data.id;

      const del = await app.inject({ method: "DELETE", url: `/api/v1/admin/import/jobs/${jobId}`, headers: authHeader(adminToken) });
      expect(del.statusCode).toBe(204);

      const get = await app.inject({ method: "GET", url: `/api/v1/admin/import/jobs/${jobId}`, headers: authHeader(adminToken) });
      expect(get.statusCode).toBe(404);
    });
  });

  describe("Güvenlik — XXE/DTD savunması", () => {
    it("DOCTYPE/ENTITY içeren bir WXR dosyası 422 ile reddedilir, iş OLUŞTURULMAZ", async () => {
      const maliciousXml = [
        '<?xml version="1.0"?>',
        "<!DOCTYPE lolz [",
        ' <!ENTITY lol "lol">',
        ' <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">',
        "]>",
        "<rss><channel><lolz>&lol2;</lolz></channel></rss>",
      ].join("\n");

      const { body, contentType } = buildMultipartPayload({
        fields: { type: "WORDPRESS" },
        file: { filename: "evil.xml", contentType: "application/xml", content: Buffer.from(maliciousXml) },
      });

      const jobCountBefore = await app.prisma.importJob.count();

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/import/jobs",
        headers: { ...authHeader(adminToken), "content-type": contentType },
        payload: body,
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.message).toMatch(/DTD|varlık/i);

      const jobCountAfter = await app.prisma.importJob.count();
      expect(jobCountAfter).toBe(jobCountBefore);
    });

    it("gerçek bir WXR dosyası kabul edilir ve sayfa/yazı üretir; excerpt:encoded de content:encoded İLE AYNI şekilde sanitize edilir", async () => {
      const wxr = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:wp="http://wordpress.org/export/1.2/"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Test</title>
  <item>
    <title>Ilk Yazi</title>
    <content:encoded><![CDATA[<p>Merhaba <script>alert(1)</script></p>]]></content:encoded>
    <excerpt:encoded><![CDATA[<p>Ozet <script>alert(2)</script></p>]]></excerpt:encoded>
    <wp:post_id>1</wp:post_id>
    <wp:status>publish</wp:status>
    <wp:post_type>post</wp:post_type>
    <wp:post_name>ilk-yazi</wp:post_name>
  </item>
</channel></rss>`;

      const { body, contentType } = buildMultipartPayload({
        fields: { type: "WORDPRESS" },
        file: { filename: "site.wordpress.xml", contentType: "application/xml", content: Buffer.from(wxr) },
      });

      const upload = await app.inject({
        method: "POST",
        url: "/api/v1/admin/import/jobs",
        headers: { ...authHeader(adminToken), "content-type": contentType },
        payload: body,
      });
      expect(upload.statusCode).toBe(201);
      expect(upload.json().data.format).toBe("XML");
      expect(upload.json().data.preview.breakdown.posts).toBe(1);

      const jobId = upload.json().data.id;
      await app.inject({ method: "POST", url: `/api/v1/admin/import/jobs/${jobId}/start`, headers: authHeader(adminToken), payload: {} });
      const finished = await pollJobUntilTerminal(jobId, adminToken);
      expect(finished.status).toBe("COMPLETED");
      expect(finished.successCount).toBe(1);

      const post = await app.prisma.blogPost.findFirst({ where: { slug: "ilk-yazi" } });
      expect(post).not.toBeNull();
      expect(post!.contentHtml).not.toContain("script");
      // security-agent bulgusu (Konu 2 denetimi) — `excerpt:encoded` de sanitize edilmeli
      // (ARCHITECTURE.md §10.8.4: "İçe aktarılan HER HTML alanı ... sanitize edilir").
      expect(post!.excerpt).not.toContain("script");
      expect(post!.excerpt).toContain("Ozet");
    });
  });

  describe("PRODUCTS (WooCommerce) — §10.8.9", () => {
    // Ayrı `app`/ADMIN örneği — bu blok tek başına 10'dan fazla `POST /admin/import/jobs`
    // çağrısı yapar ve route-level rate limiti "10 istek / 10 dakika"tır (bkz.
    // import.routes.ts::IMPORT_UPLOAD_RATE_LIMIT) — "Boyut limitleri"/"Yarış durumu"
    // bloklarındaki AYNI izolasyon gerekçesi.
    // İKİ AYRI `app` örneği kullanılır: bu blok toplamda 10'un ÜZERİNDE `POST /admin/import/jobs`
    // çağrısı yapar (rate limit "10 istek / 10 dakika"tır, bkz. import.routes.ts::
    // IMPORT_UPLOAD_RATE_LIMIT), tek bir örnek yetmez — `productsApp2` yalnızca son birkaç testte
    // kullanılır.
    let productsApp: FastifyInstance;
    let productsAdminToken: string;
    let productsApp2: FastifyInstance;
    let productsAdminToken2: string;

    beforeAll(async () => {
      productsApp = await buildTestApp();
      const admin = await registerTestUser(productsApp, { email: "import-products-admin@example.com" });
      await productsApp.prisma.user.update({ where: { id: admin.userId }, data: { role: "ADMIN" } });
      productsAdminToken = admin.accessToken;

      productsApp2 = await buildTestApp();
      const admin2 = await registerTestUser(productsApp2, { email: "import-products-admin-2@example.com" });
      await productsApp2.prisma.user.update({ where: { id: admin2.userId }, data: { role: "ADMIN" } });
      productsAdminToken2 = admin2.accessToken;
    });

    afterAll(async () => {
      await productsApp.close();
      await productsApp2.close();
    });

    function wcWxr(items: string): string {
      return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:wp="http://wordpress.org/export/1.2/"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Test WooCommerce Site</title>
  ${items}
</channel></rss>`;
    }

    function meta(key: string, value: string): string {
      return `<wp:postmeta><wp:meta_key><![CDATA[${key}]]></wp:meta_key><wp:meta_value><![CDATA[${value}]]></wp:meta_value></wp:postmeta>`;
    }

    function productItem(opts: {
      title: string;
      postId: string;
      sku?: string;
      regularPrice?: string;
      salePrice?: string;
      category?: string;
      extraMeta?: string;
      status?: string;
    }): string {
      const { title, postId, sku, regularPrice, salePrice, category = "", extraMeta = "", status = "publish" } = opts;
      const metas = [
        sku !== undefined ? meta("_sku", sku) : "",
        regularPrice !== undefined ? meta("_regular_price", regularPrice) : "",
        salePrice !== undefined ? meta("_sale_price", salePrice) : "",
        extraMeta,
      ].join("");
      return `
      <item>
        <title>${title}</title>
        <content:encoded><![CDATA[<p>Ürün açıklaması</p>]]></content:encoded>
        <wp:post_id>${postId}</wp:post_id>
        <wp:status>${status}</wp:status>
        <wp:post_type>product</wp:post_type>
        <wp:post_name>${title.toLowerCase().replace(/\s+/g, "-")}</wp:post_name>
        ${category}
        ${metas}
      </item>`;
    }

    async function pollProductsJobUntilTerminal(
      jobId: string,
      timeoutMs = 15000,
      useApp = productsApp,
      useToken = productsAdminToken
    ): Promise<Record<string, unknown>> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const res = await useApp.inject({
          method: "GET",
          url: `/api/v1/admin/import/jobs/${jobId}`,
          headers: authHeader(useToken),
        });
        const data = res.json().data;
        if (["COMPLETED", "FAILED", "CANCELLED"].includes(data.status)) return data;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`İş ${jobId} zaman aşımına uğradı (terminal duruma ulaşmadı).`);
    }

    async function uploadAndStart(
      xml: string,
      body: Record<string, unknown> = {},
      useApp = productsApp,
      useToken = productsAdminToken
    ): Promise<{ upload: { statusCode: number; json: () => any }; jobId: string | null }> {
      const { body: payload, contentType } = buildMultipartPayload({
        fields: { type: "PRODUCTS" },
        file: { filename: "woo-export.xml", contentType: "application/xml", content: Buffer.from(xml) },
      });
      const upload = await useApp.inject({
        method: "POST",
        url: "/api/v1/admin/import/jobs",
        headers: { ...authHeader(useToken), "content-type": contentType },
        payload,
      });
      if (upload.statusCode !== 201) return { upload, jobId: null };
      const jobId = upload.json().data.id;
      await useApp.inject({
        method: "POST",
        url: `/api/v1/admin/import/jobs/${jobId}/start`,
        headers: authHeader(useToken),
        payload: body,
      });
      return { upload, jobId };
    }

    it("DTD/ENTITY içeren bir dosya PRODUCTS tipinde de 422 ile reddedilir, iş OLUŞTURULMAZ", async () => {
      const maliciousXml = [
        '<?xml version="1.0"?>',
        "<!DOCTYPE lolz [",
        ' <!ENTITY lol "lol">',
        ' <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">',
        "]>",
        "<rss><channel><lolz>&lol2;</lolz></channel></rss>",
      ].join("\n");

      const { body, contentType } = buildMultipartPayload({
        fields: { type: "PRODUCTS" },
        file: { filename: "evil-products.xml", contentType: "application/xml", content: Buffer.from(maliciousXml) },
      });

      const jobCountBefore = await productsApp.prisma.importJob.count();
      const res = await productsApp.inject({
        method: "POST",
        url: "/api/v1/admin/import/jobs",
        headers: { ...authHeader(productsAdminToken), "content-type": contentType },
        payload: body,
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.message).toMatch(/DTD|varlık/i);
      expect(await productsApp.prisma.importJob.count()).toBe(jobCountBefore);
    });

    it("ürünler modülü kapalıyken type: PRODUCTS ile yükleme 422 döner", async () => {
      const disable = await productsApp.inject({
        method: "PATCH",
        url: "/api/v1/admin/modules/products",
        headers: authHeader(productsAdminToken),
        payload: { enabled: false },
      });
      expect(disable.statusCode).toBe(200);

      try {
        const xml = wcWxr(productItem({ title: "Kapalı Modül Ürünü", postId: "1", regularPrice: "10.00" }));
        const { body, contentType } = buildMultipartPayload({
          fields: { type: "PRODUCTS" },
          file: { filename: "woo.xml", contentType: "application/xml", content: Buffer.from(xml) },
        });
        const res = await productsApp.inject({
          method: "POST",
          url: "/api/v1/admin/import/jobs",
          headers: { ...authHeader(productsAdminToken), "content-type": contentType },
          payload: body,
        });
        expect(res.statusCode).toBe(422);
      } finally {
        await productsApp.inject({
          method: "PATCH",
          url: "/api/v1/admin/modules/products",
          headers: authHeader(productsAdminToken),
          payload: { enabled: true },
        });
      }
    });

    it("uçtan uca: ürün/varyasyon/sipariş karışık bir WXR — yalnızca ürünler yazılır, breakdown+uyarılar doğru, sipariş PII'si rawData'ya YAZILMAZ", async () => {
      const orderItem = `
      <item>
        <title>Order #999</title>
        <wp:post_id>500</wp:post_id>
        <wp:status>wc-completed</wp:status>
        <wp:post_type>shop_order</wp:post_type>
        ${meta("_billing_email", "gizli-musteri@example.com")}
        ${meta("_billing_first_name", "GizliAd")}
        ${meta("_billing_last_name", "GizliSoyad")}
        ${meta("_payment_method", "stripe")}
        ${meta("_billing_phone", "5551234567")}
      </item>`;
      const variationItem = `
      <item>
        <title>Varyasyon Ürünü - Kırmızı</title>
        <wp:post_id>501</wp:post_id>
        <wp:status>publish</wp:status>
        <wp:post_type>product_variation</wp:post_type>
        ${meta("_regular_price", "50.00")}
      </item>`;
      const product1 = productItem({
        title: "Widget A",
        postId: "1",
        sku: "WID-A",
        regularPrice: "199.90",
        category: `<category domain="product_cat" nicename="widgets"><![CDATA[Widgets]]></category>`,
      });
      const product2 = productItem({
        title: "Widget B",
        postId: "2",
        sku: "WID-B",
        regularPrice: "100.00",
        salePrice: "150.00", // >= regularPrice -> indirim yok sayılır + INVALID_VALUE satırı
      });

      const xml = wcWxr(orderItem + variationItem + product1 + product2);

      const { body: uploadBody, contentType } = buildMultipartPayload({
        fields: { type: "PRODUCTS" },
        file: { filename: "woo-mixed.xml", contentType: "application/xml", content: Buffer.from(xml) },
      });
      const upload = await productsApp.inject({
        method: "POST",
        url: "/api/v1/admin/import/jobs",
        headers: { ...authHeader(productsAdminToken), "content-type": contentType },
        payload: uploadBody,
      });
      expect(upload.statusCode).toBe(201);
      const preview = upload.json().data.preview;
      expect(preview.totalCount).toBe(2);
      expect(preview.breakdown.products).toBe(2);

      const warningCodes = preview.warnings.map((w: { code: string }) => w.code);
      expect(warningCodes).toContain("WC_ORDERS_IGNORED");
      expect(warningCodes).toContain("WC_VARIATIONS_UNSUPPORTED");
      expect(warningCodes).toContain("WC_TAX_NOT_IMPORTED");

      const jobId = upload.json().data.id;
      const start = await productsApp.inject({
        method: "POST",
        url: `/api/v1/admin/import/jobs/${jobId}/start`,
        headers: authHeader(productsAdminToken),
        payload: { duplicateStrategy: "skip", defaultCurrency: "USD" },
      });
      expect(start.statusCode).toBe(202);

      const finished = await pollProductsJobUntilTerminal(jobId);
      expect(finished.status).toBe("COMPLETED");
      expect(finished.successCount).toBe(2);
      // Widget B'nin indirim satırı için 1 hata satırı (INVALID_VALUE) BEKLENİR ama satır yine
      // BAŞARILI sayılır (kayıt yazılır) — bkz. import.worker.ts::runProductsJob yorum notu.
      expect(finished.errorCount).toBe(1);

      const widgetA = await productsApp.prisma.product.findFirst({ where: { sku: "WID-A" } });
      expect(widgetA).not.toBeNull();
      expect(widgetA!.priceCents).toBe(19990);
      expect(widgetA!.currency).toBe("USD");
      expect(widgetA!.status).toBe("DRAFT"); // defaultStatus varsayılanı DRAFT
      expect(widgetA!.taxRatePercent).toBeNull();
      expect(widgetA!.coverMediaId).toBeNull();
      const widgetACategory = await productsApp.prisma.productCategory.findUnique({ where: { id: widgetA!.categoryId! } });
      expect(widgetACategory?.slug).toBe("widgets");

      const widgetB = await productsApp.prisma.product.findFirst({ where: { sku: "WID-B" } });
      expect(widgetB).not.toBeNull();
      expect(widgetB!.priceCents).toBe(10000);
      expect(widgetB!.discountPriceCents).toBeNull(); // sale >= regular -> düşürüldü

      // §10.8.9.1 compliance regresyon testi — shop_order PII'si HİÇBİR ImportJobError satırına
      // (rawData/sourceRef/message) SIZMAMALI. Sipariş item'ı parser'da tamamen düşürüldüğü için
      // (breakdown.skipped'a yansır) ilişkili bir hata/atlama satırı da OLUŞMAMALIDIR.
      const errorsRes = await productsApp.inject({
        method: "GET",
        url: `/api/v1/admin/import/jobs/${jobId}/errors`,
        headers: authHeader(productsAdminToken),
      });
      expect(errorsRes.statusCode).toBe(200);
      const errorRows: Array<{ rawData: unknown; sourceRef: string | null; message: string }> = errorsRes.json().data;
      for (const row of errorRows) {
        expect(JSON.stringify(row.rawData ?? "")).not.toMatch(/gizli-musteri@example\.com|GizliAd|GizliSoyad|stripe|5551234567/);
        expect(row.sourceRef ?? "").not.toMatch(/gizli-musteri@example\.com/);
        expect(row.message).not.toMatch(/gizli-musteri@example\.com|GizliAd|GizliSoyad/);
      }
      // Sipariş item'ı için AYRICA bir satır oluşmadığını (yalnızca Widget B'nin indirim satırı
      // var olduğunu) doğrula.
      expect(errorRows).toHaveLength(1);
      expect(errorRows[0]!.message).toMatch(/indirim|sale/i);

      const productCountAfter = await productsApp.prisma.product.count();
      expect(productCountAfter).toBe(2); // sipariş/varyasyon KESİNLİKLE Product olarak yazılmadı
    });

    it("duplicateStrategy: overwrite — SKU eşleşen ürün güncellenir, ContentRevision snapshot'ı yazılır", async () => {
      const initialXml = wcWxr(productItem({ title: "Overwrite Ürün", postId: "10", sku: "OVR-1", regularPrice: "50.00" }));
      const first = await uploadAndStart(initialXml, { duplicateStrategy: "skip" });
      expect(first.upload.statusCode).toBe(201);
      await pollProductsJobUntilTerminal(first.jobId!);

      const before = await productsApp.prisma.product.findFirst({ where: { sku: "OVR-1" } });
      expect(before).not.toBeNull();
      expect(before!.priceCents).toBe(5000);

      const updatedXml = wcWxr(productItem({ title: "Overwrite Ürün Güncel", postId: "10", sku: "OVR-1", regularPrice: "75.00" }));
      const second = await uploadAndStart(updatedXml, { duplicateStrategy: "overwrite" });
      expect(second.upload.statusCode).toBe(201);
      const finished = await pollProductsJobUntilTerminal(second.jobId!);
      expect(finished.status).toBe("COMPLETED");
      expect(finished.successCount).toBe(1);

      const after = await productsApp.prisma.product.findUnique({ where: { id: before!.id } });
      expect(after!.title).toBe("Overwrite Ürün Güncel");
      expect(after!.priceCents).toBe(7500);
      expect(after!.slug).toBe(before!.slug); // slug DEĞİŞMEZ (overwrite normal PATCH gibi davranır)

      const revision = await productsApp.prisma.contentRevision.findFirst({ where: { entityType: "PRODUCT", entityId: before!.id } });
      expect(revision).not.toBeNull();
    });

    it("duplicateStrategy: createNew + SKU çakışması → satır ATLANIR (DUPLICATE_SKIPPED), '-2' SKU UYDURULMAZ", async () => {
      const initialXml = wcWxr(productItem({ title: "CreateNew SKU Ürün", postId: "20", sku: "CN-SKU-1", regularPrice: "30.00" }));
      const first = await uploadAndStart(initialXml, { duplicateStrategy: "skip" });
      await pollProductsJobUntilTerminal(first.jobId!);
      const countAfterFirst = await productsApp.prisma.product.count({ where: { sku: "CN-SKU-1" } });
      expect(countAfterFirst).toBe(1);

      const dupXml = wcWxr(productItem({ title: "CreateNew SKU Ürün Kopya", postId: "21", sku: "CN-SKU-1", regularPrice: "35.00" }));
      const second = await uploadAndStart(dupXml, { duplicateStrategy: "createNew" });
      const finished = await pollProductsJobUntilTerminal(second.jobId!);
      expect(finished.status).toBe("COMPLETED");
      expect(finished.skippedCount).toBe(1);
      expect(finished.successCount).toBe(0);

      const skuCount = await productsApp.prisma.product.count({ where: { sku: "CN-SKU-1" } });
      expect(skuCount).toBe(1); // ikinci kayıt YAZILMADI
    });

    it("SKU'suz ürünlerde createNew slug çakışmasını '-2' ile çözer (SKU olmadığından serbestçe çoğaltılır)", async () => {
      const initialXml = wcWxr(productItem({ title: "SKUsuz Urun", postId: "30", regularPrice: "40.00" }));
      const first = await uploadAndStart(initialXml, { duplicateStrategy: "skip" });
      await pollProductsJobUntilTerminal(first.jobId!);

      const dupXml = wcWxr(productItem({ title: "SKUsuz Urun", postId: "31", regularPrice: "45.00" }));
      const second = await uploadAndStart(dupXml, { duplicateStrategy: "createNew" });
      const finished = await pollProductsJobUntilTerminal(second.jobId!);
      expect(finished.status).toBe("COMPLETED");
      expect(finished.successCount).toBe(1);

      const products = await productsApp.prisma.product.findMany({ where: { title: "SKUsuz Urun" }, orderBy: { seq: "asc" } });
      expect(products).toHaveLength(2);
      expect(products[1]!.slug).toBe(`${products[0]!.slug}-2`);
    });

    it("eksik/geçersiz fiyat → satır yazılmaz (REQUIRED_FIELD_MISSING / INVALID_VALUE)", async () => {
      const missingPrice = productItem({ title: "Fiyatsiz Urun", postId: "40" }); // regularPrice YOK
      const invalidPrice = productItem({ title: "Bozuk Fiyat Urun", postId: "41", regularPrice: "abc" });
      const zeroPrice = productItem({ title: "Sifir Fiyat Urun", postId: "42", regularPrice: "0" });

      const xml = wcWxr(missingPrice + invalidPrice + zeroPrice);
      const { upload, jobId } = await uploadAndStart(xml, { duplicateStrategy: "skip" });
      expect(upload.statusCode).toBe(201);
      const finished = await pollProductsJobUntilTerminal(jobId!);
      expect(finished.status).toBe("COMPLETED");
      expect(finished.successCount).toBe(0);
      expect(finished.errorCount).toBe(3);

      const count = await productsApp.prisma.product.count({
        where: { title: { in: ["Fiyatsiz Urun", "Bozuk Fiyat Urun", "Sifir Fiyat Urun"] } },
      });
      expect(count).toBe(0);
    });

    it("defaultStatus: PUBLISHED tavanı — yalnızca kaynakta wp:status=publish olan ürünler yayınlanır, diğerleri DRAFT kalır", async () => {
      const published = productItem({ title: "Yayindaki Urun", postId: "50", regularPrice: "10.00", status: "publish" });
      const draft = productItem({ title: "Taslak Urun", postId: "51", regularPrice: "10.00", status: "draft" });

      const xml = wcWxr(published + draft);
      const { jobId } = await uploadAndStart(xml, { duplicateStrategy: "skip", defaultStatus: "PUBLISHED" }, productsApp2, productsAdminToken2);
      const finished = await pollProductsJobUntilTerminal(jobId!, 15000, productsApp2, productsAdminToken2);
      expect(finished.status).toBe("COMPLETED");
      expect(finished.successCount).toBe(2);

      const pub = await productsApp2.prisma.product.findFirst({ where: { title: "Yayindaki Urun" } });
      const drf = await productsApp2.prisma.product.findFirst({ where: { title: "Taslak Urun" } });
      expect(pub!.status).toBe("PUBLISHED");
      expect(pub!.publishedAt).not.toBeNull();
      expect(drf!.status).toBe("DRAFT");
    });

    it("geçersiz defaultCurrency 422 döner", async () => {
      const xml = wcWxr(productItem({ title: "Para Birimi Testi", postId: "60", regularPrice: "10.00" }));
      const { body, contentType } = buildMultipartPayload({
        fields: { type: "PRODUCTS" },
        file: { filename: "currency.xml", contentType: "application/xml", content: Buffer.from(xml) },
      });
      const upload = await productsApp2.inject({
        method: "POST",
        url: "/api/v1/admin/import/jobs",
        headers: { ...authHeader(productsAdminToken2), "content-type": contentType },
        payload: body,
      });
      expect(upload.statusCode).toBe(201);
      const jobId = upload.json().data.id;

      const start = await productsApp2.inject({
        method: "POST",
        url: `/api/v1/admin/import/jobs/${jobId}/start`,
        headers: authHeader(productsAdminToken2),
        payload: { defaultCurrency: "XXX-not-real" },
      });
      expect(start.statusCode).toBe(422);
    });

    it("excerpt:encoded de content:encoded İLE AYNI şekilde sanitize edilir (security-agent bulgusu, Konu 2 denetimi)", async () => {
      const item = `
      <item>
        <title>Excerpt Sanitize Testi</title>
        <content:encoded><![CDATA[<p>Aciklama <script>alert(1)</script></p>]]></content:encoded>
        <excerpt:encoded><![CDATA[<p>Ozet <script>alert(2)</script></p>]]></excerpt:encoded>
        <wp:post_id>70</wp:post_id>
        <wp:status>publish</wp:status>
        <wp:post_type>product</wp:post_type>
        <wp:post_name>excerpt-sanitize-testi</wp:post_name>
        ${meta("_regular_price", "10.00")}
      </item>`;
      const xml = wcWxr(item);

      const { jobId } = await uploadAndStart(xml, { duplicateStrategy: "skip" }, productsApp2, productsAdminToken2);
      const finished = await pollProductsJobUntilTerminal(jobId!, 15000, productsApp2, productsAdminToken2);
      expect(finished.status).toBe("COMPLETED");
      expect(finished.successCount).toBe(1);

      const product = await productsApp2.prisma.product.findFirst({ where: { slug: "excerpt-sanitize-testi" } });
      expect(product).not.toBeNull();
      expect(product!.descriptionHtml).not.toContain("script");
      expect(product!.excerpt).not.toContain("script");
      expect(product!.excerpt).toContain("Ozet");
    });
  });

  describe("Boyut limitleri — 413 (regresyon: eskiden yanlışlıkla 422 dönüyordu)", () => {
    // Bu blok KENDİ `app` örneğini kurar: `POST /admin/import/jobs` route-level rate limiti
    // "10 istek / 10 dakika"tır (bkz. import.routes.ts::IMPORT_UPLOAD_RATE_LIMIT) ve bu dosyadaki
    // ÜST describe'lar zaten paylaşılan `app`/rate-limit deposunun bütçesini tüketmiş olabilir —
    // `@fastify/rate-limit`'in bellek-içi sayaç deposu her Fastify örneğine ÖZELDİR, bu yüzden
    // taze bir `buildTestApp()` bu testi diğerlerinden izole eder (429 ile yanlışlıkla karışmasın).
    let sizeLimitApp: FastifyInstance;
    let sizeLimitAdminToken: string;

    beforeAll(async () => {
      sizeLimitApp = await buildTestApp();
      // NOT: bu, `saas_test` veritabanını paylaşan İKİNCİ bir `app` örneği — DB zaten üst
      // describe'un ADMIN'ini içerdiğinden ("ilk kullanıcı otomatik ADMIN" kuralı burada
      // GEÇERLİ DEĞİL), rolü elle ADMIN'e yükseltiyoruz (JWT'ye rol GÖMÜLMEZ, bkz.
      // middleware/authenticate.ts — her istekte DB'den taze okunur, token'ı yenilemeye gerek yok).
      const admin = await registerTestUser(sizeLimitApp, { email: "import-size-admin@example.com" });
      await sizeLimitApp.prisma.user.update({ where: { id: admin.userId }, data: { role: "ADMIN" } });
      sizeLimitAdminToken = admin.accessToken;
    });

    afterAll(async () => {
      await sizeLimitApp.close();
    });

    it("multipart üst tavanını (100 MB, MEDIA) aşan bir dosya 413 PAYLOAD_TOO_LARGE döner, 422 DEĞİL", async () => {
      // `@fastify/multipart`'ın KENDİ `fileSize` limiti (route'ta MAX_IMPORT_FILE_BYTES = 100
      // MB olarak ayarlanır, bkz. import.routes.ts) — `throwFileSizeLimit` varsayılanı `true`
      // olduğundan, `for await (const chunk of part.file)` döngüsü limit aşılır aşılmaz
      // `FST_REQ_FILE_TOO_LARGE` ile fırlar (route'un kendi `buffer.byteLength` kontrolüne HİÇ
      // ulaşılmaz) — bu yüzden davranış `plugins/error-handler.ts`'teki GENEL handler'a bağlıdır.
      const oversized = Buffer.alloc(101 * 1024 * 1024, 1);
      const { body, contentType } = buildMultipartPayload({
        fields: { type: "MEDIA" },
        file: { filename: "huge.zip", contentType: "application/zip", content: oversized },
      });

      const jobCountBefore = await sizeLimitApp.prisma.importJob.count();

      const res = await sizeLimitApp.inject({
        method: "POST",
        url: "/api/v1/admin/import/jobs",
        headers: { ...authHeader(sizeLimitAdminToken), "content-type": contentType },
        payload: body,
      });

      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe("PAYLOAD_TOO_LARGE");
      // Regresyon: mesaj limitten BAĞIMSIZ olmalı — eski "En fazla 5MB yükleyebilirsiniz."
      // metni bu route için (100 MB ceiling) YANLIŞ ve kafa karıştırıcıydı.
      expect(res.json().error.message).not.toMatch(/5\s*MB/i);

      const jobCountAfter = await sizeLimitApp.prisma.importJob.count();
      expect(jobCountAfter).toBe(jobCountBefore);
    }, 30000);
  });

  describe("Yarış durumu — cancel() vs. worker'ın QUEUED→PROCESSING claim'i (regresyon, qa-agent bulgusu)", () => {
    // Ayrı `app` örneği: hem rate-limit izolasyonu (bkz. "Boyut limitleri" bloğundaki aynı
    // gerekçe) hem de bu testin zamanlamaya duyarlı doğası diğer testlerin eşzamanlı DB/worker
    // trafiğinden ETKİLENMESİN diye.
    let raceApp: FastifyInstance;
    let raceAdminToken: string;

    beforeAll(async () => {
      raceApp = await buildTestApp();
      const admin = await registerTestUser(raceApp, { email: "import-race-admin@example.com" });
      await raceApp.prisma.user.update({ where: { id: admin.userId }, data: { role: "ADMIN" } });
      raceAdminToken = admin.accessToken;
    });

    afterAll(async () => {
      await raceApp.close();
    });

    it(
      "start() döndükten HEMEN SONRA (PROCESSING'i beklemeden) cancel() çağrılırsa sonuç HER ZAMAN tutarlıdır — CANCELLED/successCount:0 raporlayıp arka planda satır yazmaya devam eden 'hayalet' worker OLUŞMAZ",
      async () => {
        // Bug (düzeltmeden ÖNCE): `POST .../cancel` (PENDING/QUEUED → anında CANCELLED dalı) ile
        // `import.worker.ts::runImportJob`'un KENDİ `status: QUEUED → PROCESSING` geçişi arasında
        // atomic olmayan bir "oku-sonra-yaz" yarışı vardı. `start()` döndükten hemen ardından —
        // işin `PROCESSING`e geçtiğini POLL ETMEDEN — `cancel()` çağrıldığında, API `CANCELLED`
        // dönebiliyordu AMA worker arka planda `Page` satırları yazmaya DEVAM EDİYORDU (bkz. görev
        // tanımı: "successCount: 0 döndü ama 3-4 fazladan yazma gözlemlendi", bir çalıştırmada da
        // orphan worker'ın son update'i silinmiş satırı hedefleyip Prisma `P2025` ile çökmesi).
        //
        // Bu test kasıtlı olarak HANGİ TARAFIN kazandığını sabitlEMEZ (gerçek zamanlama, Postgres'e
        // giden gerçek round-trip'lerin göreli hızına bağlıdır, bu yüzden deterministik değildir) —
        // bunun yerine, düzeltmenin garanti ettiği İNVARYANT'ı doğrular: yarışı HANGİ taraf
        // kazanırsa kazansın, nihai sonuç HER ZAMAN tutarlıdır (raporlanan sayaçlar = DB'deki
        // gerçek satır sayısı, terminal durumdan SONRA hiçbir ek yazma OLMAZ).
        const rows = Array.from({ length: 20 }, (_, i) => `Race Page ${i},race-claim-${i}`).join("\n");
        const csv = `title,slug\n${rows}\n`;
        const { body, contentType } = buildMultipartPayload({
          fields: { type: "PAGES" },
          file: { filename: "race.csv", contentType: "text/csv", content: Buffer.from(csv) },
        });

        const upload = await raceApp.inject({
          method: "POST",
          url: "/api/v1/admin/import/jobs",
          headers: { ...authHeader(raceAdminToken), "content-type": contentType },
          payload: body,
        });
        expect(upload.statusCode).toBe(201);
        const jobId = upload.json().data.id;

        const start = await raceApp.inject({
          method: "POST",
          url: `/api/v1/admin/import/jobs/${jobId}/start`,
          headers: authHeader(raceAdminToken),
          payload: {},
        });
        expect(start.statusCode).toBe(202);
        expect(start.json().data.status).toBe("QUEUED");

        // KRİTİK: burada HİÇBİR bekleme/poll YOK — tam olarak qa-agent'ın bug'ı reprodükte ettiği
        // yol: `cancel()`, işin `PROCESSING`e geçtiği garanti edilmeden, `start()` döner dönmez
        // tetiklenir (worker'ın `setImmediate` ile zamanlanmış claim'iyle GERÇEKTEN yarışsın diye).
        const cancel = await raceApp.inject({
          method: "POST",
          url: `/api/v1/admin/import/jobs/${jobId}/cancel`,
          headers: authHeader(raceAdminToken),
        });
        expect([200, 409]).toContain(cancel.statusCode);

        // Terminal duruma ulaşana kadar bekle (hangi taraf kazanmış olursa olsun).
        const deadline = Date.now() + 15000;
        let finalData: { status: string; successCount: number } | undefined;
        while (Date.now() < deadline) {
          const res = await raceApp.inject({ method: "GET", url: `/api/v1/admin/import/jobs/${jobId}`, headers: authHeader(raceAdminToken) });
          const data = res.json().data;
          if (["COMPLETED", "FAILED", "CANCELLED"].includes(data.status)) {
            finalData = data;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        if (!finalData) throw new Error(`İş ${jobId} terminal duruma ulaşmadı (zaman aşımı).`);

        // TEMEL DÜZELTME DOĞRULAMASI: raporlanan `successCount`, DB'deki GERÇEK satır sayısıyla
        // BİREBİR eşleşmeli. Race'li (eski) davranışta bu ikisi UYUŞMUYORDU.
        const pageCountAtTerminal = await raceApp.prisma.page.count({ where: { slug: { startsWith: "race-claim-" } } });
        expect(pageCountAtTerminal).toBe(finalData.successCount);

        // "Hayalet worker" testi: terminal yanıttan SONRA biraz bekleyip satır sayısının artık
        // DEĞİŞMEDİĞİNİ doğrula — eski bug'da worker, client'a terminal durum döndükten SONRA da
        // arka planda satır yazmaya devam ediyordu.
        await new Promise((resolve) => setTimeout(resolve, 400));
        const pageCountAfterGrace = await raceApp.prisma.page.count({ where: { slug: { startsWith: "race-claim-" } } });
        expect(pageCountAfterGrace).toBe(pageCountAtTerminal);

        // Job satırının kendisi de artık değişmemeli (worker onu tekrar update ETMEYE ÇALIŞMADI/
        // edemedi — `updateMany` ile P2025 çökmesi de böylece dolaylı olarak doğrulanmış olur:
        // test burada bir exception FIRLAMADAN tamamlanabildiyse worker çökmemiştir).
        const stillFinal = await raceApp.inject({ method: "GET", url: `/api/v1/admin/import/jobs/${jobId}`, headers: authHeader(raceAdminToken) });
        expect(stillFinal.json().data.status).toBe(finalData.status);
        expect(stillFinal.json().data.successCount).toBe(finalData.successCount);

        // `cancel()` yanıtının KENDİSİ anında `CANCELLED` döndüyse (instant-cancel dalı kazandı) —
        // dokümante edilen invariant ("hiç kayıt yazılmamıştır") birebir doğrulanır: worker bu
        // job'ı HİÇ claim edemediği için `successCount` KESİNLİKLE 0 olmalıdır.
        if (cancel.statusCode === 200 && cancel.json().data.status === "CANCELLED") {
          expect(finalData.status).toBe("CANCELLED");
          expect(finalData.successCount).toBe(0);
          expect(pageCountAtTerminal).toBe(0);
        }
      },
      30000
    );
  });

  // ---------------------------------------------------------------------------------------
  // qa-agent — kapsam tamamlama (bkz. görev tanımı). KENDİ `app` örneğini kurar: yukarıdaki
  // describe'lar `POST /admin/import/jobs`'un "10 istek / 10 dakika" rate limitini (bkz.
  // "Boyut limitleri" bloğundaki aynı gerekçe) zaten tüketmiş olabilir.
  // ---------------------------------------------------------------------------------------
  describe("qa-agent — ek senaryolar (bozuk CSV, eksik zorunlu alan, kısmi başarı, iptal, RBAC tam kapsam)", () => {
    let qaApp: FastifyInstance;
    let qaAdminToken: string;
    let qaEditorToken: string;

    beforeAll(async () => {
      qaApp = await buildTestApp();
      const admin = await registerTestUser(qaApp, { email: "import-qa-admin@example.com" });
      await qaApp.prisma.user.update({ where: { id: admin.userId }, data: { role: "ADMIN" } });
      qaAdminToken = admin.accessToken;
      const editor = await registerTestUser(qaApp, { email: "import-qa-editor@example.com" });
      await qaApp.prisma.user.update({ where: { id: editor.userId }, data: { role: "EDITOR" } });
      qaEditorToken = editor.accessToken;
    });

    afterAll(async () => {
      await qaApp.close();
    });

    function qaAuthHeader(token: string) {
      return { authorization: `Bearer ${token}` };
    }

    async function qaPollUntilTerminal(jobId: string, token: string, timeoutMs = 20000): Promise<Record<string, unknown>> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const res = await qaApp.inject({ method: "GET", url: `/api/v1/admin/import/jobs/${jobId}`, headers: qaAuthHeader(token) });
        const data = res.json().data;
        if (["COMPLETED", "FAILED", "CANCELLED"].includes(data.status)) return data;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`İş ${jobId} zaman aşımına uğradı (terminal duruma ulaşmadı).`);
    }

    async function qaUpload(fields: Record<string, string>, file: { filename: string; contentType: string; content: Buffer }, token = qaAdminToken) {
      const { body, contentType } = buildMultipartPayload({ fields, file });
      return qaApp.inject({
        method: "POST",
        url: "/api/v1/admin/import/jobs",
        headers: { ...qaAuthHeader(token), "content-type": contentType },
        payload: body,
      });
    }

    describe("Bozuk/malformed CSV", () => {
      it("kapanmayan bir tırnak (`Quote Not Closed`) içeren CSV 422 ile reddedilir, iş OLUŞTURULMAZ", async () => {
        // `csv-parse` bunu bir ayrıştırma hatası olarak fırlatır (bkz.
        // tests/unit/import-tabular-parser.test.ts ile tutarlı, ama BURADA uçtan uca HTTP
        // katmanında 422'ye doğru eşlendiğini doğruluyoruz).
        const malformedCsv = 'title,slug\n"Kapanmayan tirnak,slug1\nIkinciSatir,slug2\n';
        const jobCountBefore = await qaApp.prisma.importJob.count();

        const res = await qaUpload({ type: "PAGES" }, { filename: "broken.csv", contentType: "text/csv", content: Buffer.from(malformedCsv) });

        expect(res.statusCode).toBe(422);
        expect(res.json().error.code).toBe("VALIDATION_ERROR");

        const jobCountAfter = await qaApp.prisma.importJob.count();
        expect(jobCountAfter).toBe(jobCountBefore);
      });
    });

    describe("Eksik zorunlu alan — sütun düzeyinde (tekil satır eksikliği değil)", () => {
      it("`title` sütunu HİÇ bulunmayan bir CSV yüklenebilir ama `canStart: false` döner ve `start` 422 verir", async () => {
        const csv = "slug,status\nbir-slug,DRAFT\n";
        const upload = await qaUpload({ type: "PAGES" }, { filename: "no-title-column.csv", contentType: "text/csv", content: Buffer.from(csv) });
        expect(upload.statusCode).toBe(201);
        const job = upload.json().data;
        expect(job.preview.canStart).toBe(false);
        expect(job.preview.fields.some((f: { targetField: string | null; status: string }) => f.targetField === "title" && f.status === "missingRequired")).toBe(
          true
        );

        const start = await qaApp.inject({
          method: "POST",
          url: `/api/v1/admin/import/jobs/${job.id}/start`,
          headers: qaAuthHeader(qaAdminToken),
          payload: {},
        });
        expect(start.statusCode).toBe(422);

        // Başlatılamayan bir iş, PENDING durumunda takılı kalmamalı — hâlâ PENDING'dir (worker HİÇ tetiklenmedi).
        const get = await qaApp.inject({ method: "GET", url: `/api/v1/admin/import/jobs/${job.id}`, headers: qaAuthHeader(qaAdminToken) });
        expect(get.json().data.status).toBe("PENDING");
      });
    });

    describe("Kayıt sayısı tavanı (422, byte-boyutundan BAĞIMSIZ bir sınır — bkz. 413 testinden farkı)", () => {
      it("USERS için 500 kayıt tavanını aşan bir CSV (501 satır) 422 döner, iş OLUŞTURULMAZ", async () => {
        const rows = Array.from({ length: 501 }, (_, i) => `Kullanici ${i},qa-cap-user-${i}@example.com,EDITOR`).join("\n");
        const csv = `name,email,role\n${rows}\n`;
        const jobCountBefore = await qaApp.prisma.importJob.count();

        const res = await qaUpload({ type: "USERS" }, { filename: "too-many-users.csv", contentType: "text/csv", content: Buffer.from(csv) });

        expect(res.statusCode).toBe(422);
        expect(res.json().error.message).toMatch(/500/);

        const jobCountAfter = await qaApp.prisma.importJob.count();
        expect(jobCountAfter).toBe(jobCountBefore);
      });
    });

    describe("Kısmi başarı senaryosu (mimar kararı: errorCount > 0 BAŞARISIZLIK değildir)", () => {
      it("150 kayıttan 3'ü başlıksız → COMPLETED (FAILED DEĞİL), 147 başarılı + 3 hata", async () => {
        const lines: string[] = ["title,slug"];
        for (let i = 1; i <= 150; i++) {
          const isBad = i === 50 || i === 100 || i === 150;
          lines.push(isBad ? `,qa-partial-bad-${i}` : `QA Partial Page ${i},qa-partial-${i}`);
        }
        const csv = lines.join("\n") + "\n";

        const upload = await qaUpload({ type: "PAGES" }, { filename: "partial.csv", contentType: "text/csv", content: Buffer.from(csv) });
        expect(upload.statusCode).toBe(201);
        expect(upload.json().data.totalCount).toBe(150);
        const jobId = upload.json().data.id;

        await qaApp.inject({ method: "POST", url: `/api/v1/admin/import/jobs/${jobId}/start`, headers: qaAuthHeader(qaAdminToken), payload: {} });
        const finished = await qaPollUntilTerminal(jobId, qaAdminToken);

        // Mimar kararı (ARCHITECTURE.md §10.8.6 "Genel ilke" + görev tanımı): kısmi hata bir
        // BAŞARISIZLIK değildir — `FAILED` yalnızca ÇALIŞMA ANINDA (DB hatası, restart) kullanılır.
        expect(finished.status).toBe("COMPLETED");
        expect(finished.totalCount).toBe(150);
        expect(finished.processedCount).toBe(150);
        expect(finished.successCount).toBe(147);
        expect(finished.errorCount).toBe(3);
        expect(finished.skippedCount).toBe(0);

        const pageCount = await qaApp.prisma.page.count({ where: { slug: { startsWith: "qa-partial-" } } });
        expect(pageCount).toBe(147);

        // Sayfadan ayrılıp geri dönme senaryosunun backend karşılığı: `GET /:jobId` ayrı bir
        // istekte İKİNCİ kez sorgulandığında hâlâ AYNI (tutarlı) sonucu vermeli.
        const secondGet = await qaApp.inject({ method: "GET", url: `/api/v1/admin/import/jobs/${jobId}`, headers: qaAuthHeader(qaAdminToken) });
        expect(secondGet.statusCode).toBe(200);
        const secondData = secondGet.json().data;
        expect(secondData.status).toBe("COMPLETED");
        expect(secondData.successCount).toBe(147);
        expect(secondData.errorCount).toBe(3);
        expect(secondData.processedCount).toBe(150);
      }, 30000);
    });

    describe("İşbirlikçi iptal (cooperative cancellation) — PROCESSING sırasında iptal", () => {
      it("PROCESSING durumundaki bir iş iptal edilirse 25'lik parti sınırında durur, o ana kadarki kayıtlar KALIR", async () => {
        const lines: string[] = ["title,slug"];
        for (let i = 1; i <= 400; i++) lines.push(`QA Cancel Page ${i},qa-cancel-${i}`);
        const csv = lines.join("\n") + "\n";

        const upload = await qaUpload({ type: "PAGES" }, { filename: "cancel-midrun.csv", contentType: "text/csv", content: Buffer.from(csv) });
        expect(upload.statusCode).toBe(201);
        const jobId = upload.json().data.id;

        const start = await qaApp.inject({ method: "POST", url: `/api/v1/admin/import/jobs/${jobId}/start`, headers: qaAuthHeader(qaAdminToken), payload: {} });
        expect(start.statusCode).toBe(202);

        // ÖNEMLİ: `cancel`'i `QUEUED` iken değil, işin GERÇEKTEN `PROCESSING`'e geçtiğini
        // gördükten SONRA gönderiyoruz. Gerekçe — qa-agent bulgusu (bkz. görev raporu,
        // backend-agent'a iletildi): `POST /cancel`'in "PENDING/QUEUED → anında CANCELLED"
        // dalı, worker'ın KENDİ `QUEUED→PROCESSING` geçişine karşı ATOMİK DEĞİL (ikisi de
        // "durumu oku, sonra yaz" yapıyor, `WHERE status = 'QUEUED'` gibi bir compare-and-swap
        // YOK). `cancel`'i `QUEUED` anında çağırmak bu yarışı tetikleyip `successCount: 0`
        // ile raporlanan ama arka planda YAZMAYA DEVAM EDEN "hayalet" bir worker'a yol açabiliyor
        // (gözlemlenen: rapor edilen `successCount`, DB'deki gerçek kayıt sayısıyla UYUŞMUYOR).
        // Bu YARIŞ DURUMU ayrı bir bulgu olarak raporlanır; bu testin amacı doğrulanmış/kararlı
        // PROCESSING-sırası iptalini test etmektir, yarış koşulunu KANITLAMAK değil.
        const processingDeadline = Date.now() + 5000;
        let sawProcessing = false;
        while (Date.now() < processingDeadline) {
          const poll = await qaApp.inject({ method: "GET", url: `/api/v1/admin/import/jobs/${jobId}`, headers: qaAuthHeader(qaAdminToken) });
          if (poll.json().data.status === "PROCESSING") {
            sawProcessing = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(sawProcessing).toBe(true);

        const cancel = await qaApp.inject({ method: "POST", url: `/api/v1/admin/import/jobs/${jobId}/cancel`, headers: qaAuthHeader(qaAdminToken) });
        expect(cancel.statusCode).toBe(200);
        // Yanıt anında iş hâlâ PROCESSING olabilir (openapi.yaml açıklaması) — kesin CANCELLED garantisi YOK.
        expect(["PROCESSING", "CANCELLED"]).toContain(cancel.json().data.status);

        const finished = await qaPollUntilTerminal(jobId, qaAdminToken);
        expect(finished.status).toBe("CANCELLED");
        // İşbirlikçi iptal: TÜM 400 kayıt işlenmeden durmuş olmalı (aksi hâlde bu test iptalin
        // gerçekten mid-run çalıştığını KANITLAMAZ, yalnızca "PENDING iken anında iptal" ile aynı
        // şeyi test etmiş olurdu — bkz. mevcut "PENDING bir iş anında CANCELLED olur" testi).
        expect((finished.processedCount as number)).toBeLessThan(400);
        // "O ana kadar yazılmış kayıtlar GERİ ALINMAZ" (openapi.yaml `/cancel` açıklaması) — DB'deki
        // sayı, işin kendi `successCount`'uyla eşleşmeli (rollback YOK).
        const pageCount = await qaApp.prisma.page.count({ where: { slug: { startsWith: "qa-cancel-" } } });
        expect(pageCount).toBe(finished.successCount);
        expect(pageCount).toBeGreaterThan(0);
        expect(pageCount).toBeLessThan(400);
      }, 30000);
    });

    describe("MEDIA — createNew yasak (mimar kararı, §10.8.2)", () => {
      it("MEDIA içe aktarımında duplicateStrategy: createNew → 422 (iş başlatılamaz)", async () => {
        const zip = await buildZipBuffer([{ name: "photo.png", content: PNG_BYTES }]);
        const upload = await qaUpload({ type: "MEDIA" }, { filename: "media.zip", contentType: "application/zip", content: zip });
        expect(upload.statusCode).toBe(201);
        const jobId = upload.json().data.id;

        const start = await qaApp.inject({
          method: "POST",
          url: `/api/v1/admin/import/jobs/${jobId}/start`,
          headers: qaAuthHeader(qaAdminToken),
          payload: { duplicateStrategy: "createNew" },
        });
        expect(start.statusCode).toBe(422);
      });
    });

    describe("RBAC — EDITOR rolü 7 uçun TAMAMINDA reddedilir (403)", () => {
      it("GET/POST/DELETE/start/cancel/errors uçlarının hepsi EDITOR için 403 döner", async () => {
        // Geçerli bir jobId üretmek için ADMIN ile yüklüyoruz — aşağıdaki 403 kontrolleri hiçbiri
        // durum DEĞİŞTİRMEZ (preHandler'da bloklanır), bu yüzden AYNI job tüm alt-kontrollerde
        // güvenle yeniden kullanılabilir.
        const upload = await qaUpload({ type: "PAGES" }, { filename: "rbac.csv", contentType: "text/csv", content: Buffer.from("title\nRBAC Sayfasi\n") });
        expect(upload.statusCode).toBe(201);
        const jobId = upload.json().data.id;

        const checks: Array<{ method: "GET" | "POST" | "DELETE"; url: string; payload?: Record<string, unknown> }> = [
          { method: "GET", url: "/api/v1/admin/import/jobs" },
          { method: "GET", url: `/api/v1/admin/import/jobs/${jobId}` },
          { method: "GET", url: `/api/v1/admin/import/jobs/${jobId}/errors` },
          // NOT: `/start`'ın gövde şeması (`StartImportJobRequestSchema.optional()`) `undefined`'ı
          // kabul eder ama `payload` HİÇ verilmezse `light-my-request` gövdeyi `null` gönderir —
          // bu da preHandler (RBAC) ÇALIŞMADAN ÖNCE preValidation aşamasında 422 üretir (Zod
          // "Expected object, received null"). Gerçek bir RBAC testi için geçerli bir gövde
          // ({}) göndermek GEREKİR — aksi hâlde bu test 403 yerine yanlışlıkla 422'yi doğrulardı.
          { method: "POST", url: `/api/v1/admin/import/jobs/${jobId}/start`, payload: {} },
          { method: "POST", url: `/api/v1/admin/import/jobs/${jobId}/cancel` },
          { method: "DELETE", url: `/api/v1/admin/import/jobs/${jobId}` },
        ];

        for (const check of checks) {
          const res = await qaApp.inject({ method: check.method, url: check.url, headers: qaAuthHeader(qaEditorToken), payload: check.payload });
          expect(res.statusCode, `${check.method} ${check.url} EDITOR için 403 bekleniyordu`).toBe(403);
          expect(res.json().error.code).toBe("FORBIDDEN");
        }

        // `POST /admin/import/jobs` ayrı ele alınır: RBAC hook'unun gerçek bir `multipart/form-data`
        // isteğinde de (boş bir POST değil) devreye girdiğini doğrular.
        const uploadAsEditor = await qaUpload(
          { type: "PAGES" },
          { filename: "rbac-editor.csv", contentType: "text/csv", content: Buffer.from("title\nEditor Denemesi\n") },
          qaEditorToken
        );
        expect(uploadAsEditor.statusCode).toBe(403);
        expect(uploadAsEditor.json().error.code).toBe("FORBIDDEN");

        // Kontrol grubu: job hâlâ ADMIN için erişilebilir ve PENDING durumda (EDITOR denemeleri hiçbirini bozmadı).
        const stillThere = await qaApp.inject({ method: "GET", url: `/api/v1/admin/import/jobs/${jobId}`, headers: qaAuthHeader(qaAdminToken) });
        expect(stillThere.statusCode).toBe(200);
        expect(stillThere.json().data.status).toBe("PENDING");
      });
    });
  });
});
