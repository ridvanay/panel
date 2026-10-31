import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import realSharp from "sharp";
import { resetDatabase } from "../helpers/reset-db";
import { buildMultipartPayload } from "../helpers/multipart";

/**
 * Paket AE-ek — otomatik medya dönüştürme:
 * - Fotoğraf → WebP (EXIF/GPS silinir, 2560 px, saydamlık korunur, JPEG/PNG uyumluluk kopyası, piksel bombası reddi)
 * - Video kuyruğu (MP4/MOV → H.264; ffmpeg testte taklit edilir): işleniyor/hazır/başarısız, aktif görüşmede erteleme,
 *   aynı anda tek iş, zaman aşımında süreç öldürme, playlist/HLS reddi, yeniden dene, 24 saatlik orijinal temizliği
 * - Hasta belgeleri sharp/ffmpeg'e HİÇ verilmez (spy)
 * - Mevcut medya scripti: kuru / gerçek / geri alma, referans güncellemeleri
 */
const sharpCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("sharp", async (importOriginal) => {
  const actual = (await importOriginal<{ default: typeof realSharp }>()).default;
  const wrapped = ((...args: Parameters<typeof realSharp>) => {
    sharpCalls.count++;
    return actual(...args);
  }) as unknown as typeof realSharp;
  Object.assign(wrapped, actual);
  return { default: wrapped };
});
const spawnCalls = vi.hoisted(() => ({ commands: [] as string[] }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      spawnCalls.commands.push(String(args[0]));
      return actual.spawn(...args);
    },
  };
});
vi.mock("../../src/lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/mail")>();
  return { ...actual, sendMail: () => Promise.resolve({ messageId: "test" }) };
});

