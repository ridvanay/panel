import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { reviewerDisplayName } from "../../src/modules/blog/lib/blog-public";
import { issueSessionToken, PREVIEW_SESSION_TTL_SEC } from "../../src/modules/blog/lib/preview-token";
import { hashToken } from "../../src/lib/tokens";
import { beforeAll as __ahBefore, afterAll as __ahAfter } from "vitest";
import { blogDoctorVisibility } from "../../src/modules/blog/lib/blog-public";
// Paket AH: public blog yanitlarinda hekim varsayilan GIZLI; bu dosya eski Z1 hekim gosterimini sinar.
__ahBefore(() => { blogDoctorVisibility.visible = true; });
__ahAfter(() => { blogDoctorVisibility.visible = false; });

/** Blog taslak önizleme: paylaşım belirteci (7 gün, iptal edilebilir), oturum belirteci (30 dk), yetkiler, sızıntı yok. */
describe("blog taslak önizleme", () => {
  let app: FastifyInstance;
  let admin: { authorization: string };
  let editor: { authorization: string };
  let plainUser: { authorization: string };
  let doctorAuth: { authorization: string };
  let otherDoctorAuth: { authorization: string };
  let reviewerId: string;

  async function createUser(role: "USER" | "EDITOR", twoFactor: boolean) {
    const { hashPassword } = await import("../../src/lib/password");
    const user = await app.prisma.user.create({
      data: {
        email: `pv-${crypto.randomUUID()}@example.com`,
        name: "Kullanıcı",
        passwordHash: await hashPassword("Sifre12345!"),
        role,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: "Sifre12345!" } });
    if (twoFactor) await app.prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    return { user, auth: { authorization: `Bearer ${login.json().data.tokens.accessToken as string}` } };
  }

  async function seedDraft(over: Record<string, unknown> = {}) {
    const slug = `pv-${crypto.randomUUID().slice(0, 8)}`;
    return app.prisma.blogPost.create({
      data: {
        title: `Taslak ${slug}`,
        slug,
        excerpt: "Özet",
        contentHtml: "<h2>Bir</h2><p>taslak metni</p>",
        status: "DRAFT",
        reviewerDoctorId: reviewerId,
        medicalReviewStatus: "pending",
        readingMinutes: 1,
        ...over,
      } as never,
    });
  }

  const createLink = async (id: string, headers = admin) =>
    app.inject({ method: "POST", url: `/api/v1/admin/blog/${id}/preview-link`, headers });
  // Paket AP — belirteç `X-Access-Token` başlığında (eski `?t=` biçimi `ap-token-transport.test.ts`'te).
  const open = (id: string, t?: string, extra = "") =>
    app.inject({ method: "GET", url: `/api/v1/blog/preview/${id}${extra ? `?${extra.slice(1)}` : ""}`, headers: t !== undefined ? { "x-access-token": t } : {} });
  const shareToken = async (id: string) => (await createLink(id)).json().data.token as string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    admin = { authorization: `Bearer ${(await registerTestUser(app)).accessToken}` };
    editor = (await createUser("EDITOR", false)).auth;
    plainUser = (await createUser("USER", false)).auth;
    const d1 = await createUser("USER", true);
    doctorAuth = d1.auth;
    const d2 = await createUser("USER", true);
    otherDoctorAuth = d2.auth;
    reviewerId = (
      await app.prisma.doctorProfile.create({
        data: {
          title: "Prof. Dr.",
          fullName: "Hasan SOFU",
          slug: `pv-${crypto.randomUUID()}`,
          bio: "Test",
          languages: ["en"],
          userId: d1.user.id,
          translations: { en: { title: "Prof." } },
        },
      })
    ).id;
    await app.prisma.doctorProfile.create({
      data: { title: "Dr.", fullName: "Ayşe Demir", slug: `pv-${crypto.randomUUID()}`, bio: "Test", languages: ["en"], userId: d2.user.id },
    });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  describe("reddedilen durumlar (hepsi aynı 404)", () => {
    it("belirteçsiz, yanlış, bozuk ve boş belirteç 404; gövde aynı", async () => {
      const post = await seedDraft();
      await shareToken(post.id);
      const responses = await Promise.all([
        open(post.id),
        open(post.id, ""),
        open(post.id, "s_yanlis"),
        open(post.id, `s_${crypto.randomBytes(32).toString("base64url")}`),
        open(post.id, "p_v1.x.y"),
        open(post.id, "rastgele"),
        open(post.id, "p_v1." + post.id + ".9999999999.admin.AAAA"),
        open("yok-boyle-bir-id", "s_x"),
        open(crypto.randomUUID(), "s_x"),
      ]);
      for (const res of responses) expect(res.statusCode).toBe(404);
      const bodies = new Set(responses.map((r) => JSON.stringify(r.json().error)));
      expect(bodies.size).toBe(1);
    });

    it("başka yazının paylaşım ve oturum belirteci 404", async () => {
      const a = await seedDraft();
      const b = await seedDraft();
      const tokenA = await shareToken(a.id);
      expect((await open(a.id, tokenA)).statusCode).toBe(200);
      expect((await open(b.id, tokenA)).statusCode).toBe(404);

      const sessionA = (await app.inject({ method: "POST", url: `/api/v1/admin/blog/${a.id}/preview-session`, headers: admin })).json().data.token as string;
      expect((await open(a.id, sessionA)).statusCode).toBe(200);
      expect((await open(b.id, sessionA)).statusCode).toBe(404);
    });

    it("süresi dolmuş paylaşım belirteci 404", async () => {
      const post = await seedDraft();
      const token = await shareToken(post.id);
      expect((await open(post.id, token)).statusCode).toBe(200);
      await app.prisma.blogPost.update({ where: { id: post.id }, data: { previewTokenExpiresAt: new Date(Date.now() - 1000) } });
      expect((await open(post.id, token)).statusCode).toBe(404);
      const status = await app.inject({ method: "GET", url: `/api/v1/admin/blog/${post.id}/preview-link`, headers: admin });
      expect(status.json().data).toEqual({ active: false, expiresAt: null, createdAt: null });
    });

    it("iptal edilen bağlantı 404; yeniden oluşturma eskisini geçersiz kılar", async () => {
      const post = await seedDraft();
      const first = await shareToken(post.id);
      const second = await shareToken(post.id);
      expect(first).not.toBe(second);
      expect((await open(post.id, first)).statusCode).toBe(404);
      expect((await open(post.id, second)).statusCode).toBe(200);

      const del = await app.inject({ method: "DELETE", url: `/api/v1/admin/blog/${post.id}/preview-link`, headers: admin });
      expect(del.statusCode).toBe(204);
      expect((await open(post.id, second)).statusCode).toBe(404);
      const row = await app.prisma.blogPost.findUniqueOrThrow({ where: { id: post.id } });
      expect(row.previewTokenHash).toBeNull();
      expect(row.previewTokenExpiresAt).toBeNull();
    });

    it("süresi dolmuş oturum belirteci 404; geçerlisi 200", async () => {
      const post = await seedDraft();
      const past = Date.now() - (PREVIEW_SESSION_TTL_SEC + 5) * 1000;
      expect((await open(post.id, issueSessionToken(post.id, "admin", past).token)).statusCode).toBe(404);
      expect((await open(post.id, issueSessionToken(post.id, "admin").token)).statusCode).toBe(200);
    });

    it("imzası kurcalanmış oturum belirteci 404 (exp uzatma / amaç değiştirme)", async () => {
      const post = await seedDraft();
      const { token } = issueSessionToken(post.id, "admin");
      const parts = token.slice(2).split(".");
      const extended = `p_${[parts[0], parts[1], String(Number(parts[2]) + 100000), parts[3], parts[4]].join(".")}`;
      const swapped = `p_${[parts[0], parts[1], parts[2], "doctor", parts[4]].join(".")}`;
      expect((await open(post.id, extended)).statusCode).toBe(404);
      expect((await open(post.id, swapped)).statusCode).toBe(404);
    });

    it("çöpteki yazı 404; geri yüklenince tekrar açılır", async () => {
      const post = await seedDraft();
      const token = await shareToken(post.id);
      await app.prisma.blogPost.update({ where: { id: post.id }, data: { deletedAt: new Date() } });
      expect((await open(post.id, token)).statusCode).toBe(404);
      expect((await createLink(post.id)).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `/api/v1/admin/blog/${post.id}/preview-session`, headers: admin })).statusCode).toBe(404);
      await app.prisma.blogPost.update({ where: { id: post.id }, data: { deletedAt: null } });
      expect((await open(post.id, token)).statusCode).toBe(200);
    });
  });

  describe("içerik", () => {
    it("DRAFT içerik döner; reviewer null, pendingReviewer unvan(izleyici dili)+görünen ad; başlıklar no-store + noindex", async () => {
      const post = await seedDraft({ translations: { en: { title: "English draft", contentHtml: "<p>english body</p>" } } });
      const token = await shareToken(post.id);
      const doctor = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: reviewerId } });

      const res = await open(post.id, token);
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
      const data = res.json().data;
      expect(data).toMatchObject({
        id: post.id,
        title: post.title,
        contentHtml: "<h2>Bir</h2><p>taslak metni</p>",
        preview: true,
        reviewer: null,
        reviewApproved: false,
        status: "DRAFT",
        lastReviewedAt: null,
      });
      expect(data.pendingReviewer).toMatchObject({ slug: doctor.slug, name: reviewerDisplayName(doctor, undefined), avatarUrl: null });
      expect(data).toHaveProperty("relatedPosts");
      expect(data).toHaveProperty("localizations");

      const en = await open(post.id, token, "&locale=en");
      expect(en.json().data.title).toBe("English draft");
      expect(en.json().data.pendingReviewer.name).toBe(reviewerDisplayName(doctor, "en"));
      expect(en.json().data.pendingReviewer.name).toContain("Prof.");

      // çevirisi olmayan dil: kanonik
      const de = await open(post.id, token, "&locale=de");
      expect(de.json().data.title).toBe(post.title);
    });

    it("reddedilen yanıtlarda da no-store + noindex başlıkları bulunur", async () => {
      const post = await seedDraft();
      const res = await open(post.id, "s_yanlis");
      expect(res.statusCode).toBe(404);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    });

    it("hekim onaylı ama yayında olmayan yazı: reviewer yine null, reviewApproved true", async () => {
      const post = await seedDraft({ medicalReviewStatus: "approved", lastReviewedAt: new Date() });
      const res = await open(post.id, await shareToken(post.id));
      expect(res.json().data).toMatchObject({ reviewer: null, reviewApproved: true, lastReviewedAt: null });
      expect(res.json().data.pendingReviewer).not.toBeNull();
    });

    it("hekimi olmayan yazıda pendingReviewer null; PUBLISHED/SCHEDULED yazı da açılır", async () => {
      const noDoctor = await seedDraft({ reviewerDoctorId: null, medicalReviewStatus: "not_required" });
      expect((await open(noDoctor.id, await shareToken(noDoctor.id))).json().data.pendingReviewer).toBeNull();
      const published = await seedDraft({ status: "PUBLISHED", publishedAt: new Date(), medicalReviewStatus: "approved" });
      const res = await open(published.id, await shareToken(published.id));
      expect(res.statusCode).toBe(200);
    });

    it("yayındaki + onaylı yazı: reviewer yayındaki detayla aynı, pendingReviewer null, status PUBLISHED", async () => {
      const when = new Date("2026-10-01T10:00:00.000Z");
      const published = await seedDraft({ status: "PUBLISHED", publishedAt: when, medicalReviewStatus: "approved", lastReviewedAt: when });
      const res = await open(published.id, await shareToken(published.id));
      const data = res.json().data;
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
      expect(data).toMatchObject({ status: "PUBLISHED", preview: true, reviewApproved: true, pendingReviewer: null, lastReviewedAt: when.toISOString() });
      const live = (await app.inject({ method: "GET", url: `/api/v1/blog/posts/${published.slug}` })).json().data;
      expect(data.reviewer).not.toBeNull();
      expect(data.reviewer).toEqual(live.reviewer);
    });

    it("DRAFT ve SCHEDULED: status döner, eski davranış (reviewer null, pendingReviewer dolu)", async () => {
      for (const status of ["DRAFT", "SCHEDULED"] as const) {
        const post = await seedDraft({ status, medicalReviewStatus: "approved", lastReviewedAt: new Date(), ...(status === "SCHEDULED" ? { publishedAt: new Date(Date.now() + 86_400_000) } : {}) });
        const data = (await open(post.id, await shareToken(post.id))).json().data;
        expect(data).toMatchObject({ status, reviewer: null, lastReviewedAt: null });
        expect(data.pendingReviewer).not.toBeNull();
      }
    });

    it("önizleme yazı durumunu, onayı, sayacı ve güncelleme zamanını DEĞİŞTİRMEZ", async () => {
      const post = await seedDraft();
      const before = await app.prisma.blogPost.findUniqueOrThrow({ where: { id: post.id } });
      const token = await shareToken(post.id); // yalnızca önizleme alanları değişir
      const mid = await app.prisma.blogPost.findUniqueOrThrow({ where: { id: post.id } });
      for (let i = 0; i < 3; i++) expect((await open(post.id, token)).statusCode).toBe(200);
      const after = await app.prisma.blogPost.findUniqueOrThrow({ where: { id: post.id } });
      expect(after).toEqual(mid);
      for (const key of ["status", "medicalReviewStatus", "lastReviewedAt", "viewCount", "publishedAt", "reviewerDoctorId", "contentHtml"] as const) {
        expect(after[key]).toEqual(before[key]);
      }
      expect(await app.prisma.pageView.count({ where: { postId: post.id } })).toBe(0);
    });
  });

  describe("yetkiler", () => {
    it("admin uçları: kimliksiz 401, panel rolü olmayan 403, editör ve admin serbest", async () => {
      const post = await seedDraft();
      const urls = [
        { method: "POST", url: `/api/v1/admin/blog/${post.id}/preview-link` },
        { method: "GET", url: `/api/v1/admin/blog/${post.id}/preview-link` },
        { method: "DELETE", url: `/api/v1/admin/blog/${post.id}/preview-link` },
        { method: "POST", url: `/api/v1/admin/blog/${post.id}/preview-session` },
      ] as const;
      for (const u of urls) {
        expect((await app.inject({ ...u })).statusCode).toBe(401);
        expect([401, 403]).toContain((await app.inject({ ...u, headers: plainUser })).statusCode);
        expect((await app.inject({ ...u, headers: plainUser })).statusCode).toBe(403);
      }
      expect((await createLink(post.id, editor)).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: `/api/v1/admin/blog/${post.id}/preview-session`, headers: editor })).statusCode).toBe(200);
    });

    it("var olmayan yazı için admin uçları 404", async () => {
      const id = crypto.randomUUID();
      expect((await createLink(id)).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: `/api/v1/admin/blog/${id}/preview-link`, headers: admin })).statusCode).toBe(404);
      expect((await app.inject({ method: "DELETE", url: `/api/v1/admin/blog/${id}/preview-link`, headers: admin })).statusCode).toBe(404);
    });

    it("durum ucu: etkin bağlantı için active/expiresAt/createdAt", async () => {
      const post = await seedDraft();
      const created = (await createLink(post.id)).json().data;
      const days = (new Date(created.expiresAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThanOrEqual(7);
      const status = (await app.inject({ method: "GET", url: `/api/v1/admin/blog/${post.id}/preview-link`, headers: admin })).json().data;
      expect(status.active).toBe(true);
      expect(status.expiresAt).toBe(created.expiresAt);
      expect(typeof status.createdAt).toBe("string");
      expect(created.token.startsWith("s_")).toBe(true);
    });

    it("doktor: yalnızca atanmış yazı için oturum belirteci; başkasının yazısı 404; kimliksiz 401", async () => {
      const post = await seedDraft();
      const url = `/api/v1/doctor/blog-reviews/${post.id}/preview-session`;
      expect((await app.inject({ method: "POST", url })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url, headers: otherDoctorAuth })).statusCode).toBe(404);

      const res = await app.inject({ method: "POST", url, headers: doctorAuth });
      expect(res.statusCode).toBe(200);
      const { token, expiresAt } = res.json().data;
      expect(token.startsWith("p_")).toBe(true);
      expect(new Date(expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(PREVIEW_SESSION_TTL_SEC * 1000);
      expect((await open(post.id, token)).statusCode).toBe(200);
      const other = await seedDraft();
      expect((await open(other.id, token)).statusCode).toBe(404);

      // hekim olmayan kullanıcı
      expect((await app.inject({ method: "POST", url, headers: plainUser })).statusCode).toBeGreaterThanOrEqual(403);
    });
  });

  describe("sızıntı yok", () => {
    it("DB'de düz belirteç yok (yalnızca SHA-256 özeti); audit'te belirteç yok", async () => {
      const post = await seedDraft();
      const token = await shareToken(post.id);
      const row = await app.prisma.blogPost.findUniqueOrThrow({ where: { id: post.id } });
      expect(row.previewTokenHash).toBe(hashToken(token));
      expect(JSON.stringify(row)).not.toContain(token);
      expect(row.previewTokenHash).toMatch(/^[0-9a-f]{64}$/);

      await app.inject({ method: "DELETE", url: `/api/v1/admin/blog/${post.id}/preview-link`, headers: admin });
      const audits = await app.prisma.auditLog.findMany({ where: { targetId: post.id, action: { startsWith: "blog.preview_link" } } });
      expect(audits.map((a) => a.action).sort()).toEqual(["blog.preview_link.created", "blog.preview_link.revoked"]);
      const dump = JSON.stringify(audits);
      expect(dump).not.toContain(token);
      expect(dump).not.toContain(hashToken(token));
      const created = audits.find((a) => a.action === "blog.preview_link.created")!;
      expect(created.metadata).toMatchObject({ postId: post.id });
      expect(created.metadata).toHaveProperty("expiresAt");
    });

    it("admin liste ve düzenleme yanıtları önizleme alanlarını sızdırmaz", async () => {
      const post = await seedDraft();
      await shareToken(post.id);
      const list = await app.inject({ method: "GET", url: "/api/v1/admin/blog", headers: admin });
      expect(JSON.stringify(list.json())).not.toContain("previewToken");
      const pub = await app.inject({ method: "GET", url: `/api/v1/blog/posts/${post.slug}` });
      expect(pub.statusCode).toBe(404); // taslak herkese açık okumada hâlâ görünmez
    });
  });
});
