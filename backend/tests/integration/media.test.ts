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
  const createdStoredPaths: string[] = [];

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // İlk kayıt otomatik ADMIN olur (bkz. auth.service.ts::register).
    const admin = await registerTestUser(app, { email: "media-admin@example.com" });
    adminToken = admin.accessToken;
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
});
