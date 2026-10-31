import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { resetDatabase } from "../helpers/reset-db";
import { buildMultipartPayload } from "../helpers/multipart";
import { UPLOAD_DIR } from "../../src/plugins/uploads";
import sharp from "sharp";
import { ORIGINALS_DIR, runNextTranscodeJob, sourceFilePath, type TranscodeDeps } from "../../src/lib/video-transcode/worker";

/**
 * Paket AE — sunucuya video yükleme (MP4 kutu denetimi, akışla yazma, boyut sınırı, Range/206), hekim medyasında
 * yüklenen video + poster + altyazı, anasayfa yorum özeti (ülkeler, ziyaretçi dili önce) ve "Tüm yorumlar" listesi.
 */
let ipCounter = 0;
const nextIp = () => `10.81.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
/** Medya URL'si PUBLIC_URL ile mutlak ya da göreli olabilir; inject için yol kısmı. */
const mediaPath = (url: string) => url.replace(/^https?:\/\/[^/]+/, "");

vi.mock("../../src/lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/mail")>();
  return { ...actual, sendMail: () => Promise.resolve({ messageId: "test" }) };
});

// --- en küçük geçerli ISO-BMFF yapısı -------------------------------------------------------------
function box(type: string, ...children: Buffer[]): Buffer {
  const body = Buffer.concat(children);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
}
function fullBoxPayload(bytes: number[]): Buffer {
  return Buffer.from(bytes);
}
function ftyp(brand = "isom"): Buffer {
  return box("ftyp", Buffer.from(brand, "latin1"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2mp41", "latin1"));
}
function moov(codec = "avc1", durationMs = 5000): Buffer {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12); // timescale
  mvhd.writeUInt32BE(durationMs, 16); // duration
  const hdlr = Buffer.concat([Buffer.alloc(8), Buffer.from("vide", "latin1"), Buffer.alloc(13)]);
  const stsdEntry = box(codec, Buffer.alloc(78));
  const stsd = box("stsd", fullBoxPayload([0, 0, 0, 0, 0, 0, 0, 1]), stsdEntry);
  return box("moov", box("mvhd", mvhd), box("trak", box("mdia", box("hdlr", hdlr), box("minf", box("stbl", stsd)))));
}
function mp4(opts: { codec?: string; moovAtEnd?: boolean; brand?: string; mdatBytes?: number } = {}): Buffer {
  const mdat = box("mdat", crypto.randomBytes(opts.mdatBytes ?? 4096));
  const m = moov(opts.codec ?? "avc1");
  return Buffer.concat(opts.moovAtEnd ? [ftyp(opts.brand), mdat, m] : [ftyp(opts.brand), m, mdat]);
}

describe("Paket AE — video yükleme, yüklenen hekim videosu ve yorum listesi", () => {
  let app: FastifyInstance;
  let admin: { id: string; email: string; token: string };
  let editor: { id: string; email: string; token: string };
  const stored: string[] = [];

  async function user(role: "ADMIN" | "EDITOR") {
    const { hashPassword } = await import("../../src/lib/password");
    const { signAccessToken } = await import("../../src/lib/jwt");
    const u = await app.prisma.user.create({
      data: { email: `ae-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`, name: `AE ${role}`, passwordHash: await hashPassword("Sifre12345!"), role, status: "ACTIVE", emailVerifiedAt: new Date(), twoFactorEnabled: true },
    });
    return { id: u.id, email: u.email, token: signAccessToken({ sub: u.id, email: u.email }).token };
  }

  async function doctor(over: { fullName?: string } = {}) {
    const specialty = await app.prisma.specialty.create({ data: { name: `S ${crypto.randomUUID()}`, slug: `s-${crypto.randomUUID()}`, icon: "Heart" } });
    return app.prisma.doctorProfile.create({
      data: { title: "Op. Dr.", fullName: over.fullName ?? "Mehmet DEMİR", bio: "Test.", slug: `ae-${crypto.randomUUID().slice(0, 8)}`, languages: ["tr"], timeZone: "Europe/Istanbul", specialtyId: specialty.id, sessionDurationMin: 30, sessionPriceCents: 50000, currency: "EUR", isActive: true },
    });
  }

  async function uploadVideo(content: Buffer, opts: { token?: string; filename?: string; contentType?: string } = {}) {
    const { body, contentType } = buildMultipartPayload({ file: { filename: opts.filename ?? "klinik.mp4", contentType: opts.contentType ?? "video/mp4", content } });
    const res = await app.inject({ method: "POST", url: "/api/v1/admin/media/video", headers: { ...auth(opts.token ?? admin.token), "content-type": contentType }, payload: body, remoteAddress: nextIp() });
    if (res.statusCode === 201) stored.push((await app.prisma.media.findUniqueOrThrow({ where: { id: res.json().data.media.id } })).path);
    return res;
  }

  async function setMaxMb(mb: number) {
    const res = await app.inject({ method: "PUT", url: "/api/v1/admin/telehealth/settings/doctor-media", headers: auth(admin.token), payload: { maxVideoUploadMb: mb } });
    expect(res.statusCode).toBe(200);
  }

  async function leftoverTempFiles() {
    const inUploads = (await fs.readdir(UPLOAD_DIR)).filter((f) => f.startsWith(".upload-"));
    const inOriginals = (await fs.readdir(ORIGINALS_DIR).catch(() => [] as string[])).filter((f) => f.endsWith(".part"));
    return [...inUploads, ...inOriginals];
  }

  /**
   * Paket AE-ek — yüklenen video önce "processing" olur ve kuyrukta H.264 MP4'e dönüştürülür. Testte ffmpeg taklit
   * edilir: çıktı olarak `output` (varsayılan: H.264, faststart) yazılır. Dönüştürülmüş dosyalar test sonunda silinir.
   */
  async function transcodeAll(output: Buffer = mp4()) {
    const deps: TranscodeDeps = {
      transcode: async (_input, out) => fs.writeFile(out, output),
      extractPoster: async (_input, out) => fs.writeFile(out, await sharp({ create: { width: 32, height: 18, channels: 3, background: "#123" } }).png().toBuffer()),
      isConsultationActive: async () => false,
      now: () => new Date(Date.now() + 1000),
    };
    for (let i = 0; i < 20; i++) {
      const r = await runNextTranscodeJob(app, deps);
      if (r.status === "idle") break;
    }
    for (const m of await app.prisma.media.findMany({ where: { OR: [{ mimeType: "video/mp4" }, { variants: { not: Prisma.DbNull } }] } })) {
      if (m.path) stored.push(m.path, ...((m.variants as { path: string }[] | null) ?? []).map((v) => v.path));
    }
  }

  beforeAll(async () => {
    const { buildApp } = await import("../../src/app");
    app = await buildApp();
    await app.ready();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    admin = await user("ADMIN");
    editor = await user("EDITOR");
  });

  afterEach(async () => {
    for (const p of stored.splice(0)) await fs.unlink(path.join(UPLOAD_DIR, p)).catch(() => undefined);
  });

  afterAll(async () => {
    // Paket AE-ek — kuyrukta kalan orijinaller (özel klasör) silinir.
    for (const j of await app.prisma.mediaTranscodeJob.findMany({ where: { sourcePath: { not: null } } })) await fs.unlink(sourceFilePath(j.sourcePath!)).catch(() => undefined);
    await resetDatabase(app.prisma);
    await app.close();
    vi.resetModules();
  });

  describe("POST /admin/media/video", () => {
    it("MP4 kabul edilir: önce 'işleniyor' (herkese açık dosya yok), dönüştürme sonrası rastgele adlı .mp4; özgün ad saklanmaz", async () => {
      const res = await uploadVideo(mp4(), { filename: "Ayşe Yılmaz muayene.mp4" });
      expect(res.statusCode).toBe(201);
      const { media, video, warnings, processing } = res.json().data;
      expect([media.mimeType, media.processingStatus, processing.status]).toEqual(["video/mp4", "processing", "processing"]);
      expect(media.filename).not.toMatch(/Ayşe|muayene/);
      expect(video).toEqual({ codec: "avc1", faststart: true, durationSec: 5 });
      expect(warnings).toEqual([]);
      await transcodeAll();
      const row = await app.prisma.media.findUniqueOrThrow({ where: { id: media.id } });
      expect(row.url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.mp4$/);
      expect([row.processingStatus, row.videoCodec, row.videoFaststart, row.durationSec]).toEqual(["ready", "avc1", true, 5]);
    });

    it("Paket AE-ek: HEVC ya da moov-sonda video uyarısız kabul edilir (sunucu H.264/faststart'a dönüştürür)", async () => {
      const res = await uploadVideo(mp4({ codec: "hvc1", moovAtEnd: true }));
      expect(res.statusCode).toBe(201);
      expect(res.json().data.warnings).toEqual([]);
      expect(res.json().data.video).toMatchObject({ codec: "hvc1", faststart: false });
    });

    it("MP4 olmayan içerik (beyan video/mp4 olsa da) reddedilir; geçici dosya kalmaz", async () => {
      for (const [content, name] of [
        [Buffer.from("<html><script>alert(1)</script></html>".padEnd(200, " ")), "evil.mp4"],
        [Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(200)]), "video.webm"],
        [Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(200)]), "foto.mp4"],
      ] as const) {
        const res = await uploadVideo(content, { filename: name });
        expect(res.statusCode, name).toBe(422);
      }
      expect((await uploadVideo(Buffer.from("<html>".padEnd(200, " ")))).json().error.message).toBe("Yalnızca MP4 ya da MOV (iPhone) video yükleyebilirsiniz.");
      expect(await leftoverTempFiles()).toEqual([]);
    });

    it("boyut sınırı admin ayarından gelir: varsayılan 100 MB üstü 413; düşük ayarda akış sırasında kesilir", async () => {
      const big = Buffer.alloc(101 * 1024 * 1024);
      ftyp().copy(big, 0);
      const res = await uploadVideo(big);
      expect(res.statusCode).toBe(413);
      expect(res.json().error.message).toBe("Video en fazla 100 MB olabilir.");

      await setMaxMb(1);
      const over = await uploadVideo(mp4({ mdatBytes: Math.round(1.5 * 1024 * 1024) }));
      expect(over.statusCode).toBe(413);
      expect(over.json().error.message).toBe("Video en fazla 1 MB olabilir.");
      expect(await leftoverTempFiles()).toEqual([]);
      expect((await uploadVideo(mp4({ mdatBytes: 512 * 1024 }))).statusCode).toBe(201);
      await setMaxMb(100);
    });

    it("yalnızca ADMIN/MANAGER; EDITOR 403, oturumsuz 401", async () => {
      expect((await uploadVideo(mp4(), { token: editor.token })).statusCode).toBe(403);
      const { body, contentType } = buildMultipartPayload({ file: { filename: "a.mp4", contentType: "video/mp4", content: mp4() } });
      expect((await app.inject({ method: "POST", url: "/api/v1/admin/media/video", headers: { "content-type": contentType }, payload: body })).statusCode).toBe(401);
    });

    it("oynatma: /uploads Range isteğine 206, video/mp4, Accept-Ranges, uzun önbellek; indirmeye zorlanmaz", async () => {
      const content = mp4();
      const res = await uploadVideo(mp4({ codec: "hvc1" }));
      await transcodeAll(content);
      const url = mediaPath((await app.prisma.media.findUniqueOrThrow({ where: { id: res.json().data.media.id } })).url);
      const full = await app.inject({ method: "GET", url, remoteAddress: nextIp() });
      expect(full.statusCode).toBe(200);
      expect(full.headers["accept-ranges"]).toBe("bytes");
      const part = await app.inject({ method: "GET", url, headers: { range: "bytes=0-99" }, remoteAddress: nextIp() });
      expect(part.statusCode).toBe(206);
      expect(part.headers["content-range"]).toBe(`bytes 0-99/${content.length}`);
      expect(part.headers["content-length"]).toBe("100");
      expect(part.headers["content-type"]).toBe("video/mp4");
      expect(part.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      expect(part.headers["content-disposition"]).toBeUndefined();
      expect(part.headers["x-content-type-options"]).toBe("nosniff");
      expect(part.rawPayload.equals(content.subarray(0, 100))).toBe(true);
    });

    it("medya listesi type=video filtresi yalnızca MP4 döner", async () => {
      await uploadVideo(mp4());
      const list = await app.inject({ method: "GET", url: "/api/v1/admin/media?type=video", headers: auth(admin.token) });
      expect(list.statusCode).toBe(200);
      expect(list.json().data.length).toBeGreaterThan(0);
      expect(new Set(list.json().data.map((m: { mimeType: string }) => m.mimeType))).toEqual(new Set(["video/mp4"]));
    });
  });

  describe("POST /admin/media/captions", () => {
    async function uploadVtt(content: string) {
      const { body, contentType } = buildMultipartPayload({ file: { filename: "tr.vtt", contentType: "text/vtt", content: Buffer.from(content) } });
      const res = await app.inject({ method: "POST", url: "/api/v1/admin/media/captions", headers: { ...auth(admin.token), "content-type": contentType }, payload: body, remoteAddress: nextIp() });
      if (res.statusCode === 201) stored.push((await app.prisma.media.findUniqueOrThrow({ where: { id: res.json().data.id } })).path);
      return res;
    }

    it("WebVTT kabul edilir (text/vtt, .vtt); WEBVTT ile başlamayan reddedilir", async () => {
      const ok = await uploadVtt("WEBVTT\n\n00:00.000 --> 00:02.000\nMerhaba\n");
      expect(ok.statusCode).toBe(201);
      expect([ok.json().data.mimeType, ok.json().data.url.endsWith(".vtt")]).toEqual(["text/vtt", true]);
      const served = await app.inject({ method: "GET", url: mediaPath(ok.json().data.url), remoteAddress: nextIp() });
      expect(served.headers["content-type"]).toMatch(/^text\/vtt/);
      expect(served.headers["content-disposition"]).toBeUndefined();
      expect((await uploadVtt("<script>alert(1)</script>")).statusCode).toBe(422);
      expect((await uploadVtt("WEBVTTX\n")).statusCode).toBe(422);
    });
  });

  describe("hekim medyası: yüklenen video + poster + altyazı", () => {
    it("admin kaydeder; showcase'te videoUrl/poster/altyazı döner, embedUrl yok; yanlış türler reddedilir", async () => {
      const d = await doctor();
      const video = (await uploadVideo(mp4({ codec: "hvc1" }))).json().data.media;
      const jpeg = await sharp({ create: { width: 16, height: 9, channels: 3, background: "#456" } }).jpeg().toBuffer();
      const { body, contentType } = buildMultipartPayload({ file: { filename: "poster.jpg", contentType: "image/jpeg", content: jpeg } });
      const poster = (await app.inject({ method: "POST", url: "/api/v1/admin/media", headers: { ...auth(admin.token), "content-type": contentType }, payload: body })).json().data;
      const posterRow = await app.prisma.media.findUniqueOrThrow({ where: { id: poster.id } });
      stored.push(posterRow.path, ...((posterRow.variants as { path: string }[] | null) ?? []).map((v) => v.path));
      const vtt = buildMultipartPayload({ file: { filename: "tr.vtt", contentType: "text/vtt", content: Buffer.from("WEBVTT\n") } });
      const captions = (await app.inject({ method: "POST", url: "/api/v1/admin/media/captions", headers: { ...auth(admin.token), "content-type": vtt.contentType }, payload: vtt.body, remoteAddress: nextIp() })).json().data;
      stored.push((await app.prisma.media.findUniqueOrThrow({ where: { id: captions.id } })).path);

      const base = `/api/v1/admin/telehealth/doctors/${d.id}/media`;
      const payload = { kind: "video", videoProvider: "upload", mediaId: video.id, posterMediaId: poster.id, captionsMediaId: captions.id, captionsLang: "tr", category: "clinic", translations: { tr: { title: "Klinik turu", description: "", alt: "" } }, isPublished: true };
      // Yanlış türler: MP4 yerine görsel, poster yerine MP4, altyazı yerine görsel; altyazı dili eksik.
      expect((await app.inject({ method: "POST", url: base, headers: auth(admin.token), payload: { ...payload, mediaId: poster.id } })).statusCode).toBe(422);
      expect((await app.inject({ method: "POST", url: base, headers: auth(admin.token), payload: { ...payload, posterMediaId: video.id } })).statusCode).toBe(422);
      expect((await app.inject({ method: "POST", url: base, headers: auth(admin.token), payload: { ...payload, captionsMediaId: poster.id } })).statusCode).toBe(422);
      expect((await app.inject({ method: "POST", url: base, headers: auth(admin.token), payload: { ...payload, captionsLang: null } })).statusCode).toBe(422);

      const created = await app.inject({ method: "POST", url: base, headers: auth(admin.token), payload });
      expect(created.statusCode).toBe(201);
      const adminDto = created.json().data;
      expect([adminDto.videoProvider, adminDto.videoId, adminDto.thumbnailMediaId, adminDto.captionsLang]).toEqual(["upload", null, poster.id, "tr"]);
      expect(adminDto.video).toEqual({ codec: "hvc1", faststart: true, durationSec: 5 });
      expect(adminDto.processing).toMatchObject({ status: "processing", jobStatus: "queued" });
      expect(adminDto.captionsUrl).toMatch(/\.vtt$/);
      // Paket AE-ek — dönüştürme bitene kadar sitede görünmez.
      expect((await app.inject({ method: "GET", url: `/api/v1/doctors/${d.slug}/showcase?locale=tr`, remoteAddress: nextIp() })).json().data.media).toEqual([]);
      await transcodeAll();

      const show = (await app.inject({ method: "GET", url: `/api/v1/doctors/${d.slug}/showcase?locale=tr`, remoteAddress: nextIp() })).json().data;
      expect(show.media).toHaveLength(1);
      expect(show.media[0]).toMatchObject({ kind: "video", videoProvider: "upload", videoId: null, embedUrl: null, captionsLang: "tr", durationSec: 5 });
      expect(show.media[0].videoUrl).toMatch(/\/uploads\/[0-9a-f-]{36}\.mp4$/);
      expect(show.media[0].thumbnailUrl).toMatch(/\.webp$/); // admin posteri korunur (WebP'ye çevrilmiş)
      expect(show.media[0].captionsUrl).toMatch(/\.vtt$/);

      // Video Media silinirse öğe sitede görünmez (SetNull → savunmalı DTO).
      await app.prisma.media.delete({ where: { id: video.id } });
      expect((await app.inject({ method: "GET", url: `/api/v1/doctors/${d.slug}/showcase`, remoteAddress: nextIp() })).json().data.media).toEqual([]);
    });

    it("ayar: kısmi PUT diğer alanı korur; aralık dışı değer 422", async () => {
      const put = (payload: Record<string, unknown>) => app.inject({ method: "PUT", url: "/api/v1/admin/telehealth/settings/doctor-media", headers: auth(admin.token), payload });
      expect((await put({ beforeAfterEnabled: true })).json().data).toEqual({ beforeAfterEnabled: true, maxVideoUploadMb: 100 });
      expect((await put({ maxVideoUploadMb: 250 })).json().data).toEqual({ beforeAfterEnabled: true, maxVideoUploadMb: 250 });
      expect((await put({ maxVideoUploadMb: 0 })).statusCode).toBe(422);
      expect((await put({ maxVideoUploadMb: 501 })).statusCode).toBe(422);
      await put({ beforeAfterEnabled: false, maxVideoUploadMb: 100 });
    });
  });

  describe("yorumlar: anasayfa özeti ve /reviews listesi", () => {
    const NOTE = "AE test";
    async function review(doctorId: string, over: { language: string; country?: string | null; rating?: number; daysAgo?: number; featured?: boolean; title?: string; status?: string }) {
      return app.prisma.testimonial.create({
        data: {
          doctorId,
          source: "imported",
          consentAt: new Date(),
          consentEvidenceNote: NOTE,
          status: over.status ?? "approved",
          displayMode: "custom",
          authorDisplay: "A. B.",
          country: over.country === undefined ? "DE" : over.country,
          language: over.language,
          rating: over.rating ?? 5,
          title: over.title ?? "",
          body: "Görüşme zamanında başladı ve sorularım yanıtlandı. (test metni)",
          featuredOnHome: over.featured ?? true,
          publishedAt: new Date(Date.now() - (over.daysAgo ?? 0) * 86_400_000),
        },
      });
    }

    it("featured: ülke özeti (ilk 6 + kalan), ziyaretçi dili önce, başlık otomatik üretilmez, hekim bağlantısı", async () => {
      await app.prisma.testimonial.deleteMany({});
      const d = await doctor({ fullName: "Ayşe KAYA" });
      const countries = ["DE", "DE", "DE", "TR", "TR", "GB", "FR", "NL", "SA", "AT", "CH"];
      for (const [i, c] of countries.entries()) await review(d.id, { language: i % 3 === 0 ? "tr" : "en", country: c, daysAgo: i });
      await review(d.id, { language: "ar", country: null, daysAgo: 20 });
      await review(d.id, { language: "tr", country: "AZ", status: "pending" });

      const res = await app.inject({ method: "GET", url: "/api/v1/reviews/featured?locale=ar", remoteAddress: nextIp() });
      const data = res.json().data;
      expect(data.countries.codes.slice(0, 2)).toEqual(["DE", "TR"]);
      expect(data.countries.codes).toHaveLength(6);
      expect(data.countries.more).toBe(8 - 6); // DE TR GB FR NL SA AT CH = 8 ülke; bekleyen AZ ve ülkesiz yorum sayılmaz
      expect(data.items[0].language).toBe("ar"); // en eski olsa da ziyaretçi dili önce
      expect(data.items[0].title).toBe("");
      expect(data.items[0].doctor).toEqual({ name: "Op. Dr. A. Kaya", slug: d.slug });
      expect(data.summary.count).toBe(12);
    });

    it("/reviews: hekim/dil/en az puan filtresi, sayfalama, ziyaretçi dili önce, bilinmeyen hekim boş liste", async () => {
      await app.prisma.testimonial.deleteMany({});
      const d1 = await doctor({ fullName: "Ali VELİ" });
      const d2 = await doctor({ fullName: "Can CAN" });
      for (let i = 0; i < 15; i++) await review(d1.id, { language: "en", rating: i % 2 ? 5 : 3, daysAgo: i });
      for (let i = 0; i < 5; i++) await review(d2.id, { language: "tr", rating: 4, daysAgo: 30 + i });

      const get = async (q: string) => (await app.inject({ method: "GET", url: `/api/v1/reviews?${q}`, remoteAddress: nextIp() })).json().data;
      const p1 = await get("locale=tr&page=1");
      expect([p1.total, p1.pageSize, p1.items.length]).toEqual([20, 12, 12]);
      expect(p1.items.slice(0, 5).every((r: { language: string }) => r.language === "tr")).toBe(true);
      expect(p1.items[5].language).toBe("en");
      const p2 = await get("locale=tr&page=2");
      expect(p2.items).toHaveLength(8);
      const ids = new Set([...p1.items, ...p2.items].map((r: { id: string }) => r.id));
      expect(ids.size).toBe(20); // sayfalar arasında tekrar/eksik yok

      expect((await get(`doctor=${d2.slug}`)).total).toBe(5);
      expect((await get("language=en")).total).toBe(15);
      expect((await get("minRating=4")).total).toBe(7 + 5);
      expect((await get("doctor=yok-boyle-hekim")).items).toEqual([]);
      const all = await get("locale=en");
      expect(all.doctors.map((x: { slug: string; count: number }) => [x.slug, x.count])).toEqual([
        [d1.slug, 15],
        [d2.slug, 5],
      ]);
      expect(all.languages).toEqual([
        { code: "en", count: 15 },
        { code: "tr", count: 5 },
      ]);
      expect((await app.inject({ method: "GET", url: "/api/v1/reviews?minRating=9", remoteAddress: nextIp() })).statusCode).toBe(422);
    });
  });
});
