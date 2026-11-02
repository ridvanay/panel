import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { runScheduledPublishSweep } from "../../src/lib/scheduled-publish";
import { computeReadingMinutes } from "../../src/modules/blog/lib/medical-review";
import { blogDoctorVisibility } from "../../src/modules/blog/lib/blog-public";

/**
 * Paket Z1 — profesyonel blog: yayın kuralı, hekim inceleme kuyruğu, public liste/topics/detay, readingMinutes.
 * Varsayılan dil test DB'sinde "tr" (kanonik), "en" çeviri dilidir.
 */
describe("Paket Z1 — blog tıbbi inceleme altyapısı", () => {
  let app: FastifyInstance;
  let admin: { authorization: string };
  let editor: { authorization: string };
  let doctorAuth: { authorization: string };
  let otherDoctorAuth: { authorization: string };
  let specialtyId: string;
  let otherSpecialtyId: string;
  let medicalCategoryId: string;
  let travelCategoryId: string;
  let topicId: string;
  let reviewerId: string;
  let otherReviewerId: string;
  let inactiveDoctorId: string;

  async function createUser(role: "USER" | "EDITOR", twoFactor: boolean) {
    const { hashPassword } = await import("../../src/lib/password");
    const user = await app.prisma.user.create({
      data: {
        email: `z1-${crypto.randomUUID()}@example.com`,
        name: "Kullanıcı",
        passwordHash: await hashPassword("Sifre12345!"),
        role,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: "Sifre12345!" } });
    // Giriş 2FA açılmadan ÖNCE yapılır (doctor-time-off.test.ts deseni); portal kapısı için sonradan açılır.
    if (twoFactor) await app.prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    return { user, auth: { authorization: `Bearer ${login.json().data.tokens.accessToken as string}` } };
  }

  async function createDoctor(data: { fullName: string; title?: string; userId?: string; specialtyId?: string | null; isActive?: boolean; translations?: object }) {
    return app.prisma.doctorProfile.create({
      data: {
        title: data.title ?? "Prof. Dr.",
        fullName: data.fullName,
        slug: `z1-${crypto.randomUUID()}`,
        bio: "Test",
        languages: ["en"],
        isActive: data.isActive ?? true,
        userId: data.userId ?? null,
        specialtyId: data.specialtyId === undefined ? specialtyId : data.specialtyId,
        translations: data.translations ?? {},
      },
    });
  }

  const adminPost = (payload: Record<string, unknown>, headers = admin) =>
    app.inject({ method: "POST", url: "/api/v1/admin/blog", headers, payload });
  const adminPatch = (id: string, payload: Record<string, unknown>, headers = admin) =>
    app.inject({ method: "PATCH", url: `/api/v1/admin/blog/${id}`, headers, payload });

  /** Doğrudan DB: yayınlanmış + hekim onaylı yazı (public testleri için). */
  async function seedPublished(over: Record<string, unknown> = {}) {
    const slug = `p-${crypto.randomUUID().slice(0, 8)}`;
    return app.prisma.blogPost.create({
      data: {
        title: `Başlık ${slug}`,
        slug,
        excerpt: "Özet metni",
        contentHtml: "<h2>Bir</h2><p>metin</p>",
        status: "PUBLISHED",
        publishedAt: new Date(),
        categoryId: medicalCategoryId,
        specialtyId,
        reviewerDoctorId: reviewerId,
        medicalReviewStatus: "approved",
        lastReviewedAt: new Date(),
        readingMinutes: 2,
        ...over,
      } as never,
    });
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // Paket AH — Z1 kuralı `blogMedicalReviewRequired` bayrağına bağlı (varsayılan false); bu dosyadaki Z1 testleri eski davranışı (true) sınar.
    await app.prisma.siteSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", blogMedicalReviewRequired: true }, update: { blogMedicalReviewRequired: true } });
    admin = { authorization: `Bearer ${(await registerTestUser(app)).accessToken}` };
    editor = (await createUser("EDITOR", false)).auth;

    specialtyId = (await app.prisma.specialty.create({ data: { name: "Cardiology", slug: "cardiology", icon: "heart-pulse", translations: { en: { name: "Cardiology EN" } } } })).id;
    otherSpecialtyId = (await app.prisma.specialty.create({ data: { name: "Dermatology", slug: "dermatology", icon: "sparkles" } })).id;
    medicalCategoryId = (await app.prisma.blogCategory.create({ data: { name: "Patient guide", slug: "patient-guide" } })).id;
    travelCategoryId = (await app.prisma.blogCategory.create({ data: { name: "Health travel guide", slug: "health-travel-guide", isMedical: false } })).id;
    topicId = (
      await app.prisma.careTopic.create({
        data: { slug: "chest-pain", bodyArea: "chest", translations: { en: { label: "Chest pain", description: "", synonyms: [] } } },
      })
    ).id;

    const doctorUser = await createUser("USER", true);
    doctorAuth = doctorUser.auth;
    reviewerId = (
      await createDoctor({ fullName: "Hasan SOFU", userId: doctorUser.user.id, translations: { en: { title: "Prof." } } })
    ).id;
    const otherUser = await createUser("USER", true);
    otherDoctorAuth = otherUser.auth;
    otherReviewerId = (await createDoctor({ fullName: "Ayşe Demir", userId: otherUser.user.id, specialtyId: otherSpecialtyId })).id;
    inactiveDoctorId = (await createDoctor({ fullName: "Pasif Hekim", isActive: false })).id;
    await createDoctor({ fullName: "Üçüncü Kardiyolog" });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  describe("yayın kuralı", () => {
    it("onaysız PUBLISHED ve SCHEDULED oluşturma 422 (alan: medicalReviewStatus); taslak serbest", async () => {
      const future = new Date(Date.now() + 3600_000).toISOString();
      const pub = await adminPost({ title: "Onaysız Yayın", status: "PUBLISHED", categoryId: medicalCategoryId });
      expect(pub.statusCode).toBe(422);
      expect(pub.json().error.details).toHaveProperty("medicalReviewStatus");

      const sched = await adminPost({ title: "Onaysız Zamanlama", status: "SCHEDULED", scheduledAt: future, categoryId: medicalCategoryId });
      expect(sched.statusCode).toBe(422);

      const draft = await adminPost({ title: "Taslak Serbest", categoryId: medicalCategoryId });
      expect(draft.statusCode).toBe(201);
      expect(draft.json().data).toMatchObject({ status: "DRAFT", medicalReviewStatus: "pending", keyTakeaways: [], faq: [], references: [], isFeatured: false });
    });

    it("DRAFT → PUBLISHED geçişi onay yoksa 422; hekim onayından sonra 200", async () => {
      const draft = await adminPost({ title: "Onay Bekleyen", categoryId: medicalCategoryId, reviewerDoctorId: reviewerId, specialtyId });
      const id = draft.json().data.id as string;
      expect(draft.json().data.medicalReviewStatus).toBe("pending");

      expect((await adminPatch(id, { status: "PUBLISHED" })).statusCode).toBe(422);

      const approve = await app.inject({ method: "POST", url: `/api/v1/doctor/blog-reviews/${id}/approve`, headers: doctorAuth });
      expect(approve.statusCode).toBe(200);
      expect(approve.json().data.medicalReviewStatus).toBe("approved");

      const publish = await adminPatch(id, { status: "PUBLISHED" });
      expect(publish.statusCode).toBe(200);
      expect(publish.json().data).toMatchObject({ status: "PUBLISHED", medicalReviewStatus: "approved", reviewerDoctorId: reviewerId });
      expect(publish.json().data.lastReviewedAt).not.toBeNull();
    });

    it("admin/editör doğrudan 'approved' ya da 'changes_requested' yazamaz (422)", async () => {
      const res = await adminPost({ title: "Kendi Onayı", medicalReviewStatus: "approved", reviewerDoctorId: reviewerId });
      expect(res.statusCode).toBe(422);
    });

    it("approved ama reviewer yok (reviewer silindi) → yayın 422", async () => {
      const post = await app.prisma.blogPost.create({
        data: { title: "Reviewersız", slug: "reviewersiz", categoryId: medicalCategoryId, medicalReviewStatus: "approved", reviewerDoctorId: null },
      });
      expect((await adminPatch(post.id, { status: "PUBLISHED" })).statusCode).toBe(422);
    });

    it("not_required: tıbbi kategoride 422, EDITOR için 403, ADMIN + tıbbi olmayan kategoride yayınlanabilir", async () => {
      const medical = await adminPost({ title: "Tıbbi NR", status: "PUBLISHED", categoryId: medicalCategoryId, medicalReviewStatus: "not_required" });
      expect(medical.statusCode).toBe(422);

      const noCategory = await adminPost({ title: "Kategorisiz NR", medicalReviewStatus: "not_required" });
      expect(noCategory.statusCode).toBe(422);

      const byEditor = await adminPost({ title: "Editör NR", categoryId: travelCategoryId, medicalReviewStatus: "not_required" }, editor);
      expect(byEditor.statusCode).toBe(403);

      const ok = await adminPost({ title: "Vize Rehberi", status: "PUBLISHED", categoryId: travelCategoryId, medicalReviewStatus: "not_required" });
      expect(ok.statusCode).toBe(201);
      expect(ok.json().data).toMatchObject({ status: "PUBLISHED", medicalReviewStatus: "not_required" });
    });

    it("not_required yazıda kategori tıbbiye çevrilirse 422", async () => {
      const post = await adminPost({ title: "NR Kategori Değişimi", categoryId: travelCategoryId, medicalReviewStatus: "not_required" });
      const res = await adminPatch(post.json().data.id, { categoryId: medicalCategoryId });
      expect(res.statusCode).toBe(422);
    });

    it("pasif hekim reviewer olarak atanamaz; geçersiz uzmanlık 422", async () => {
      expect((await adminPost({ title: "Pasif", reviewerDoctorId: inactiveDoctorId })).statusCode).toBe(422);
      expect((await adminPost({ title: "Uzmanlık", specialtyId: crypto.randomUUID() })).statusCode).toBe(422);
    });

    it("toplu yayın onaysız yazıları atlar (skippedIds), onaylıları yayınlar", async () => {
      const unapproved = (await adminPost({ title: "Toplu Onaysız", categoryId: medicalCategoryId })).json().data.id as string;
      const exempt = (await adminPost({ title: "Toplu Muaf", categoryId: travelCategoryId, medicalReviewStatus: "not_required" })).json().data.id as string;
      const res = await app.inject({ method: "POST", url: "/api/v1/admin/blog/bulk", headers: admin, payload: { ids: [unapproved, exempt], action: "publish" } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.skippedIds).toEqual([unapproved]);
      expect(res.json().data.affectedCount).toBe(1);
      expect((await app.prisma.blogPost.findUniqueOrThrow({ where: { id: unapproved } })).status).toBe("DRAFT");
      expect((await app.prisma.blogPost.findUniqueOrThrow({ where: { id: exempt } })).status).toBe("PUBLISHED");
    });

    it("zamanlanmış yayın sweeper'ı onaysız yazıyı yayınlamaz, onaylıyı yayınlar", async () => {
      const past = new Date(Date.now() - 60_000);
      const bad = await app.prisma.blogPost.create({
        data: { title: "Sweeper Onaysız", slug: "sweeper-onaysiz", status: "SCHEDULED", scheduledAt: past, categoryId: medicalCategoryId, medicalReviewStatus: "pending", reviewerDoctorId: reviewerId },
      });
      const nullStatus = await app.prisma.blogPost.create({
        data: { title: "Sweeper Eski Kayıt", slug: "sweeper-eski", status: "SCHEDULED", scheduledAt: past, categoryId: medicalCategoryId },
      });
      const good = await app.prisma.blogPost.create({
        data: { title: "Sweeper Onaylı", slug: "sweeper-onayli", status: "SCHEDULED", scheduledAt: past, categoryId: medicalCategoryId, medicalReviewStatus: "approved", reviewerDoctorId: reviewerId },
      });
      const exemptMedical = await app.prisma.blogPost.create({
        data: { title: "Sweeper NR Tıbbi", slug: "sweeper-nr-tibbi", status: "SCHEDULED", scheduledAt: past, categoryId: medicalCategoryId, medicalReviewStatus: "not_required" },
      });
      await runScheduledPublishSweep(app);
      const status = async (id: string) => (await app.prisma.blogPost.findUniqueOrThrow({ where: { id } })).status;
      expect(await status(bad.id)).toBe("SCHEDULED");
      expect(await status(nullStatus.id)).toBe("SCHEDULED");
      expect(await status(exemptMedical.id)).toBe("SCHEDULED");
      expect(await status(good.id)).toBe("PUBLISHED");
    });
  });

  describe("onaylı içerik değişince pending", () => {
    it("başlık/gövde/SSS/kaynak değişince pending; lastReviewedAt korunur, yayın düşmez; çeviri ve özet değişimi dokunmaz", async () => {
      const post = await seedPublished();
      const reviewedAt = post.lastReviewedAt!.toISOString();

      const excerptOnly = await adminPatch(post.id, { excerpt: "Yeni özet" });
      expect(excerptOnly.json().data.medicalReviewStatus).toBe("approved");

      const translationOnly = await adminPatch(post.id, { translations: { en: { title: "English title", contentHtml: "<p>english</p>" } } });
      expect(translationOnly.json().data.medicalReviewStatus).toBe("approved");

      const changed = await adminPatch(post.id, { contentHtml: "<h2>Bir</h2><p>başka metin</p>" });
      expect(changed.statusCode).toBe(200);
      expect(changed.json().data).toMatchObject({ medicalReviewStatus: "pending", status: "PUBLISHED", lastReviewedAt: reviewedAt });

      for (const [i, patch] of [
        { title: "Yeni başlık" },
        { faq: [{ question: "Soru?", answer: "Cevap." }] },
        { references: [{ title: "WHO", publisher: "WHO", url: "https://www.who.int/x", accessedAt: "2026-10-01" }] },
        { keyTakeaways: ["Madde"] },
      ].entries()) {
        await app.prisma.blogPost.update({ where: { id: post.id }, data: { medicalReviewStatus: "approved" } });
        const res = await adminPatch(post.id, patch);
        expect(res.json().data.medicalReviewStatus, `patch #${i}`).toBe("pending");
      }
    });

    it("reviewer değişince ve autosave ile gövde değişince de pending", async () => {
      const post = await seedPublished();
      const swap = await adminPatch(post.id, { reviewerDoctorId: otherReviewerId });
      expect(swap.json().data.medicalReviewStatus).toBe("pending");

      const other = await seedPublished();
      const autosave = await app.inject({ method: "POST", url: `/api/v1/admin/blog/${other.id}/autosave`, headers: admin, payload: { contentHtml: "<p>yeni</p>" } });
      expect(autosave.statusCode).toBe(200);
      expect((await app.prisma.blogPost.findUniqueOrThrow({ where: { id: other.id } })).medicalReviewStatus).toBe("pending");
    });
  });

  describe("readingMinutes ve zengin alan doğrulaması", () => {
    it("computeReadingMinutes: 200 kelime/dk, en az 1, etiketleri sayar değil", () => {
      expect(computeReadingMinutes("")).toBe(1);
      expect(computeReadingMinutes("<p>bir iki üç</p>")).toBe(1);
      expect(computeReadingMinutes(`<p>${"kelime ".repeat(200)}</p>`)).toBe(1);
      expect(computeReadingMinutes(`<p>${"kelime ".repeat(201)}</p>`)).toBe(2);
      expect(computeReadingMinutes(`<div><h2>x</h2><script>var a = 1 2 3 4;</script>${"w ".repeat(450)}</div>`)).toBe(3);
    });

    it("create/update/translation readingMinutes otomatik; reading-time önizleme ucu aynı formülü kullanır", async () => {
      const create = await adminPost({ title: "Süre", contentHtml: `<p>${"kelime ".repeat(450)}</p>` });
      expect(create.json().data.readingMinutes).toBe(3);
      const id = create.json().data.id as string;

      const update = await adminPatch(id, { contentHtml: "<p>kısa</p>", translations: { en: { title: "T", contentHtml: `<p>${"word ".repeat(500)}</p>` } } });
      expect(update.json().data.readingMinutes).toBe(1);
      expect(update.json().data.translations.en.readingMinutes).toBe(3);

      const preview = await app.inject({ method: "POST", url: "/api/v1/admin/blog/reading-time", headers: admin, payload: { html: `<p>${"a ".repeat(401)}</p>` } });
      expect(preview.json().data).toEqual({ minutes: 3 });
    });

    it("keyTakeaways/faq/references sınırları ve https zorunluluğu", async () => {
      const ref = { title: "T", publisher: "P", url: "https://www.who.int/a", accessedAt: "2026-10-01" };
      expect((await adminPost({ title: "R http", references: [{ ...ref, url: "http://www.who.int/a" }] })).statusCode).toBe(422);
      expect((await adminPost({ title: "R tarih", references: [{ ...ref, accessedAt: "01.10.2026" }] })).statusCode).toBe(422);
      expect((await adminPost({ title: "R 31", references: Array.from({ length: 31 }, () => ref) })).statusCode).toBe(422);
      expect((await adminPost({ title: "R 30", references: Array.from({ length: 30 }, () => ref) })).statusCode).toBe(201);
      expect((await adminPost({ title: "F 21", faq: Array.from({ length: 21 }, () => ({ question: "q", answer: "a" })) })).statusCode).toBe(422);
      expect((await adminPost({ title: "K 11", keyTakeaways: Array.from({ length: 11 }, () => "x") })).statusCode).toBe(422);

      const html = await adminPost({ title: "Düz Metin", keyTakeaways: ["<b>Kalın</b> madde"], faq: [{ question: "<i>S</i>?", answer: "<script>x</script>C" }] });
      expect(html.json().data.keyTakeaways).toEqual(["Kalın madde"]);
      expect(html.json().data.faq).toEqual([{ question: "S?", answer: "xC" }]);

      const badTranslation = await adminPatch(html.json().data.id, { translations: { en: { title: "T", keyTakeaways: "string" } } });
      expect(badTranslation.statusCode).toBe(422);
    });
  });

  describe("doktor inceleme kuyruğu", () => {
    it("doktor yalnızca kendisine atanan, onay bekleyen yazıları görür; başkasının yazısı 404", async () => {
      const mine = (await adminPost({ title: "Benim Kuyruk", categoryId: medicalCategoryId, reviewerDoctorId: reviewerId })).json().data.id as string;
      const theirs = (await adminPost({ title: "Onun Kuyruğu", categoryId: medicalCategoryId, reviewerDoctorId: otherReviewerId })).json().data.id as string;
      const legacy = await app.prisma.blogPost.create({ data: { title: "Eski Null", slug: "eski-null", reviewerDoctorId: reviewerId } });

      const list = await app.inject({ method: "GET", url: "/api/v1/doctor/blog-reviews", headers: doctorAuth });
      expect(list.statusCode).toBe(200);
      const ids = (list.json().data as { id: string }[]).map((p) => p.id);
      expect(ids).toContain(mine);
      expect(ids).toContain(legacy.id);
      expect(ids).not.toContain(theirs);
      expect(list.json().data.find((p: { id: string }) => p.id === mine)).toMatchObject({ title: "Benim Kuyruk", medicalReviewStatus: "pending" });

      for (const action of ["approve", "request-changes"]) {
        const res = await app.inject({ method: "POST", url: `/api/v1/doctor/blog-reviews/${theirs}/${action}`, headers: doctorAuth, payload: { note: "x" } });
        expect(res.statusCode, action).toBe(404);
      }
      expect((await app.prisma.blogPost.findUniqueOrThrow({ where: { id: theirs } })).medicalReviewStatus).toBe("pending");
    });

    it("request-changes notu saklar, kuyrukta kalır; audit'e not METNİ yazılmaz (yalnızca uzunluk)", async () => {
      const id = (await adminPost({ title: "Not Testi", categoryId: medicalCategoryId, reviewerDoctorId: reviewerId })).json().data.id as string;
      const note = "Lütfen ikinci bölümdeki kaynak ifadesini düzeltin.";
      const res = await app.inject({ method: "POST", url: `/api/v1/doctor/blog-reviews/${id}/request-changes`, headers: doctorAuth, payload: { note } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ medicalReviewStatus: "changes_requested", medicalReviewNote: note });

      const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "blog.medical_review.changes_requested", targetId: id } });
      expect(audit.actorEmail).toBeTruthy();
      expect(audit.metadata).toMatchObject({ postId: id, noteLength: note.length });
      expect(JSON.stringify(audit)).not.toContain("kaynak ifadesini");

      const list = await app.inject({ method: "GET", url: "/api/v1/doctor/blog-reviews", headers: doctorAuth });
      expect((list.json().data as { id: string }[]).map((p) => p.id)).toContain(id);

      expect((await app.inject({ method: "POST", url: `/api/v1/doctor/blog-reviews/${id}/request-changes`, headers: doctorAuth, payload: { note: "" } })).statusCode).toBe(422);
    });

    it("approve audit'e aktör, tarih ve postId yazar; notu temizler; kuyruktan düşer; ikinci approve 404", async () => {
      const id = (await adminPost({ title: "Onay Audit", categoryId: medicalCategoryId, reviewerDoctorId: reviewerId })).json().data.id as string;
      await app.inject({ method: "POST", url: `/api/v1/doctor/blog-reviews/${id}/request-changes`, headers: doctorAuth, payload: { note: "düzelt" } });

      const res = await app.inject({ method: "POST", url: `/api/v1/doctor/blog-reviews/${id}/approve`, headers: doctorAuth });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ medicalReviewStatus: "approved", medicalReviewNote: null });
      expect(res.json().data.lastReviewedAt).not.toBeNull();

      const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "blog.medical_review.approved", targetId: id } });
      expect(audit.actorId).toBeTruthy();
      expect(audit.createdAt).toBeInstanceOf(Date);
      expect(audit.metadata).toMatchObject({ postId: id });

      const list = await app.inject({ method: "GET", url: "/api/v1/doctor/blog-reviews", headers: doctorAuth });
      expect((list.json().data as { id: string }[]).map((p) => p.id)).not.toContain(id);
      expect((await app.inject({ method: "POST", url: `/api/v1/doctor/blog-reviews/${id}/approve`, headers: doctorAuth })).statusCode).toBe(404);
    });

    it("doktor profili olmayan kullanıcı kuyruğa erişemez; kimliksiz 401", async () => {
      const list = await app.inject({ method: "GET", url: "/api/v1/doctor/blog-reviews", headers: admin });
      expect([403, 404]).toContain(list.statusCode);
      expect((await app.inject({ method: "GET", url: "/api/v1/doctor/blog-reviews" })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: "/api/v1/doctor/blog-reviews", headers: otherDoctorAuth })).statusCode).toBe(200);
    });
  });

  describe("public okuma uçları", () => {
    let cardioIds: string[];
    let derm: { id: string };
    let enOnly: { id: string; slug: string };

    // Paket AH: public blog yanıtlarında hekim varsayılan GİZLİ; bu blok eski Z1 hekim gösterimini sınar.
    beforeAll(() => {
      blogDoctorVisibility.visible = true;
    });
    afterAll(() => {
      blogDoctorVisibility.visible = false;
    });

    beforeAll(async () => {
      // Önceki testlerde oluşan kayıtlar listeyi etkilemesin.
      await app.prisma.blogPost.deleteMany({});
      const base = Date.now();
      const rows = [];
      for (let i = 0; i < 5; i++) {
        rows.push(
          await seedPublished({
            title: `Kalp Rehberi ${i}`,
            slug: `kalp-rehberi-${i}`,
            publishedAt: new Date(base - i * 60_000),
            careTopicIds: i < 2 ? [topicId] : [],
          })
        );
      }
      cardioIds = rows.map((r) => r.id);
      derm = await seedPublished({ title: "Cilt Bakımı", slug: "cilt-bakimi", specialtyId: otherSpecialtyId, reviewerDoctorId: otherReviewerId });
      enOnly = await seedPublished({
        title: "Çevirili Yazı",
        slug: "cevirili-yazi",
        translations: {
          en: { title: "Translated Post", excerpt: "English excerpt", contentHtml: "<p>english body</p>", readingMinutes: 4, keyTakeaways: ["One"], faq: [{ question: "Q?", answer: "A." }] },
        },
        keyTakeaways: ["Bir"],
      });
      await app.prisma.contentSlug.createMany({
        data: [
          { entityType: "BLOG_POST", entityId: enOnly.id, locale: "tr", slug: "cevirili-yazi" },
          { entityType: "BLOG_POST", entityId: enOnly.id, locale: "en", slug: "translated-post" },
        ],
        skipDuplicates: true,
      });
      // Taslak ve çöpteki yazılar hiçbir uçta görünmez.
      await seedPublished({ title: "Taslak Yazı", slug: "taslak-yazi", status: "DRAFT", publishedAt: null });
      await seedPublished({ title: "Çöp Yazı", slug: "cop-yazi", deletedAt: new Date() });
    });

    it("liste: yalnızca yayınlı, sayfalama + total, en yeni önce; topic ve q filtreleri", async () => {
      const page1 = (await app.inject({ method: "GET", url: "/api/v1/blog/posts?pageSize=3" })).json().data;
      expect(page1.total).toBe(7);
      expect(page1.items).toHaveLength(3);
      expect(page1.page).toBe(1);
      expect(page1.items[0]).toMatchObject({ slug: expect.any(String), title: expect.any(String), readingMinutes: 2 });

      const page3 = (await app.inject({ method: "GET", url: "/api/v1/blog/posts?pageSize=3&page=3" })).json().data;
      expect(page3.items).toHaveLength(1);
      expect(page3.featured).toBeNull();

      const bySpecialty = (await app.inject({ method: "GET", url: "/api/v1/blog/posts?topic=dermatology" })).json().data;
      expect(bySpecialty.total).toBe(1);
      expect(bySpecialty.items[0].id).toBe(derm.id);

      const byTopic = (await app.inject({ method: "GET", url: "/api/v1/blog/posts?topic=chest-pain" })).json().data;
      expect(byTopic.total).toBe(2);
      expect((await app.inject({ method: "GET", url: "/api/v1/blog/posts?topic=yok-boyle-konu" })).json().data.total).toBe(0);

      const search = (await app.inject({ method: "GET", url: `/api/v1/blog/posts?q=${encodeURIComponent("kalp rehberi 3")}` })).json().data;
      expect(search.total).toBe(1);
      expect(search.items[0].title).toBe("Kalp Rehberi 3");
      const search2 = (await app.inject({ method: "GET", url: `/api/v1/blog/posts?q=${encodeURIComponent("KALP")}` })).json().data;
      expect(search2.total).toBe(5);
      const searchExcerpt = (await app.inject({ method: "GET", url: `/api/v1/blog/posts?q=${encodeURIComponent("özet")}` })).json().data;
      expect(searchExcerpt.total).toBe(7);
      expect((await app.inject({ method: "GET", url: `/api/v1/blog/posts?q=${encodeURIComponent("100%")}` })).json().data.total).toBe(0);
      expect((await app.inject({ method: "GET", url: `/api/v1/blog/posts?q=${"x".repeat(101)}` })).statusCode).toBe(422);
    });

    it("featured: ilk sayfada isFeatured en yeni, yoksa en yeni yazı", async () => {
      const latest = (await app.inject({ method: "GET", url: "/api/v1/blog/posts" })).json().data;
      expect(latest.featured.id).toBe(latest.items[0].id);

      await app.prisma.blogPost.update({ where: { id: cardioIds[4]! }, data: { isFeatured: true } });
      const featured = (await app.inject({ method: "GET", url: "/api/v1/blog/posts?pageSize=2" })).json().data;
      expect(featured.featured.id).toBe(cardioIds[4]);
      expect(featured.items.map((i: { id: string }) => i.id)).not.toContain(cardioIds[4]);
      await app.prisma.blogPost.update({ where: { id: cardioIds[4]! }, data: { isFeatured: false } });
    });

    it("dil: çevirisi olmayan yazılar o dilin listesinde yok; çeviri başlık/slug/okuma süresi döner", async () => {
      const en = (await app.inject({ method: "GET", url: "/api/v1/blog/posts?locale=en" })).json().data;
      expect(en.total).toBe(1);
      expect(en.items[0]).toMatchObject({ slug: "translated-post", title: "Translated Post", excerpt: "English excerpt", readingMinutes: 4 });
      expect(en.items[0].specialty).toEqual({ slug: "cardiology", name: "Cardiology EN" });
    });

    it("topics: uzmanlık sayıları yalnızca yayınlı yazılar; care topic sayıları; dil filtresi", async () => {
      const topics = (await app.inject({ method: "GET", url: "/api/v1/blog/topics" })).json().data;
      const cardio = topics.find((t: { specialty: { slug: string } }) => t.specialty.slug === "cardiology");
      const dermatology = topics.find((t: { specialty: { slug: string } }) => t.specialty.slug === "dermatology");
      expect(cardio.count).toBe(6); // 5 kalp + 1 çevirili; taslak ve çöp sayılmaz
      expect(cardio.topics).toEqual([{ slug: "chest-pain", label: "Chest pain", count: 2 }]);
      expect(dermatology.count).toBe(1);

      const en = (await app.inject({ method: "GET", url: "/api/v1/blog/topics?locale=en" })).json().data;
      expect(en).toHaveLength(1);
      expect(en[0]).toMatchObject({ specialty: { slug: "cardiology", name: "Cardiology EN" }, count: 1 });
    });

    it("detay: reviewer yalnızca approved ise; unvan izleyici dilinde + görünen ad kuralı; consultDoctors 2; relatedPosts 3", async () => {
      const post = await app.prisma.blogPost.findFirstOrThrow({ where: { slug: "kalp-rehberi-0" } });
      const res = await app.inject({ method: "GET", url: "/api/v1/blog/posts/kalp-rehberi-0" });
      expect(res.statusCode).toBe(200);
      const d = res.json().data;
      expect(d.id).toBe(post.id);
      expect(d.reviewer).toMatchObject({ name: "Prof. Dr. H. Sofu", title: "Prof. Dr.", specialty: { slug: "cardiology" } });
      expect(d.reviewer.slug).toBeTruthy();
      expect(d.consultDoctors).toHaveLength(2);
      expect(d.relatedPosts).toHaveLength(3);
      expect(d.relatedPosts.map((r: { id: string }) => r.id)).not.toContain(post.id);
      expect(d.careTopics).toEqual([{ slug: "chest-pain", label: "Chest pain" }]);
      expect(d.contentHtml).toContain("<h2>");
      expect(d.localizations).toEqual([{ locale: "tr", slug: "kalp-rehberi-0" }]);
      expect(d.coverCompatUrl).toBeNull();

      const en = (await app.inject({ method: "GET", url: "/api/v1/blog/posts/translated-post?locale=en" })).json().data;
      expect(en.title).toBe("Translated Post");
      expect(en.contentHtml).toBe("<p>english body</p>");
      expect(en.keyTakeaways).toEqual(["One"]);
      expect(en.faq).toEqual([{ question: "Q?", answer: "A." }]);
      expect(en.reviewer.name).toBe("Prof. H. Sofu");
      expect(en.localizations).toEqual([
        { locale: "tr", slug: "cevirili-yazi" },
        { locale: "en", slug: "translated-post" },
      ]);
      expect(en.readingMinutes).toBe(4);

      const canonical = (await app.inject({ method: "GET", url: "/api/v1/blog/posts/cevirili-yazi" })).json().data;
      expect(canonical.keyTakeaways).toEqual(["Bir"]);
    });

    it("detay: onaysız (pending / changes_requested) yazıda reviewer gizli", async () => {
      const pending = await seedPublished({ title: "Beklemede", slug: "beklemede", medicalReviewStatus: "pending" });
      const nullStatus = await seedPublished({ title: "Eski", slug: "eski-kayit", medicalReviewStatus: null });
      for (const slug of [pending.slug, nullStatus.slug]) {
        const res = await app.inject({ method: "GET", url: `/api/v1/blog/posts/${slug}` });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.reviewer).toBeNull();
      }
      const card = (await app.inject({ method: "GET", url: "/api/v1/blog/posts?q=Beklemede" })).json().data.items[0];
      expect(card.reviewer).toBeNull();
      await app.prisma.blogPost.deleteMany({ where: { id: { in: [pending.id, nullStatus.id] } } });
    });

    it("detay: taslak, çöp ve çevirisi olmayan dilde 404", async () => {
      expect((await app.inject({ method: "GET", url: "/api/v1/blog/posts/taslak-yazi" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/api/v1/blog/posts/cop-yazi" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/api/v1/blog/posts/yok" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/api/v1/blog/posts/kalp-rehberi-0?locale=en" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/api/v1/blog/taslak-yazi" })).statusCode).toBe(404);
    });

    it("eski GET /blog/:slug da (kullanıcı kararı) çevirisi olmayan dilde 404; çevirili dilde ve varsayılan dilde 200", async () => {
      expect((await app.inject({ method: "GET", url: "/api/v1/blog/kalp-rehberi-0?locale=en" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/api/v1/blog/kalp-rehberi-0" })).statusCode).toBe(200);
      const en = await app.inject({ method: "GET", url: "/api/v1/blog/translated-post?locale=en" });
      expect(en.statusCode).toBe(200);
      expect(en.json().data.title).toBe("Translated Post");
    });

    it("coverCompatUrl: Media'daki JPEG uyumluluk kopyası; yoksa kapağın kendisi", async () => {
      await app.prisma.media.create({
        data: {
          path: "uploads/cover1.webp",
          url: "/uploads/cover1.webp",
          filename: "cover1.webp",
          mimeType: "image/webp",
          sizeBytes: 10,
          variants: [{ format: "jpeg", path: "uploads/cover1.jpg", url: "/uploads/cover1.jpg", sizeBytes: 12, width: 10, height: 10 }],
        },
      });
      const withVariant = await seedPublished({ title: "Kapaklı", slug: "kapakli", coverImageUrl: "/uploads/cover1.webp" });
      const noMedia = await seedPublished({ title: "Kapaksız Kayıt", slug: "kapaksiz-kayit", coverImageUrl: "/uploads/bilinmeyen.webp" });

      const a = (await app.inject({ method: "GET", url: "/api/v1/blog/posts/kapakli" })).json().data;
      expect(a.coverCompatUrl).toMatch(/\/uploads\/cover1\.jpg$/); // yerelde loopback mutlak adres sanitize-localhost-media-urls ile göreli döner
      expect(a.coverUrl).toBe("/uploads/cover1.webp");
      const b = (await app.inject({ method: "GET", url: "/api/v1/blog/posts/kapaksiz-kayit" })).json().data;
      expect(b.coverCompatUrl).toMatch(/\/uploads\/bilinmeyen\.webp$/);
      await app.prisma.blogPost.deleteMany({ where: { id: { in: [withVariant.id, noMedia.id] } } });
    });
  });

  describe("geriye dönük uyumluluk", () => {
    it("yeni alanlar boş başlayan eski kayıt admin API'de bozulmadan okunur ve güncellenir", async () => {
      const legacy = await app.prisma.blogPost.create({ data: { title: "Eski Yazı", slug: "eski-yazi", contentHtml: "<p>x</p>", status: "PUBLISHED", publishedAt: new Date() } });
      const get = await app.inject({ method: "GET", url: `/api/v1/admin/blog/${legacy.id}`, headers: admin });
      expect(get.statusCode).toBe(200);
      expect(get.json().data).toMatchObject({
        medicalReviewStatus: "pending",
        specialtyId: null,
        reviewerDoctorId: null,
        careTopicIds: [],
        keyTakeaways: [],
        faq: [],
        references: [],
        readingMinutes: null,
        isFeatured: false,
        lastReviewedAt: null,
      });
      // Mevcut PUBLISHED kayıt geriye dönük düşürülmez; durum geçişi olmadığı için düzenleme 200.
      const patch = await adminPatch(legacy.id, { excerpt: "Güncel özet" });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().data.status).toBe("PUBLISHED");
    });

    it("kategori isMedical: varsayılan true, oluşturma/güncellemede ayarlanabilir", async () => {
      const created = await app.inject({ method: "POST", url: "/api/v1/admin/blog/categories", headers: admin, payload: { name: "Varsayılan Kategori" } });
      expect(created.json().data.isMedical).toBe(true);
      const patched = await app.inject({ method: "PATCH", url: `/api/v1/admin/blog/categories/${created.json().data.id}`, headers: admin, payload: { isMedical: false } });
      expect(patched.json().data.isMedical).toBe(false);
    });

    it("Paket Z2 — kategori adı çevirileri: varsayılan {}; admin yazar; ziyaretçi kartında izleyicinin dilinde, yoksa kanonik ad", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/admin/blog/categories",
        headers: admin,
        payload: { name: "Seyahat Rehberi", slug: `travel-${crypto.randomUUID().slice(0, 6)}`, isMedical: false },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().data.translations).toEqual({});
      const id = created.json().data.id as string;
      const patched = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/blog/categories/${id}`,
        headers: admin,
        payload: { translations: { en: { name: "Health travel guide" }, ar: { name: "دليل السفر الصحي" }, "sr-latn": { name: "Vodič za zdravstveni turizam" } } },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().data.translations.en).toEqual({ name: "Health travel guide" });
      // Geçersiz dil kodu ve boş ad reddedilir.
      expect((await app.inject({ method: "PATCH", url: `/api/v1/admin/blog/categories/${id}`, headers: admin, payload: { translations: { EN_US: { name: "x" } } } })).statusCode).toBe(422);
      expect((await app.inject({ method: "PATCH", url: `/api/v1/admin/blog/categories/${id}`, headers: admin, payload: { translations: { en: { name: "" } } } })).statusCode).toBe(422);

      const post = await seedPublished({ title: "Kategori çeviri", categoryId: id, translations: { en: { title: "Category translation" } } });
      const card = async (locale?: string) => {
        const q = `q=${encodeURIComponent(locale === "en" ? "Category translation" : "Kategori çeviri")}${locale ? `&locale=${locale}` : ""}`;
        const items = (await app.inject({ method: "GET", url: `/api/v1/blog/posts?${q}` })).json().data.items;
        expect(items.length, `kart bulunamadı (${locale ?? "varsayılan"})`).toBeGreaterThan(0);
        return items[0].category;
      };
      expect((await card("en")).name).toBe("Health travel guide");
      expect((await card()).name).toBe("Seyahat Rehberi");
      await app.prisma.blogPost.delete({ where: { id: post.id } });

      // Çevirisi olmayan dilde kanonik ad; dil kodu büyük/küçük harf duyarsız; boş çeviri yok sayılır.
      const { localizedCategoryName } = await import("../../src/modules/blog/lib/blog-public");
      const cat = { name: "Seyahat Rehberi", translations: { en: { name: "Health travel guide" }, ru: { name: "  " } } };
      expect(localizedCategoryName(cat, "de")).toBe("Seyahat Rehberi");
      expect(localizedCategoryName(cat, "EN")).toBe("Health travel guide");
      expect(localizedCategoryName(cat, "ru")).toBe("Seyahat Rehberi");
      expect(localizedCategoryName(cat, undefined)).toBe("Seyahat Rehberi");
    });
  });

  // Paket AH — hekim onayı (Z1) şartı bayrakla kapanır; kod silinmedi, bayrak true iken eski davranış geri gelir.
  describe("Paket AH — blogMedicalReviewRequired bayrağı", () => {
    const setFlag = (value: boolean) =>
      app.prisma.siteSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", blogMedicalReviewRequired: value }, update: { blogMedicalReviewRequired: value } });

    it("bayrak false: onaysız yazıyı admin yayınlayabilir (oluşturma, DRAFT→PUBLISHED, SCHEDULED); tıbbi kategori ve kategorisiz fark etmez", async () => {
      await setFlag(false);
      try {
        const created = await adminPost({ title: "AH Doğrudan Yayın", status: "PUBLISHED", categoryId: medicalCategoryId });
        expect(created.statusCode, created.body).toBe(201);
        expect(created.json().data.status).toBe("PUBLISHED");

        const draft = await adminPost({ title: "AH Taslak", categoryId: medicalCategoryId });
        const published = await adminPatch(draft.json().data.id as string, { status: "PUBLISHED" });
        expect(published.statusCode, published.body).toBe(200);
        expect(published.json().data).toMatchObject({ status: "PUBLISHED", medicalReviewStatus: "pending" });

        const future = new Date(Date.now() + 3600_000).toISOString();
        const scheduled = await adminPost({ title: "AH Zamanlı", status: "SCHEDULED", scheduledAt: future });
        expect(scheduled.statusCode, scheduled.body).toBe(201);
      } finally {
        await setFlag(true);
      }
    });

    it("bayrak false: toplu yayın atlama yapmaz; zamanlanmış yayın sweeper'ı onaysız yazıyı da yayınlar", async () => {
      await setFlag(false);
      try {
        const a = (await adminPost({ title: "AH Toplu A", categoryId: medicalCategoryId })).json().data.id as string;
        const b = (await adminPost({ title: "AH Toplu B" })).json().data.id as string;
        const bulk = await app.inject({ method: "POST", url: "/api/v1/admin/blog/bulk", headers: admin, payload: { ids: [a, b], action: "publish" } });
        expect(bulk.statusCode).toBe(200);
        expect(bulk.json().data.skippedIds).toEqual([]);
        expect(bulk.json().data.affectedCount).toBe(2);

        const due = await app.prisma.blogPost.create({
          data: { title: "AH Sweeper", slug: "ah-sweeper", status: "SCHEDULED", scheduledAt: new Date(Date.now() - 60_000), categoryId: medicalCategoryId, medicalReviewStatus: "pending" },
        });
        await runScheduledPublishSweep(app);
        expect((await app.prisma.blogPost.findUniqueOrThrow({ where: { id: due.id } })).status).toBe("PUBLISHED");
      } finally {
        await setFlag(true);
      }
    });

    it("bayrak yoksa (ayar satırı yok) varsayılan false: şart aranmaz", async () => {
      await app.prisma.siteSettings.deleteMany({ where: { id: "singleton" } });
      try {
        const res = await adminPost({ title: "AH Satırsız", status: "PUBLISHED", categoryId: medicalCategoryId });
        expect(res.statusCode, res.body).toBe(201);
      } finally {
        await setFlag(true);
      }
    });

    it("bayrak true (admin ayarıyla): eski davranış geri gelir; PATCH /admin/settings bayrağı yazar, ADMIN dışı 403", async () => {
      await setFlag(false);
      const on = await app.inject({ method: "PATCH", url: "/api/v1/admin/settings", headers: admin, payload: { blogMedicalReviewRequired: true } });
      expect(on.statusCode, on.body).toBe(200);
      expect(on.json().data.blogMedicalReviewRequired).toBe(true);
      const blocked = await adminPost({ title: "AH Eski Davranış", status: "PUBLISHED", categoryId: medicalCategoryId });
      expect(blocked.statusCode).toBe(422);
      expect(blocked.json().error.details).toHaveProperty("medicalReviewStatus");
      expect((await app.inject({ method: "PATCH", url: "/api/v1/admin/settings", headers: editor, payload: { blogMedicalReviewRequired: false } })).statusCode).toBe(403);
      const get = await app.inject({ method: "GET", url: "/api/v1/admin/settings", headers: admin });
      expect(get.json().data.blogMedicalReviewRequired).toBe(true);
    });

    it("bayrak false: tıbbi/kategorisiz yazıyı yayınlamak, onay durumu ve gözden geçiren ataması yalnız ADMIN (EDITOR 403); tıbbi olmayan kategori serbest; taslak düzenlenebilir", async () => {
      await setFlag(false);
      try {
        // Taslak: EDITOR oluşturur/düzenler.
        const draft = await adminPost({ title: "AH Editör Taslak", categoryId: medicalCategoryId }, editor);
        expect(draft.statusCode, draft.body).toBe(201);
        const id = draft.json().data.id as string;
        expect((await adminPatch(id, { title: "AH Editör Taslak 2" }, editor)).statusCode).toBe(200);

        // Yayın/zamanlama: tıbbi kategori ve kategorisiz -> 403; ADMIN -> 200.
        const future = new Date(Date.now() + 3600_000).toISOString();
        expect((await adminPatch(id, { status: "PUBLISHED" }, editor)).statusCode).toBe(403);
        expect((await adminPatch(id, { status: "SCHEDULED", scheduledAt: future }, editor)).statusCode).toBe(403);
        expect((await adminPost({ title: "AH Editör Doğrudan", status: "PUBLISHED", categoryId: medicalCategoryId }, editor)).statusCode).toBe(403);
        expect((await adminPost({ title: "AH Editör Kategorisiz", status: "PUBLISHED" }, editor)).statusCode).toBe(403);
        expect((await app.prisma.blogPost.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");
        expect((await adminPatch(id, { status: "PUBLISHED" })).statusCode).toBe(200);

        // Tıbbi olmayan kategori: EDITOR yayınlayabilir.
        expect((await adminPost({ title: "AH Editör Seyahat", status: "PUBLISHED", categoryId: travelCategoryId }, editor)).statusCode).toBe(201);

        // Hekim ataması / onay durumu yalnız ADMIN.
        const d2 = (await adminPost({ title: "AH Atama", categoryId: medicalCategoryId })).json().data.id as string;
        expect((await adminPatch(d2, { reviewerDoctorId: reviewerId }, editor)).statusCode).toBe(403);
        expect((await adminPost({ title: "AH Atama 2", categoryId: medicalCategoryId, reviewerDoctorId: reviewerId }, editor)).statusCode).toBe(403);
        expect((await adminPatch(d2, { medicalReviewStatus: "approved" }, editor)).statusCode).toBe(422); // şema: yalnız hekim kuyruğu
        expect((await adminPatch(d2, { reviewerDoctorId: reviewerId })).statusCode).toBe(200);

        // not_required yalnız ADMIN - bayraktan bağımsız.
        expect((await adminPatch(d2, { medicalReviewStatus: "not_required", categoryId: travelCategoryId }, editor)).statusCode).toBe(403);
      } finally {
        await setFlag(true);
      }
    });

    it("bayrak false: toplu yayında EDITOR için tıbbi/kategorisiz yazılar atlanır, tıbbi olmayan yayınlanır; ADMIN hepsini yayınlar", async () => {
      await setFlag(false);
      try {
        const medical = (await adminPost({ title: "AH Toplu Tıbbi", categoryId: medicalCategoryId })).json().data.id as string;
        const travel = (await adminPost({ title: "AH Toplu Seyahat", categoryId: travelCategoryId })).json().data.id as string;
        const bulkAs = (headers: { authorization: string }, ids: string[]) =>
          app.inject({ method: "POST", url: "/api/v1/admin/blog/bulk", headers, payload: { ids, action: "publish" } });
        const asEditor = await bulkAs(editor, [medical, travel]);
        expect(asEditor.statusCode).toBe(200);
        expect(asEditor.json().data.skippedIds).toEqual([medical]);
        expect((await app.prisma.blogPost.findUniqueOrThrow({ where: { id: medical } })).status).toBe("DRAFT");
        expect((await app.prisma.blogPost.findUniqueOrThrow({ where: { id: travel } })).status).toBe("PUBLISHED");
        const asAdmin = await bulkAs(admin, [medical]);
        expect(asAdmin.json().data.skippedIds).toEqual([]);
        expect((await app.prisma.blogPost.findUniqueOrThrow({ where: { id: medical } })).status).toBe("PUBLISHED");
      } finally {
        await setFlag(true);
      }
    });

    it("bayrak true: EDITOR için Z1 davranışı aynen (onaysız 422, rol kuralı not_required 403)", async () => {
      await setFlag(true);
      const res = await adminPost({ title: "AH Z1 Editör", status: "PUBLISHED", categoryId: medicalCategoryId }, editor);
      expect(res.statusCode).toBe(422);
      expect((await adminPost({ title: "AH Z1 NR", categoryId: travelCategoryId, medicalReviewStatus: "not_required" }, editor)).statusCode).toBe(403);
    });

    it("public blog yanıtlarında hekim verisi YOK (varsayılan): reviewer null, consultDoctors [], pendingReviewer null, /blog/reviewers boş; admin uçları etkilenmez", async () => {
      expect(blogDoctorVisibility.visible).toBe(false);
      const post = await seedPublished({ medicalReviewStatus: "approved", reviewerDoctorId: reviewerId, lastReviewedAt: new Date(), specialtyId });
      const detail = (await app.inject({ method: "GET", url: `/api/v1/blog/posts/${post.slug}` })).json().data;
      expect(detail.reviewer).toBeNull();
      expect(detail.consultDoctors).toEqual([]);
      const list = (await app.inject({ method: "GET", url: "/api/v1/blog/posts?limit=50" })).json().data;
      expect(list.items.length).toBeGreaterThan(0);
      for (const card of list.items) expect(card.reviewer).toBeNull();
      expect((await app.inject({ method: "GET", url: `/api/v1/blog/posts?q=${encodeURIComponent(post.title)}` })).body).not.toContain("Sofu");
      expect((await app.inject({ method: "GET", url: "/api/v1/blog/reviewers" })).json().data.items).toEqual([]);
      for (const related of detail.relatedPosts) expect(related.reviewer).toBeNull();
      // Admin ucu hekimi bilmeye devam eder.
      const adminGet = await app.inject({ method: "GET", url: `/api/v1/admin/blog/${post.id}`, headers: admin });
      expect(adminGet.json().data.reviewerDoctorId).toBe(reviewerId);
    });

    it("mevcut yayındaki yazılar bayrak değişiminden etkilenmez", async () => {
      const post = await seedPublished();
      await setFlag(false);
      await setFlag(true);
      expect((await app.prisma.blogPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("PUBLISHED");
    });
  });
});
