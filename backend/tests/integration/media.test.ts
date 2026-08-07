import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { buildMultipartPayload } from "../helpers/multipart";
import { UPLOAD_DIR } from "../../src/plugins/uploads";

// 1x1 transparent PNG (gerçek PNG magic byte'ları) — tests/unit/import-zip-parser.test.ts ile aynı sabit.
const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000" + "01f15c4890000000a4944415478da6360000002000155bb84770000000049454e44ae426082",
  "hex"
);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const HTML_XSS_BYTES = Buffer.from("<html><body><script>alert(document.cookie)</script></body></html>");

/**
 * §10.8.4 / güvenlik bulgusu — `POST /admin/media` istemcinin beyan ettiği `Content-Type`'a
 * DEĞİL, dosya içeriğinin gerçek magic byte'ından tespit edilen türe göre doğrulama yapmalı
 * (bkz. src/modules/media/media.routes.ts, src/lib/mime-detect.ts).
 */
describe("media — /admin/media (magic-byte doğrulama)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let editorToken: string;
  let viewerToken: string;
  const createdStoredPaths: string[] = [];

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // İlk kayıt otomatik ADMIN olur (bkz. auth.service.ts::register).
    const admin = await registerTestUser(app, { email: "media-admin@example.com" });
    adminToken = admin.accessToken;

    const editor = await registerTestUser(app, { email: "media-editor@example.com" });
    await app.prisma.user.update({ where: { id: editor.userId }, data: { role: "EDITOR" } });
    editorToken = editor.accessToken;

    const viewer = await registerTestUser(app, { email: "media-viewer@example.com" });
    viewerToken = viewer.accessToken;
  });

  afterEach(async () => {
    // Diske gerçekten yazılan test dosyalarını temizle — DB `resetDatabase()` ile temizlenir
    // ama LocalStorage diskteki dosyayı silmez.
    for (const storedPath of createdStoredPaths.splice(0)) {
      await fs.unlink(path.join(UPLOAD_DIR, storedPath)).catch(() => {});
    }
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function upload(contentType: string, content: Buffer, filename = "upload.bin") {
    const { body, contentType: multipartContentType } = buildMultipartPayload({
      file: { filename, contentType, content },
    });
    return app.inject({
      method: "POST",
      url: "/api/v1/admin/media",
      headers: { ...authHeader(adminToken), "content-type": multipartContentType },
      payload: body,
    });
  }

  it("gerçek bir PNG dosyasını doğru Content-Type ile kabul eder ve .png uzantısıyla saklar", async () => {
    const res = await upload("image/png", PNG_BYTES, "photo.png");
    expect(res.statusCode).toBe(201);

    const media = res.json().data;
    expect(media.mimeType).toBe("image/png");
    createdStoredPaths.push(new URL(media.url, "http://localhost").pathname.replace(/^\/uploads\//, ""));
    expect(media.url).toMatch(/\.png$/);
  });

  it("gerçek bir JPEG dosyasını doğru Content-Type ile kabul eder ve .jpg uzantısıyla saklar", async () => {
    const res = await upload("image/jpeg", JPEG_BYTES, "photo.jpg");
    expect(res.statusCode).toBe(201);

    const media = res.json().data;
    expect(media.mimeType).toBe("image/jpeg");
    createdStoredPaths.push(new URL(media.url, "http://localhost").pathname.replace(/^\/uploads\//, ""));
    expect(media.url).toMatch(/\.jpg$/);
  });

  it("sahte Content-Type ile yüklenen HTML/script içeriğini REDDEDER (spoofed-MIME saldırısı)", async () => {
    // Canlı olarak kanıtlanan saldırı: gerçek içeriği <script> olan bir dosya "image/png" Content-Type'ıyla yüklenir.
    const res = await upload("image/png", HTML_XSS_BYTES, "evil.html");
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("beyan edilen tür ile içerikten tespit edilen tür farklı olan gerçek bir görseli REDDEDER (örn. PNG içerik + jpeg beyanı)", async () => {
    const res = await upload("image/jpeg", PNG_BYTES, "actually-png.jpg");
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("SVG yüklemeyi tamamen reddeder (allow-list'te değil — depolanmış XSS riski)", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await upload("image/svg+xml", svg, "logo.svg");
    expect(res.statusCode).toBe(422);
  });

  it("tanınmayan bir dosya türünü REDDEDER (örn. PDF)", async () => {
    const pdf = Buffer.from("%PDF-1.4\n%some fake pdf content");
    const res = await upload("application/pdf", pdf, "doc.pdf");
    expect(res.statusCode).toBe(422);
  });

  // §Faz 2 içerik editörü — `PATCH /:mediaId` alt-metin güncelleme ucu (bkz. media.routes.ts,
  // media.schemas.ts::UpdateMediaAltTextRequestSchema). Gerçek bir dosya yüklemeye gerek
  // yok — Media satırı doğrudan Prisma ile oluşturulur (RBAC/validasyon uçları dosya
  // içeriğinden bağımsızdır).
  describe("PATCH /:mediaId (alt-text)", () => {
    async function createMediaRow(suffix: string) {
      return app.prisma.media.create({
        data: {
          path: `alt-text-test-${suffix}.png`,
          url: `/uploads/alt-text-test-${suffix}.png`,
          filename: `alt-text-test-${suffix}.png`,
          mimeType: "image/png",
          sizeBytes: 100,
        },
      });
    }

    it("ADMIN alt metni günceller (200)", async () => {
      const media = await createMediaRow("admin");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/media/${media.id}`,
        headers: authHeader(adminToken),
        payload: { altText: "Ürünün önden çekilmiş fotoğrafı" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.altText).toBe("Ürünün önden çekilmiş fotoğrafı");
    });

    it("EDITOR alt metni günceller (200)", async () => {
      const media = await createMediaRow("editor");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/media/${media.id}`,
        headers: authHeader(editorToken),
        payload: { altText: "Editör tarafından girilen açıklama" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.altText).toBe("Editör tarafından girilen açıklama");
    });

    it("VIEWER erişemez (403)", async () => {
      const media = await createMediaRow("viewer");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/media/${media.id}`,
        headers: authHeader(viewerToken),
        payload: { altText: "Değişmemeli" },
      });
      expect(res.statusCode).toBe(403);

      const stored = await app.prisma.media.findUniqueOrThrow({ where: { id: media.id } });
      expect(stored.altText).toBeNull();
    });

    it("kimliği doğrulanmamış istek 401 alır", async () => {
      const media = await createMediaRow("unauth");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/media/${media.id}`,
        payload: { altText: "x" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("boş string altText 422 ile reddedilir", async () => {
      const media = await createMediaRow("empty");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/media/${media.id}`,
        headers: authHeader(adminToken),
        payload: { altText: "" },
      });
      expect(res.statusCode).toBe(422);

      const stored = await app.prisma.media.findUniqueOrThrow({ where: { id: media.id } });
      expect(stored.altText).toBeNull();
    });

    it("olmayan mediaId 404 döner", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/admin/media/00000000-0000-0000-0000-000000000099",
        headers: authHeader(adminToken),
        payload: { altText: "x" },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
