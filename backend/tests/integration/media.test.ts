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
    // §Faz — piksel boyutu (width/height), upload anında `image-size` ile buffer'dan hesaplanır.
    expect(media.width).toBe(1);
    expect(media.height).toBe(1);
  });

  it("gerçek bir JPEG dosyasını doğru Content-Type ile kabul eder ve .jpg uzantısıyla saklar", async () => {
    const res = await upload("image/jpeg", JPEG_BYTES, "photo.jpg");
    expect(res.statusCode).toBe(201);

    const media = res.json().data;
    expect(media.mimeType).toBe("image/jpeg");
    createdStoredPaths.push(new URL(media.url, "http://localhost").pathname.replace(/^\/uploads\//, ""));
    expect(media.url).toMatch(/\.jpg$/);
    // Bu sabit sadece APP0 başlığından oluşan KIRPILMIŞ bir JPEG'tir (gerçek SOF/boyut verisi
    // yok) — `image-size` boyutu hesaplayamaz ve istek REDDEDİLMEDEN width/height null kalır.
    expect(media.width).toBeNull();
    expect(media.height).toBeNull();
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

    it("USER erişemez (403)", async () => {
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

    it("gövdeye folderId eklenirse 422 (bilinmeyen alan, karar §10.11.4)", async () => {
      const media = await createMediaRow("unknown-field");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/media/${media.id}`,
        headers: authHeader(adminToken),
        payload: { altText: "x", folderId: null },
      });
      expect(res.statusCode).toBe(422);
    });
  });

  // §10.11 Medya Kütüphanesi — Klasör Sistemi. Backend-agent kendi implementasyonunu doğrulayan
  // minimum smoke testler — kapsamlı senaryolar qa-agent'ın işidir (bkz. ARCHITECTURE.md §10.11).
  describe("Klasörler (§10.11)", () => {
    async function createMediaRow(suffix: string, folderId: string | null = null) {
      return app.prisma.media.create({
        data: {
          path: `folder-test-${suffix}.png`,
          url: `/uploads/folder-test-${suffix}.png`,
          filename: `folder-test-${suffix}.png`,
          mimeType: "image/png",
          sizeBytes: 100,
          folderId,
        },
      });
    }

    describe("POST/GET /admin/media/folders", () => {
      it("ADMIN kök klasör oluşturur, GET listede döner (mediaCount 0)", async () => {
        const createRes = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/folders",
          headers: authHeader(adminToken),
          payload: { name: "Ürün Görselleri" },
        });
        expect(createRes.statusCode).toBe(201);
        const folder = createRes.json().data;
        expect(folder.parentId).toBeNull();
        expect(folder.mediaCount).toBe(0);

        const listRes = await app.inject({ method: "GET", url: "/api/v1/admin/media/folders", headers: authHeader(adminToken) });
        expect(listRes.statusCode).toBe(200);
        expect(listRes.json().data.some((f: { id: string }) => f.id === folder.id)).toBe(true);
      });

      it("EDITOR alt klasör oluşturabilir (aynı eşik, POST /admin/media ile aynı)", async () => {
        const rootRes = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/folders",
          headers: authHeader(adminToken),
          payload: { name: "Kök A" },
        });
        const root = rootRes.json().data;

        const childRes = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/folders",
          headers: authHeader(editorToken),
          payload: { name: "Alt A", parentId: root.id },
        });
        expect(childRes.statusCode).toBe(201);
        expect(childRes.json().data.parentId).toBe(root.id);
      });

      it("USER klasör oluşturamaz (403)", async () => {
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/folders",
          headers: authHeader(viewerToken),
          payload: { name: "Yetkisiz" },
        });
        expect(res.statusCode).toBe(403);
      });

      it("derinlik 2 aşımı — alt klasörün altına klasör açmak 422 döner", async () => {
        const rootRes = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/folders",
          headers: authHeader(adminToken),
          payload: { name: "Derinlik Kök" },
        });
        const root = rootRes.json().data;
        const childRes = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/folders",
          headers: authHeader(adminToken),
          payload: { name: "Derinlik Alt", parentId: root.id },
        });
        const child = childRes.json().data;

        const grandchildRes = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/folders",
          headers: authHeader(adminToken),
          payload: { name: "Derinlik Torun", parentId: child.id },
        });
        expect(grandchildRes.statusCode).toBe(422);
      });

      it("aynı üst klasör altında aynı isim (case-insensitive) 409 döner", async () => {
        // Not: Türkçe "İ/i" (dotted-I) karakteri Unicode case-folding'te locale-bağımlı bir
        // kenar durumdur (LOWER('İ') Postgres'te 'i' değil 'i̇' verir) — test bilinçli olarak
        // ASCII bir isim kullanır, servis katmanındaki case-insensitive kuralın kendisini test eder.
        const first = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/folders",
          headers: authHeader(adminToken),
          payload: { name: "Tekrarli Isim" },
        });
        expect(first.statusCode).toBe(201);

        const second = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/folders",
          headers: authHeader(adminToken),
          payload: { name: "TEKRARLI ISIM" },
        });
        expect(second.statusCode).toBe(409);
        expect(second.json().error.code).toBe("CONFLICT");
      });

      it("parentId gönderildi ama böyle bir klasör yoksa 404 döner", async () => {
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/folders",
          headers: authHeader(adminToken),
          payload: { name: "Yetim", parentId: "00000000-0000-0000-0000-000000000099" },
        });
        expect(res.statusCode).toBe(404);
      });
    });

    describe("PATCH/DELETE /admin/media/folders/:folderId", () => {
      it("yeniden adlandırma 200 döner", async () => {
        const createRes = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/folders",
          headers: authHeader(adminToken),
          payload: { name: "Eski Ad" },
        });
        const folder = createRes.json().data;

        const patchRes = await app.inject({
          method: "PATCH",
          url: `/api/v1/admin/media/folders/${folder.id}`,
          headers: authHeader(adminToken),
          payload: { name: "Yeni Ad" },
        });
        expect(patchRes.statusCode).toBe(200);
        expect(patchRes.json().data.name).toBe("Yeni Ad");
        // parentId gönderilmedi — değişmemeli.
        expect(patchRes.json().data.parentId).toBeNull();
      });

      it("boş gövde 422 döner (en az bir alan zorunlu)", async () => {
        const createRes = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/folders",
          headers: authHeader(adminToken),
          payload: { name: "Boş Gövde Testi" },
        });
        const folder = createRes.json().data;

        const res = await app.inject({
          method: "PATCH",
          url: `/api/v1/admin/media/folders/${folder.id}`,
          headers: authHeader(adminToken),
          payload: {},
        });
        expect(res.statusCode).toBe(422);
      });

      it("klasör kendi kendinin parent'ı olamaz (422)", async () => {
        const createRes = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/folders",
          headers: authHeader(adminToken),
          payload: { name: "Kendine Referans" },
        });
        const folder = createRes.json().data;

        const res = await app.inject({
          method: "PATCH",
          url: `/api/v1/admin/media/folders/${folder.id}`,
          headers: authHeader(adminToken),
          payload: { parentId: folder.id },
        });
        expect(res.statusCode).toBe(422);
      });

      it("alt klasörü olan bir klasör başka bir klasörün altına taşınamaz (422)", async () => {
        const rootA = (
          await app.inject({ method: "POST", url: "/api/v1/admin/media/folders", headers: authHeader(adminToken), payload: { name: "Taşıma Kök A" } })
        ).json().data;
        const rootB = (
          await app.inject({ method: "POST", url: "/api/v1/admin/media/folders", headers: authHeader(adminToken), payload: { name: "Taşıma Kök B" } })
        ).json().data;
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/folders",
          headers: authHeader(adminToken),
          payload: { name: "Taşıma Alt", parentId: rootA.id },
        });

        const res = await app.inject({
          method: "PATCH",
          url: `/api/v1/admin/media/folders/${rootA.id}`,
          headers: authHeader(adminToken),
          payload: { parentId: rootB.id },
        });
        expect(res.statusCode).toBe(422);
      });

      it("ADMIN klasörü siler — içindeki medya Kategorisiz'e düşer, alt klasör köke çıkar (204)", async () => {
        const root = (
          await app.inject({ method: "POST", url: "/api/v1/admin/media/folders", headers: authHeader(adminToken), payload: { name: "Silinecek Kök" } })
        ).json().data;
        const child = (
          await app.inject({
            method: "POST",
            url: "/api/v1/admin/media/folders",
            headers: authHeader(adminToken),
            payload: { name: "Silinecek Alt", parentId: root.id },
          })
        ).json().data;
        const media = await createMediaRow("delete-folder", root.id);

        const deleteRes = await app.inject({ method: "DELETE", url: `/api/v1/admin/media/folders/${root.id}`, headers: authHeader(adminToken) });
        expect(deleteRes.statusCode).toBe(204);

        const storedMedia = await app.prisma.media.findUniqueOrThrow({ where: { id: media.id } });
        expect(storedMedia.folderId).toBeNull();

        const storedChild = await app.prisma.mediaFolder.findUniqueOrThrow({ where: { id: child.id } });
        expect(storedChild.parentId).toBeNull();
      });

      it("EDITOR klasör silemez (403)", async () => {
        const root = (
          await app.inject({ method: "POST", url: "/api/v1/admin/media/folders", headers: authHeader(adminToken), payload: { name: "Editör Silemez" } })
        ).json().data;

        const res = await app.inject({ method: "DELETE", url: `/api/v1/admin/media/folders/${root.id}`, headers: authHeader(editorToken) });
        expect(res.statusCode).toBe(403);
      });

      // qa-agent boşluk taraması — POST/DELETE için USER/EDITOR negatif senaryoları vardı ama
      // PATCH (yeniden adlandırma/taşıma) hiç denenmemişti. Eşik §10.11.2 tablosuna göre POST ile
      // AYNI (ADMIN, EDITOR) — USER burada da 403 almalı ve klasör DEĞİŞMEMELİDİR.
      it("USER klasörü yeniden adlandıramaz (403), klasör değişmeden kalır", async () => {
        const folder = (
          await app.inject({ method: "POST", url: "/api/v1/admin/media/folders", headers: authHeader(adminToken), payload: { name: "Viewer Patch" } })
        ).json().data;

        const res = await app.inject({
          method: "PATCH",
          url: `/api/v1/admin/media/folders/${folder.id}`,
          headers: authHeader(viewerToken),
          payload: { name: "Değişmemeli" },
        });
        expect(res.statusCode).toBe(403);

        const stored = await app.prisma.mediaFolder.findUniqueOrThrow({ where: { id: folder.id } });
        expect(stored.name).toBe("Viewer Patch");
      });
    });

    describe("POST /admin/media/move", () => {
      it("tekil ve toplu taşıma — kısmi başarı (skippedIds) 200 döner", async () => {
        const folder = (
          await app.inject({ method: "POST", url: "/api/v1/admin/media/folders", headers: authHeader(adminToken), payload: { name: "Taşı Hedef" } })
        ).json().data;
        const mediaA = await createMediaRow("move-a");
        const mediaB = await createMediaRow("move-b");
        const missingId = "00000000-0000-0000-0000-000000000099";

        const res = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/move",
          headers: authHeader(editorToken),
          payload: { mediaIds: [mediaA.id, mediaB.id, missingId], folderId: folder.id },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json().data;
        expect(body.requestedCount).toBe(3);
        expect(body.movedCount).toBe(2);
        expect(body.skippedIds).toEqual([missingId]);

        const stored = await app.prisma.media.findUniqueOrThrow({ where: { id: mediaA.id } });
        expect(stored.folderId).toBe(folder.id);
      });

      it("hedef klasör yoksa 404 döner, hiçbir kayıt güncellenmez", async () => {
        const media = await createMediaRow("move-missing-folder");
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/move",
          headers: authHeader(adminToken),
          payload: { mediaIds: [media.id], folderId: "00000000-0000-0000-0000-000000000099" },
        });
        expect(res.statusCode).toBe(404);

        const stored = await app.prisma.media.findUniqueOrThrow({ where: { id: media.id } });
        expect(stored.folderId).toBeNull();
      });

      it("folderId alanı hiç gönderilmezse 422 döner (kazara klasörden çıkarmayı önler)", async () => {
        const media = await createMediaRow("move-no-folderid");
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/move",
          headers: authHeader(adminToken),
          payload: { mediaIds: [media.id] },
        });
        expect(res.statusCode).toBe(422);
      });

      // qa-agent boşluk taraması — toplu taşıma ucunun RBAC eşiği (§10.11.2: ADMIN, EDITOR) hiç
      // negatif test edilmemişti. USER 403 almalı VE kayıt HİÇ güncellenmemelidir.
      it("USER taşıyamaz (403), hiçbir kayıt güncellenmez", async () => {
        const folder = (
          await app.inject({ method: "POST", url: "/api/v1/admin/media/folders", headers: authHeader(adminToken), payload: { name: "Viewer Taşıyamaz" } })
        ).json().data;
        const media = await createMediaRow("move-viewer-forbidden");

        const res = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media/move",
          headers: authHeader(viewerToken),
          payload: { mediaIds: [media.id], folderId: folder.id },
        });
        expect(res.statusCode).toBe(403);

        const stored = await app.prisma.media.findUniqueOrThrow({ where: { id: media.id } });
        expect(stored.folderId).toBeNull();
      });
    });

    describe("GET /admin/media?folderId=", () => {
      it("`none` yalnızca Kategorisiz medyayı döner, UUID yalnızca o klasördekini döner (özyinelemesiz)", async () => {
        const folder = (
          await app.inject({ method: "POST", url: "/api/v1/admin/media/folders", headers: authHeader(adminToken), payload: { name: "Filtre Klasörü" } })
        ).json().data;
        const inFolder = await createMediaRow("filter-in", folder.id);
        const uncategorized = await createMediaRow("filter-none", null);

        const noneRes = await app.inject({ method: "GET", url: "/api/v1/admin/media?folderId=none", headers: authHeader(adminToken) });
        const noneIds = noneRes.json().data.map((m: { id: string }) => m.id);
        expect(noneIds).toContain(uncategorized.id);
        expect(noneIds).not.toContain(inFolder.id);

        const folderRes = await app.inject({ method: "GET", url: `/api/v1/admin/media?folderId=${folder.id}`, headers: authHeader(adminToken) });
        const folderIds = folderRes.json().data.map((m: { id: string }) => m.id);
        expect(folderIds).toEqual([inFolder.id]);
      });

      it("geçersiz folderId (UUID/none değil) 422 döner", async () => {
        const res = await app.inject({ method: "GET", url: "/api/v1/admin/media?folderId=not-a-uuid", headers: authHeader(adminToken) });
        expect(res.statusCode).toBe(422);
      });

      // qa-agent boşluk taraması — mevcut testler `none` ve var olan bir klasör UUID'sini kapsıyordu
      // ama geçerli FORMATTA olup DB'de karşılığı OLMAYAN bir UUID hiç denenmemişti. Route bilinçli
      // olarak 404 DEĞİL boş liste + 200 döner (bkz. media.routes.ts satır ~203-206 yorumu) — bu
      // davranış GET /admin/media?folderId=<var olan klasör> ile SİMETRİKTİR (filtre bulamazsa boş
      // liste), 404 sadece yazma uçlarında (move/upload) kullanılır.
      it("var olmayan (ama UUID formatında) folderId ile filtreleme 404 DEĞİL, boş liste + 200 döner", async () => {
        await createMediaRow("filter-missing-folder-noise"); // Kategorisiz bir kayıt — yanlışlıkla dönmediğini kanıtlar.
        const res = await app.inject({
          method: "GET",
          url: "/api/v1/admin/media?folderId=00000000-0000-0000-0000-000000000099",
          headers: authHeader(adminToken),
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toEqual([]);
      });
    });

    describe("POST /admin/media (upload) — opsiyonel folderId", () => {
      it("folderId ile yüklenen görsel doğrudan o klasöre düşer", async () => {
        const folder = (
          await app.inject({ method: "POST", url: "/api/v1/admin/media/folders", headers: authHeader(adminToken), payload: { name: "Yükleme Klasörü" } })
        ).json().data;

        const { body, contentType } = buildMultipartPayload({
          fields: { folderId: folder.id },
          file: { filename: "with-folder.png", contentType: "image/png", content: PNG_BYTES },
        });
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media",
          headers: { ...authHeader(adminToken), "content-type": contentType },
          payload: body,
        });
        expect(res.statusCode).toBe(201);
        expect(res.json().data.folderId).toBe(folder.id);
        createdStoredPaths.push(new URL(res.json().data.url, "http://localhost").pathname.replace(/^\/uploads\//, ""));
      });

      it("var olmayan folderId ile yükleme 404 döner (dosya diske yazılmadan reddedilir)", async () => {
        const { body, contentType } = buildMultipartPayload({
          fields: { folderId: "00000000-0000-0000-0000-000000000099" },
          file: { filename: "orphan.png", contentType: "image/png", content: PNG_BYTES },
        });
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media",
          headers: { ...authHeader(adminToken), "content-type": contentType },
          payload: body,
        });
        expect(res.statusCode).toBe(404);
      });

      it("folderId dosyadan SONRA gelse dahi doğru işlenir (alan sırası bağımsız)", async () => {
        const folder = (
          await app.inject({ method: "POST", url: "/api/v1/admin/media/folders", headers: authHeader(adminToken), payload: { name: "Sıra Bağımsız" } })
        ).json().data;

        const { body, contentType } = buildMultipartPayload({
          fields: { folderId: folder.id },
          file: { filename: "file-first.png", contentType: "image/png", content: PNG_BYTES },
          fileFirst: true,
        });
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/admin/media",
          headers: { ...authHeader(adminToken), "content-type": contentType },
          payload: body,
        });
        expect(res.statusCode).toBe(201);
        expect(res.json().data.folderId).toBe(folder.id);
        createdStoredPaths.push(new URL(res.json().data.url, "http://localhost").pathname.replace(/^\/uploads\//, ""));
      });
    });
  });
});