let ipCounter = 0;
const nextIp = () => `10.91.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

// --- en küçük ISO-BMFF video yapısı (AE testindekiyle aynı) ---------------------------------------
function box(type: string, ...children: Buffer[]): Buffer {
  const body = Buffer.concat(children);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
}
function videoFile(opts: { brand?: string; codec?: string; moovAtEnd?: boolean } = {}): Buffer {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(5000, 16);
  const hdlr = Buffer.concat([Buffer.alloc(8), Buffer.from("vide", "latin1"), Buffer.alloc(13)]);
  const stsd = box("stsd", Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), box(opts.codec ?? "avc1", Buffer.alloc(78)));
  const moov = box("moov", box("mvhd", mvhd), box("trak", box("mdia", box("hdlr", hdlr), box("minf", box("stbl", stsd)))));
  const ftyp = box("ftyp", Buffer.from((opts.brand ?? "isom").padEnd(4, " "), "latin1"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2mp41", "latin1"));
  const mdat = box("mdat", crypto.randomBytes(2048));
  return Buffer.concat(opts.moovAtEnd ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}

/** Başlığı 20000×20000 (400 MP) diyen ama çok küçük, geçerli CRC'li PNG (piksel bombası). */
function pixelBombPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0, 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(20000, 0);
  ihdr.writeUInt32BE(20000, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.alloc(100))), chunk("IEND", Buffer.alloc(0))]);
}

describe("Paket AE-ek — otomatik medya dönüştürme", () => {
  let app: FastifyInstance;
  let admin: { id: string; email: string; token: string };
  let UPLOAD_DIR: string;
  const cleanupFiles: string[] = [];

  async function user(role: "ADMIN") {
    const { hashPassword } = await import("../../src/lib/password");
    const { signAccessToken } = await import("../../src/lib/jwt");
    const u = await app.prisma.user.create({
      data: { email: `aeek-${crypto.randomUUID()}@example.com`, name: "AE-ek", passwordHash: await hashPassword("Sifre12345!"), role, status: "ACTIVE", emailVerifiedAt: new Date(), twoFactorEnabled: true },
    });
    return { id: u.id, email: u.email, token: signAccessToken({ sub: u.id, email: u.email }).token };
  }

  async function doctor() {
    const specialty = await app.prisma.specialty.create({ data: { name: `S ${crypto.randomUUID()}`, slug: `s-${crypto.randomUUID()}`, icon: "Heart" } });
    return app.prisma.doctorProfile.create({
      data: { title: "Op. Dr.", fullName: "Deniz ARSLAN", bio: "Test.", slug: `aeek-${crypto.randomUUID().slice(0, 8)}`, languages: ["tr"], timeZone: "Europe/Istanbul", specialtyId: specialty.id, sessionDurationMin: 30, sessionPriceCents: 50000, currency: "EUR", isActive: true },
    });
  }

  async function uploadImage(content: Buffer, opts: { filename?: string; contentType?: string; purpose?: string } = {}) {
    const { body, contentType } = buildMultipartPayload({ fields: opts.purpose ? { purpose: opts.purpose } : undefined, file: { filename: opts.filename ?? "foto.jpg", contentType: opts.contentType ?? "image/jpeg", content } });
    const res = await app.inject({ method: "POST", url: "/api/v1/admin/media", headers: { ...auth(admin.token), "content-type": contentType }, payload: body });
    if (res.statusCode === 201) {
      const row = await app.prisma.media.findUniqueOrThrow({ where: { id: res.json().data.id } });
      cleanupFiles.push(row.path, ...((row.variants as { path: string }[] | null) ?? []).map((v) => v.path));
    }
    return res;
  }

  async function uploadVideo(content: Buffer, filename = "IMG_0001.MOV") {
    const { body, contentType } = buildMultipartPayload({ file: { filename, contentType: "video/quicktime", content } });
    return app.inject({ method: "POST", url: "/api/v1/admin/media/video", headers: { ...auth(admin.token), "content-type": contentType }, payload: body, remoteAddress: nextIp() });
  }

  const readUpload = (relPath: string) => fs.readFileSync(path.join(UPLOAD_DIR, relPath));

  beforeAll(async () => {
    const { buildApp } = await import("../../src/app");
    ({ UPLOAD_DIR } = await import("../../src/plugins/uploads"));
    app = await buildApp();
    await app.ready();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    admin = await user("ADMIN");
  });

  afterEach(() => {
    for (const p of cleanupFiles.splice(0)) if (p) fs.rmSync(path.join(UPLOAD_DIR, p), { force: true });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
    vi.resetModules();
  });

  describe("fotoğraf → WebP", () => {
    it("JPEG: WebP'ye çevrilir, EXIF/GPS silinir, EXIF yönü uygulanır, JPEG kopyası yazılır, orijinal saklanmaz", async () => {
      // 300×200, EXIF yön 6 (90° saat yönü) + GPS ve kamera bilgisi.
      const jpeg = await realSharp({ create: { width: 300, height: 200, channels: 3, background: "#3366aa" } })
        .jpeg()
        .withExif({ IFD0: { Make: "Apple", Model: "iPhone 15" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "41/1 0/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "29/1 0/1 0/1" } })
        .withMetadata({ orientation: 6 })
        .toBuffer();
      const inMeta = await realSharp(jpeg).metadata();
      expect([inMeta.orientation, !!inMeta.exif, jpeg.includes(Buffer.from("iPhone"))]).toEqual([6, true, true]);
      const res = await uploadImage(jpeg, { filename: "Konum.JPG" });
      expect(res.statusCode).toBe(201);
      const data = res.json().data;
      expect([data.mimeType, data.filename, data.url.endsWith(".webp")]).toEqual(["image/webp", "Konum.webp", true]);
      expect(res.json().meta.notice.code).toBe("CONVERTED");
      expect(res.json().meta.notice.message).toContain("konum ve kamera bilgileri silindi");
      const row = await app.prisma.media.findUniqueOrThrow({ where: { id: data.id } });
      const webp = readUpload(row.path);
      const meta = await realSharp(webp).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect([meta.width, meta.height]).toEqual([200, 300]); // EXIF yönü uygulandı
      expect(webp.includes(Buffer.from("iPhone"))).toBe(false);
      const variants = row.variants as { format: string; path: string }[];
      expect(variants.map((v) => v.format)).toEqual(["jpeg"]);
      expect(variants[0]!.path).toBe(row.path.replace(/\.webp$/, ".jpg"));
      expect((await realSharp(readUpload(variants[0]!.path)).metadata()).exif).toBeUndefined();
      // Orijinal saklanmaz: klasörde bu UUID'nin yalnızca .webp ve .jpg sürümleri var.
      const base = row.path.replace(/\.webp$/, "");
      expect(fs.readdirSync(UPLOAD_DIR).filter((f) => f.startsWith(base)).sort()).toEqual([`${base}.jpg`, `${base}.webp`]);
    });

    it("büyük görsel en uzun kenarı 2560 px olacak şekilde küçültülür; küçük görsel büyütülmez; uyumluluk kopyası en çok 1600 px", async () => {
      const big = await realSharp({ create: { width: 4000, height: 3000, channels: 3, background: "#888" } }).png().toBuffer();
      const res = await uploadImage(big, { filename: "big.png", contentType: "image/png" });
      expect([res.json().data.width, res.json().data.height]).toEqual([2560, 1920]);
      const row = await app.prisma.media.findUniqueOrThrow({ where: { id: res.json().data.id } });
      expect((row.variants as { width: number }[])[0]!.width).toBe(1600);
      const small = await realSharp({ create: { width: 120, height: 80, channels: 3, background: "#123" } }).png().toBuffer();
      const resSmall = await uploadImage(small, { filename: "s.png", contentType: "image/png" });
      expect([resSmall.json().data.width, resSmall.json().data.height]).toEqual([120, 80]);
    });

    it("saydam PNG: WebP'de saydamlık korunur, ayrıca PNG kopyası yazılır", async () => {
      const png = await realSharp({ create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
      const res = await uploadImage(png, { filename: "logo.png", contentType: "image/png" });
      const row = await app.prisma.media.findUniqueOrThrow({ where: { id: res.json().data.id } });
      const meta = await realSharp(readUpload(row.path)).metadata();
      expect(meta.hasAlpha).toBe(true);
      const { data } = await realSharp(readUpload(row.path)).raw().toBuffer({ resolveWithObject: true });
      expect(data[3]).toBe(0); // ilk pikselin alfa değeri
      expect((row.variants as { format: string }[]).map((v) => v.format).sort()).toEqual(["jpeg", "png"]);
    });

    it("logo: saydam olmasa da PNG kopyası; e-posta logosu bu kopyayı kullanır (WebP değil)", async () => {
      const opaque = await realSharp({ create: { width: 200, height: 60, channels: 3, background: "#0f766e" } }).jpeg().toBuffer();
      const res = await uploadImage(opaque, { filename: "logo.jpg", purpose: "logo" });
      const row = await app.prisma.media.findUniqueOrThrow({ where: { id: res.json().data.id } });
      const png = (row.variants as { format: string; url: string }[]).find((v) => v.format === "png")!;
      expect(png.url).toMatch(/\.png$/);
      await app.prisma.siteSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", logoUrl: row.url }, update: { logoUrl: row.url } });
      const { loadEmailBrandContext } = await import("../../src/lib/branded-mail");
      const ctx = await loadEmailBrandContext(app, "tr");
      expect(ctx.logoUrl).toMatch(new RegExp(`${png.url.replace(/[.]/g, "\\.")}$`));
      expect(ctx.logoUrl).not.toMatch(/\.webp/);
      await app.prisma.siteSettings.update({ where: { id: "singleton" }, data: { logoUrl: null } });
    });

    it("favicon (purpose=icon): ana sürüm PNG kalır", async () => {
      const png = await realSharp({ create: { width: 64, height: 64, channels: 4, background: "#ff0000" } }).png().toBuffer();
      const res = await uploadImage(png, { filename: "fav.png", contentType: "image/png", purpose: "icon" });
      expect(res.json().data.mimeType).toBe("image/png");
    });

    it("kaynak zaten WebP ve meta veri yok: dosya BAYT BAYT aynı kalır, yeniden sıkıştırılmaz; yalnızca JPEG kopyası eklenir", async () => {
      const webp = await realSharp({ create: { width: 320, height: 200, channels: 3, background: "#2a6" } }).webp({ quality: 60 }).toBuffer();
      const res = await uploadImage(webp, { filename: "hazir.webp", contentType: "image/webp" });
      expect(res.statusCode).toBe(201);
      const row = await app.prisma.media.findUniqueOrThrow({ where: { id: res.json().data.id } });
      expect(readUpload(row.path).equals(webp)).toBe(true);
      expect([row.mimeType, row.sizeBytes, row.width, row.height]).toEqual(["image/webp", webp.length, 320, 200]);
      expect((row.variants as { format: string }[]).map((v) => v.format)).toEqual(["jpeg"]);
      expect(res.json().meta.notice.message).toMatch(/^Görsel zaten WebP; olduğu gibi kaydedildi/);
    });

    it("kaynak WebP ama EXIF/GPS var: kayıpsız yeniden yazılır (pikseller aynı, meta veri yok); logo ise PNG kopyası", async () => {
      const webp = await realSharp({ create: { width: 64, height: 48, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 1 } } })
        .webp({ lossless: true })
        .withExif({ IFD0: { Make: "Apple", Model: "iPhone 15" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "41/1 0/1 0/1" } })
        .toBuffer();
      expect((await realSharp(webp).metadata()).exif).toBeDefined();
      const res = await uploadImage(webp, { filename: "logo.webp", contentType: "image/webp", purpose: "logo" });
      const row = await app.prisma.media.findUniqueOrThrow({ where: { id: res.json().data.id } });
      const out = readUpload(row.path);
      const meta = await realSharp(out).metadata();
      expect([meta.format, meta.exif, out.includes(Buffer.from("iPhone"))]).toEqual(["webp", undefined, false]);
      const px = async (b: Buffer) => (await realSharp(b).ensureAlpha().raw().toBuffer()).toString("hex");
      expect(await px(out)).toBe(await px(webp)); // kayıpsız: çözülmüş pikseller birebir aynı
      expect((row.variants as { format: string }[]).map((v) => v.format).sort()).toEqual(["jpeg", "png"]);
      expect(res.json().meta.notice.message).toMatch(/meta veriler kayıpsız silindi/);
    });

    it("JPEG'den çıkan WebP orijinalden büyükse orijinal format (JPEG) korunur; JPEG kopyası ayrıca yazılmaz", async () => {
      const jpeg = await realSharp({ create: { width: 400, height: 300, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 60 } } }).jpeg({ quality: 10 }).toBuffer();
      const res = await uploadImage(jpeg, { filename: "gurultu.jpg" });
      const row = await app.prisma.media.findUniqueOrThrow({ where: { id: res.json().data.id } });
      expect([row.mimeType, row.url.endsWith(".jpg")]).toEqual(["image/jpeg", true]);
      expect(readUpload(row.path).equals(jpeg)).toBe(true); // meta veri yok → dosyaya dokunulmadı
      expect(row.variants).toEqual([]);
      expect(res.json().meta.notice.message).toMatch(/WebP daha büyük olacağı için JPEG olarak kaldı/);
    });

    it("piksel bombası (400 MP başlık) reddedilir; HEIC anlaşılır mesajla reddedilir; SVG reddi sürer", async () => {
      const bomb = await uploadImage(pixelBombPng(), { filename: "bomb.png", contentType: "image/png" });
      expect(bomb.statusCode).toBe(422);
      expect(bomb.json().error.message).toMatch(/çok büyük/);
      const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.from([0, 0, 0, 0]), Buffer.from("mif1heic"), Buffer.alloc(64)]);
      const resHeic = await uploadImage(heic, { filename: "IMG_1.HEIC", contentType: "image/heic" });
      expect(resHeic.statusCode).toBe(422);
      expect(resHeic.json().error.message).toContain("iPhone HEIC");
      const svg = await uploadImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), { filename: "x.svg", contentType: "image/png" });
      expect(svg.statusCode).toBe(422);
    });
  });

  describe("video kuyruğu", () => {
    let worker: typeof import("../../src/lib/video-transcode/worker");
    const outputVideo = videoFile({ brand: "isom", codec: "avc1" });

    beforeAll(async () => {
      worker = await import("../../src/lib/video-transcode/worker");
    });

    /** Kuyruktaki işlerin özel klasördeki orijinalleri de silinir (testler klasörde dosya bırakmaz). */
    async function purgeJobs() {
      for (const j of await app.prisma.mediaTranscodeJob.findMany({ where: { sourcePath: { not: null } } })) fs.rmSync(worker.sourceFilePath(j.sourcePath!), { force: true });
      await app.prisma.mediaTranscodeJob.deleteMany({});
    }

    afterAll(async () => {
      await purgeJobs();
    });

    beforeEach(async () => {
      await purgeJobs();
      await app.prisma.appointment.deleteMany({});
    });

    function fakeDeps(over: Partial<import("../../src/lib/video-transcode/worker").TranscodeDeps> = {}) {
      const calls = { transcode: 0, poster: 0 };
      const deps: import("../../src/lib/video-transcode/worker").TranscodeDeps = {
        transcode: async (_input, output) => {
          calls.transcode++;
          fs.writeFileSync(output, outputVideo);
        },
        extractPoster: async (_input, output) => {
          calls.poster++;
          fs.writeFileSync(output, await realSharp({ create: { width: 320, height: 180, channels: 3, background: "#334" } }).png().toBuffer());
        },
        isConsultationActive: async () => false,
        now: () => new Date(),
        ...over,
      };
      return { deps, calls };
    }

    it("HEVC MOV kabul edilir: 'İşleniyor' durumunda sitede görünmez; iş bitince H.264 MP4 + faststart + kapak, orijinal silinir", async () => {
      const res = await uploadVideo(videoFile({ brand: "qt", codec: "hvc1", moovAtEnd: true }));
      expect(res.statusCode).toBe(201);
      const { media, processing } = res.json().data;
      expect(processing).toEqual({ status: "processing", queuePosition: 1 });
      expect(media.processingStatus).toBe("processing");
      const job = await app.prisma.mediaTranscodeJob.findUniqueOrThrow({ where: { mediaId: media.id } });
      expect([job.sourceContainer, job.sourceCodec, job.status]).toEqual(["mov", "hvc1", "queued"]);
      const sourceFull = worker.sourceFilePath(job.sourcePath!);
      expect(fs.existsSync(sourceFull)).toBe(true);
      expect(sourceFull.startsWith(UPLOAD_DIR)).toBe(false); // orijinal herkese açık klasörde DEĞİL

      const d = await doctor();
      const created = await app.inject({
        method: "POST",
        url: `/api/v1/admin/telehealth/doctors/${d.id}/media`,
        headers: auth(admin.token),
        payload: { kind: "video", videoProvider: "upload", mediaId: media.id, category: "clinic", translations: { tr: { title: "Klinik", description: "", alt: "" } }, isPublished: true },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().data.processing).toMatchObject({ status: "processing", jobStatus: "queued", sourceSizeBytes: job.sourceSizeBytes });
      const showBefore = (await app.inject({ method: "GET", url: `/api/v1/doctors/${d.slug}/showcase`, remoteAddress: nextIp() })).json().data;
      expect(showBefore.media).toEqual([]);

      const { deps, calls } = fakeDeps();
      expect(await worker.runNextTranscodeJob(app, deps)).toEqual({ status: "done", jobId: job.id });
      expect(calls).toEqual({ transcode: 1, poster: 1 });
      const ready = await app.prisma.media.findUniqueOrThrow({ where: { id: media.id } });
      expect([ready.processingStatus, ready.videoCodec, ready.videoFaststart, ready.url.endsWith(".mp4")]).toEqual(["ready", "avc1", true, true]);
      cleanupFiles.push(ready.path);
      expect(fs.existsSync(sourceFull)).toBe(false);
      const doneJob = await app.prisma.mediaTranscodeJob.findUniqueOrThrow({ where: { id: job.id } });
      expect([doneJob.status, doneJob.sourcePath, doneJob.outputSizeBytes]).toEqual(["done", null, outputVideo.length]);
      const dm = await app.prisma.doctorMedia.findFirstOrThrow({ where: { doctorId: d.id }, include: { thumbnailMedia: true } });
      expect(dm.thumbnailMedia?.mimeType).toBe("image/webp"); // kapak WebP + JPEG kopyası
      expect((dm.thumbnailMedia?.variants as { format: string }[]).map((v) => v.format)).toEqual(["jpeg"]);
      cleanupFiles.push(dm.thumbnailMedia!.path, ...(dm.thumbnailMedia!.variants as { path: string }[]).map((v) => v.path));
      const showAfter = (await app.inject({ method: "GET", url: `/api/v1/doctors/${d.slug}/showcase`, remoteAddress: nextIp() })).json().data;
      expect(showAfter.media[0]).toMatchObject({ videoProvider: "upload", videoUrl: expect.stringMatching(/\.mp4$/), thumbnailUrl: expect.stringMatching(/\.webp$/) });
    });

    it("playlist/HLS ve MP4/MOV olmayan girdiler yüklemede reddedilir", async () => {
      for (const content of [Buffer.from("#EXTM3U\n#EXT-X-VERSION:3\nhttp://169.254.169.254/x.ts\n".padEnd(200, "\n")), Buffer.from("ffconcat version 1.0\nfile '/etc/passwd'\n".padEnd(200, " "))]) {
        const res = await uploadVideo(content, "list.mp4");
        expect(res.statusCode).toBe(422);
        expect(res.json().error.message).toBe("Yalnızca MP4 ya da MOV (iPhone) video yükleyebilirsiniz.");
      }
      const { buildTranscodeArgs, buildPosterArgs, ffmpegCommand } = await import("../../src/lib/video-transcode/ffmpeg");
      const args = buildTranscodeArgs("/srv/in.mov", "/srv/out.mp4");
      const at = (flag: string) => args.indexOf(flag);
      expect(args.slice(0, 7)).toEqual(["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-protocol_whitelist", "file,pipe"]);
      expect(args[at("-f") + 1]).toBe("mov");
      expect(at("-f")).toBeLessThan(at("-i")); // girdi yalnızca MOV/MP4 demuxer'ıyla açılır
      for (const [flag, value] of [["-c:v", "libx264"], ["-preset", "veryfast"], ["-crf", "23"], ["-pix_fmt", "yuv420p"], ["-c:a", "aac"], ["-b:a", "128k"], ["-movflags", "+faststart"], ["-threads", "2"], ["-map_metadata", "-1"]] as const) {
        expect(args[at(flag) + 1], flag).toBe(value);
      }
      expect(buildPosterArgs("/srv/out.mp4", "/srv/p.png", 1)).toContain("file,pipe");
      expect(ffmpegCommand(["-version"], "linux")).toEqual({ command: "nice", args: ["-n", "19", "ffmpeg", "-version"] });
    });

    it("aktif görüşme varken iş başlamaz, 2 dk ertelenir", async () => {
      const res = await uploadVideo(videoFile({ brand: "qt" }));
      const job = await app.prisma.mediaTranscodeJob.findUniqueOrThrow({ where: { mediaId: res.json().data.media.id } });
      const now = new Date();
      // Gerçek veriden kontrol: IN_PROGRESS randevu.
      const d = await doctor();
      const { hashToken, generateOpaqueToken } = await import("../../src/lib/tokens");
      await app.prisma.appointment.create({
        data: { doctorId: d.id, patientName: "Hasta", patientEmail: "h@example.com", startsAt: new Date(now.getTime() - 10 * 60_000), endsAt: new Date(now.getTime() + 20 * 60_000), priceCents: 1, currency: "EUR", meetingRoomName: `room_${crypto.randomUUID()}`, accessTokenHash: hashToken(generateOpaqueToken()), status: "IN_PROGRESS", startedAt: now },
      });
      const { deps, calls } = fakeDeps({ isConsultationActive: worker.isConsultationActive, now: () => now });
      expect(await worker.runNextTranscodeJob(app, deps)).toEqual({ status: "deferred" });
      expect(calls.transcode).toBe(0);
      const deferred = await app.prisma.mediaTranscodeJob.findUniqueOrThrow({ where: { id: job.id } });
      expect([deferred.status, deferred.notBefore.getTime() - now.getTime()]).toEqual(["queued", 2 * 60_000]);
      // Süre dolmadan tekrar denenmez; görüşme bitince çalışır.
      expect(await worker.runNextTranscodeJob(app, deps)).toEqual({ status: "idle" });
      await app.prisma.appointment.updateMany({ data: { status: "COMPLETED", endedAt: now } });
      const later = fakeDeps({ isConsultationActive: worker.isConsultationActive, now: () => new Date(now.getTime() + 2 * 60_000 + 1000) });
      expect((await worker.runNextTranscodeJob(app, later.deps)).status).toBe("done");
      cleanupFiles.push((await app.prisma.media.findUniqueOrThrow({ where: { id: job.mediaId } })).path);
    });

    it("aynı anda yalnızca 1 dönüştürme çalışır", async () => {
      await uploadVideo(videoFile({ brand: "qt" }));
      await uploadVideo(videoFile({ brand: "qt" }));
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let active = 0;
      let maxActive = 0;
      const { deps } = fakeDeps({
        transcode: async (_i, output) => {
          active++;
          maxActive = Math.max(maxActive, active);
          await gate;
          fs.writeFileSync(output, outputVideo);
          active--;
        },
      });
      const first = worker.runNextTranscodeJob(app, deps);
      await new Promise((r) => setTimeout(r, 200));
      expect(await worker.runNextTranscodeJob(app, deps)).toEqual({ status: "busy" });
      release();
      expect((await first).status).toBe("done");
      expect((await worker.runNextTranscodeJob(app, deps)).status).toBe("done");
      expect(maxActive).toBe(1);
      for (const m of await app.prisma.media.findMany({ where: { mimeType: "video/mp4", processingStatus: "ready" } })) cleanupFiles.push(m.path);
    });

    it("zaman aşımında süreç öldürülür; video 'Başarısız' olur, yeniden denenebilir; orijinal 24 saat sonra silinir", async () => {
      const { runProcess, ProcessTimeoutError } = await import("../../src/lib/video-transcode/ffmpeg");
      let pid: number | undefined;
      await expect(runProcess(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { timeoutMs: 300, onSpawn: (p) => (pid = p) })).rejects.toBeInstanceOf(ProcessTimeoutError);
      expect(pid).toBeDefined();
      expect(() => process.kill(pid!, 0)).toThrow(); // süreç artık yok

      const res = await uploadVideo(videoFile({ brand: "qt" }));
      const mediaId = res.json().data.media.id as string;
      const now = new Date(Date.now() + 1000); // veritabanı saatiyle ms farkına karşı pay
      const { deps } = fakeDeps({ transcode: async () => Promise.reject(new ProcessTimeoutError(600_000)), now: () => now });
      const failed = await worker.runNextTranscodeJob(app, deps);
      expect(failed).toMatchObject({ status: "failed", error: expect.stringContaining("10 dakikayı aştı") });
      const job = await app.prisma.mediaTranscodeJob.findUniqueOrThrow({ where: { mediaId } });
      expect([job.status, job.sourceDeleteAfter!.getTime() - now.getTime()]).toEqual(["failed", 24 * 3600_000]);
      expect((await app.prisma.media.findUniqueOrThrow({ where: { id: mediaId } })).processingStatus).toBe("failed");

      const list = await app.inject({ method: "GET", url: "/api/v1/admin/media/transcode-jobs", headers: auth(admin.token) });
      expect(list.json().data.find((j: { mediaId: string }) => j.mediaId === mediaId)).toMatchObject({ status: "failed", canRetry: true, error: expect.stringContaining("10 dakikayı") });

      const retry = await app.inject({ method: "POST", url: `/api/v1/admin/media/${mediaId}/transcode/retry`, headers: auth(admin.token) });
      expect(retry.statusCode).toBe(200);
      expect(retry.json().data).toMatchObject({ status: "queued", queuePosition: 1 });
      const failAgain = fakeDeps({ transcode: async () => Promise.reject(new ProcessTimeoutError(600_000)) });
      expect((await worker.runNextTranscodeJob(app, failAgain.deps)).status).toBe("failed");

      // 24 saat sonra orijinal silinir; artık yeniden denenemez.
      const src = worker.sourceFilePath(job.sourcePath!);
      expect(await worker.cleanupTranscodeSources(app, new Date(Date.now() + 25 * 3600_000))).toMatchObject({ expired: 1 });
      expect(fs.existsSync(src)).toBe(false);
      const retryAgain = await app.inject({ method: "POST", url: `/api/v1/admin/media/${mediaId}/transcode/retry`, headers: auth(admin.token) });
      expect(retryAgain.statusCode).toBe(409);
    });
  });

  describe("hasta belgeleri dönüştürülmez", () => {
    it("hastanın yüklediği JPEG belge sharp'a ve ffmpeg'e HİÇ verilmez, olduğu gibi saklanır", async () => {
      const { generateOpaqueToken, hashToken } = await import("../../src/lib/tokens");
      const d = await doctor();
      const token = generateOpaqueToken();
      const booking = await app.prisma.appointmentBooking.create({
        data: {
          bookingNumber: `AEEK-${crypto.randomUUID().slice(0, 8)}`,
          doctorId: d.id,
          patientName: "Hasta",
          patientEmail: "hasta@example.com",
          slotCount: 1,
          unitPriceCents: 100,
          subtotalCents: 100,
          totalCents: 100,
          currency: "EUR",
          paymentStatus: "PAID",
          expiresAt: new Date(Date.now() + 3600_000),
          meetingRoomName: `room_${crypto.randomBytes(8).toString("hex")}`,
          accessTokenHash: hashToken(token),
          consentAt: new Date(),
          consentVersion: "v1",
        },
      });
      const intake = await app.inject({ method: "PUT", url: `/api/v1/appointments/bookings/${booking.id}/intake?t=${token}`, payload: { note: "Not", healthDataConsent: true } });
      expect(intake.statusCode).toBe(200);
      const jpeg = await realSharp({ create: { width: 50, height: 50, channels: 3, background: "#ccc" } })
        .jpeg()
        .withExif({ IFD0: { Make: "Canon" } })
        .toBuffer();
      sharpCalls.count = 0;
      spawnCalls.commands.length = 0;
      const { body, contentType } = buildMultipartPayload({ file: { filename: "tahlil.jpg", contentType: "image/jpeg", content: jpeg } });
      const res = await app.inject({ method: "POST", url: `/api/v1/appointments/bookings/${booking.id}/documents?t=${token}`, headers: { "content-type": contentType }, payload: body });
      expect(res.statusCode).toBe(201);
      expect(sharpCalls.count).toBe(0);
      expect(spawnCalls.commands).toEqual([]);
      const doc = await app.prisma.appointmentDocument.findUniqueOrThrow({ where: { id: res.json().data.id } });
      expect([doc.mimeType, doc.sizeBytes, doc.sha256]).toEqual(["image/jpeg", jpeg.length, crypto.createHash("sha256").update(jpeg).digest("hex")]);
      // Kontrol: admin yüklemesi ise sharp'tan geçer (spy gerçekten çalışıyor).
      await uploadImage(jpeg);
      expect(sharpCalls.count).toBeGreaterThan(0);
    });
  });

  describe("mevcut medya scripti", () => {
    it("kuru çalışma yazmaz; gerçek çalışma WebP + kopyalar üretir, referansları günceller (OG hariç); geri alma her şeyi döndürür", async () => {
      const { convertExistingMedia, restoreConvertedMedia } = await import("../../src/lib/media-conversion/convert-existing");
      const tmpUploads = fs.mkdtempSync(path.join(os.tmpdir(), "aeek-up-"));
      const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aeek-bk-"));
      try {
        await app.prisma.media.deleteMany({});
        const jpgId = crypto.randomUUID();
        const pngId = crypto.randomUUID();
        const jpg = await realSharp({ create: { width: 3000, height: 2000, channels: 3, background: "#468" } })
          .jpeg({ quality: 95 })
          .withExif({ IFD0: { Make: "Apple" } })
          .toBuffer();
        const png = await realSharp({ create: { width: 300, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
        fs.writeFileSync(path.join(tmpUploads, `${jpgId}.jpg`), jpg);
        fs.writeFileSync(path.join(tmpUploads, `${pngId}.png`), png);
        const mJpg = await app.prisma.media.create({ data: { path: `${jpgId}.jpg`, url: `/uploads/${jpgId}.jpg`, filename: "kapak.jpg", mimeType: "image/jpeg", sizeBytes: jpg.length, width: 3000, height: 2000 } });
        const mPng = await app.prisma.media.create({ data: { path: `${pngId}.png`, url: `/uploads/${pngId}.png`, filename: "logo.png", mimeType: "image/png", sizeBytes: png.length, width: 300, height: 100 } });
        await app.prisma.siteSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", logoUrl: mPng.url }, update: { logoUrl: mPng.url, faviconUrl: null, appleTouchIconUrl: null } });
        // Zaten WebP (meta verisiz) ve WebP'si daha büyük çıkacak düşük kaliteli JPEG.
        const webpId = crypto.randomUUID();
        const noisyId = crypto.randomUUID();
        const webpSrc = await realSharp({ create: { width: 200, height: 100, channels: 3, background: "#963" } }).webp({ quality: 50 }).toBuffer();
        const noisy = await realSharp({ create: { width: 400, height: 300, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 60 } } }).jpeg({ quality: 10 }).toBuffer();
        fs.writeFileSync(path.join(tmpUploads, `${webpId}.webp`), webpSrc);
        fs.writeFileSync(path.join(tmpUploads, `${noisyId}.jpg`), noisy);
        const mWebp = await app.prisma.media.create({ data: { path: `${webpId}.webp`, url: `/uploads/${webpId}.webp`, filename: "hazir.webp", mimeType: "image/webp", sizeBytes: webpSrc.length, width: 200, height: 100 } });
        const mNoisy = await app.prisma.media.create({ data: { path: `${noisyId}.jpg`, url: `/uploads/${noisyId}.jpg`, filename: "gurultu.jpg", mimeType: "image/jpeg", sizeBytes: noisy.length, width: 400, height: 300 } });
        const imageBytesBefore = jpg.length + png.length + webpSrc.length + noisy.length;
        const post = await app.prisma.blogPost.create({
          data: { title: "Yazı", slug: `aeek-${crypto.randomUUID().slice(0, 6)}`, contentHtml: `<p><img src="https://site.example${mJpg.url}"></p>`, coverImageUrl: mJpg.url, ogImageUrl: mJpg.url },
        });

        const dryLines: string[] = [];
        const dry = await convertExistingMedia(app.prisma, { apply: false, backupRoot, uploadDir: tmpUploads, log: (l) => dryLines.push(l) });
        expect([dry.mode, dry.candidates, dry.converted, dry.bytesBefore]).toEqual(["dry-run", 4, 4, imageBytesBefore]);
        expect(dry.decisions).toEqual({ convert: 2, keep: 1, "keep-lossless-rewrite": 0, "keep-original-format": 1 });
        // Her dosya için karar satırı.
        expect(dryLines.find((l) => l.includes(`${jpgId}.jpg`))).toMatch(/dönüştür → WebP \+ kopya \(JPEG\)/);
        expect(dryLines.find((l) => l.includes(`${webpId}.webp`))).toMatch(/olduğu gibi bırak \+ kopya \(JPEG\)/);
        expect(dryLines.find((l) => l.includes(`${noisyId}.jpg`))).toMatch(/orijinal format korunur \(WebP daha büyük\)/);
        // "Toplam görüntü boyutu (yalnızca site görselleri)": Media'daki image/* kayıtları.
        expect(dry.siteImageBytes.before).toBe(imageBytesBefore);
        expect(dry.siteImageBytes.after).toBe(dry.bytesAfter);
        expect(dry.referenceUpdates).toEqual(
          expect.arrayContaining([
            { table: "blog_posts", column: "contentHtml", rows: 1 },
            { table: "blog_posts", column: "coverImageUrl", rows: 1 },
            { table: "site_settings", column: "logoUrl", rows: 1 },
          ])
        );
        expect(fs.readdirSync(tmpUploads).sort()).toEqual([`${jpgId}.jpg`, `${pngId}.png`, `${webpId}.webp`, `${noisyId}.jpg`].sort());
        expect((await app.prisma.media.findUniqueOrThrow({ where: { id: mJpg.id } })).mimeType).toBe("image/jpeg");
        await expect(convertExistingMedia(app.prisma, { apply: true, backupRoot, uploadDir: tmpUploads })).rejects.toThrow(/operator/);

        const real = await convertExistingMedia(app.prisma, { apply: true, operator: "test", backupRoot, uploadDir: tmpUploads });
        expect([real.mode, real.converted]).toEqual(["apply", 4]);
        // WebP kaynak: dosya ve DB adresi değişmez; yalnızca JPEG kopyası eklenir.
        const webpAfter = await app.prisma.media.findUniqueOrThrow({ where: { id: mWebp.id } });
        expect([webpAfter.url, webpAfter.mimeType, webpAfter.sizeBytes]).toEqual([mWebp.url, "image/webp", webpSrc.length]);
        expect(fs.readFileSync(path.join(tmpUploads, `${webpId}.webp`)).equals(webpSrc)).toBe(true);
        expect((webpAfter.variants as { format: string; path: string }[]).map((v) => [v.format, v.path])).toEqual([["jpeg", `${webpId}.jpg`]]);
        // WebP'si büyük çıkan JPEG: JPEG kalır, dosya ve adres aynı, kopya yok.
        const noisyAfter = await app.prisma.media.findUniqueOrThrow({ where: { id: mNoisy.id } });
        expect([noisyAfter.url, noisyAfter.mimeType, noisyAfter.variants]).toEqual([mNoisy.url, "image/jpeg", []]);
        expect(fs.readFileSync(path.join(tmpUploads, `${noisyId}.jpg`)).equals(noisy)).toBe(true);
        expect(real.bytesAfter).toBeLessThan(real.bytesBefore);
        const after = await app.prisma.media.findUniqueOrThrow({ where: { id: mJpg.id } });
        expect([after.mimeType, after.url, after.width]).toEqual(["image/webp", `/uploads/${jpgId}.webp`, 2560]);
        // Eski yol aynı biçimde uyumluluk kopyası olarak yaşar (OG ve dış bağlantılar kırılmaz), EXIF yok.
        const oldPathNow = await realSharp(fs.readFileSync(path.join(tmpUploads, `${jpgId}.jpg`))).metadata();
        expect([oldPathNow.format, oldPathNow.exif]).toEqual(["jpeg", undefined]);
        const pngAfter = await app.prisma.media.findUniqueOrThrow({ where: { id: mPng.id } });
        expect((pngAfter.variants as { format: string }[]).map((v) => v.format).sort()).toEqual(["jpeg", "png"]);
        expect((await realSharp(fs.readFileSync(path.join(tmpUploads, `${pngId}.png`))).metadata()).format).toBe("png");
        const postAfter = await app.prisma.blogPost.findUniqueOrThrow({ where: { id: post.id } });
        expect(postAfter.contentHtml).toBe(`<p><img src="https://site.example/uploads/${jpgId}.webp"></p>`);
        expect([postAfter.coverImageUrl, postAfter.ogImageUrl]).toEqual([`/uploads/${jpgId}.webp`, mJpg.url]); // OG değişmez
        expect((await app.prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } })).logoUrl).toBe(`/uploads/${pngId}.webp`);
        // İkinci çalıştırma tekrar dönüştürmez.
        expect((await convertExistingMedia(app.prisma, { apply: false, backupRoot, uploadDir: tmpUploads })).candidates).toBe(0);

        const restored = await restoreConvertedMedia(app.prisma, { runId: real.runId!, backupRoot, uploadDir: tmpUploads });
        expect(restored).toEqual({ restored: 4, missingBackups: [] });
        expect(fs.readdirSync(tmpUploads).sort()).toEqual([`${jpgId}.jpg`, `${pngId}.png`, `${webpId}.webp`, `${noisyId}.jpg`].sort());
        expect((await app.prisma.media.findUniqueOrThrow({ where: { id: mWebp.id } })).variants).toBeNull();
        expect(fs.readFileSync(path.join(tmpUploads, `${jpgId}.jpg`)).equals(jpg)).toBe(true);
        const back = await app.prisma.media.findUniqueOrThrow({ where: { id: mJpg.id } });
        expect([back.mimeType, back.url, back.variants]).toEqual(["image/jpeg", mJpg.url, null]);
        const postBack = await app.prisma.blogPost.findUniqueOrThrow({ where: { id: post.id } });
        expect([postBack.contentHtml, postBack.coverImageUrl]).toEqual([post.contentHtml, mJpg.url]);
        expect((await app.prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } })).logoUrl).toBe(mPng.url);
        await expect(restoreConvertedMedia(app.prisma, { runId: real.runId!, backupRoot, uploadDir: tmpUploads })).rejects.toThrow(/zaten geri alınmış/);
      } finally {
        fs.rmSync(tmpUploads, { recursive: true, force: true });
        fs.rmSync(backupRoot, { recursive: true, force: true });
      }
    });
  });
});
