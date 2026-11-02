import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";

/**
 * Paket AG (İş 1) — alt uzmanlık (`Specialty.parentId`, tek seviye): admin doğrulamaları + audit,
 * public liste/detay alanları, blog topics toplama + topic filtresi, sihirbaz (alt uzmanlık -> üst hekimleri).
 */
const ADMIN_URL = "/api/v1/admin/telehealth/specialties";
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe("alt uzmanlık (Paket AG)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;
  let gasId: string;
  let esdId: string;
  let ercpId: string;
  let cardId: string;

  async function createSpecialty(payload: Record<string, unknown>) {
    return app.inject({ method: "POST", url: ADMIN_URL, headers: auth(adminToken), payload: { icon: "heart-pulse", ...payload } });
  }

  async function seedDoctor(slug: string, specialtyId: string, extra: Record<string, unknown> = {}) {
    return app.prisma.doctorProfile.create({
      data: {
        title: "Op. Dr.",
        fullName: `Dr ${slug}`,
        bio: "Test.",
        slug,
        languages: ["tr"],
        timeZone: "Europe/Istanbul",
        specialtyId,
        sessionDurationMin: 30,
        sessionPriceCents: 50000,
        currency: "EUR",
        isActive: true,
        availability: { create: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 24 * 60, isActive: true })) },
        ...extra,
      } as never,
    });
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    const { hashPassword } = await import("../../src/lib/password");
    const admin = await app.prisma.user.create({
      data: { email: `ag-admin-${crypto.randomUUID()}@example.com`, name: "Admin", passwordHash: await hashPassword("Sifre12345!"), role: "ADMIN", status: "ACTIVE", emailVerifiedAt: new Date() },
    });
    adminId = admin.id;
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: admin.email, password: "Sifre12345!" } });
    adminToken = login.json().data.tokens.accessToken;

    gasId = (await createSpecialty({ name: "Gastroenterology", slug: "gastroenterology", order: 1 })).json().data.id;
    cardId = (await createSpecialty({ name: "Cardiology", slug: "cardiology", order: 5 })).json().data.id;
    esdId = (await createSpecialty({ name: "ESD", slug: "esd", order: 2, parentId: gasId, translations: { tr: { name: "ESD (TR)", description: "" } } })).json().data.id;
    ercpId = (await createSpecialty({ name: "ERCP", slug: "ercp", order: 3 })).json().data.id;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  describe("admin doğrulamaları", () => {
    it("alt uzmanlık oluşturulur; DTO parentId + parentSlug döner; audit yalnızca id'leri yazar", async () => {
      const res = await createSpecialty({ name: "POEM", slug: "poem", order: 4, parentId: gasId });
      expect(res.statusCode).toBe(201);
      expect(res.json().data).toMatchObject({ slug: "poem", parentId: gasId, parentSlug: "gastroenterology" });
      const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "specialty.parent_set", targetId: res.json().data.id } });
      expect(audit).toMatchObject({ actorId: adminId });
      expect(audit.metadata).toEqual({ parentId: gasId, previousParentId: null });
    });

    it("PATCH ile bağlanır ve geri üst seviyeye alınır (null); değişim audit'lenir", async () => {
      const set = await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${ercpId}`, headers: auth(adminToken), payload: { parentId: gasId } });
      expect(set.statusCode).toBe(200);
      expect(set.json().data).toMatchObject({ parentId: gasId, parentSlug: "gastroenterology" });
      const unset = await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${ercpId}`, headers: auth(adminToken), payload: { parentId: null } });
      expect(unset.json().data).toMatchObject({ parentId: null, parentSlug: null });
      const audits = await app.prisma.auditLog.findMany({ where: { action: "specialty.parent_set", targetId: ercpId }, orderBy: { createdAt: "asc" } });
      expect(audits.map((a) => a.metadata)).toEqual([
        { parentId: gasId, previousParentId: null },
        { parentId: null, previousParentId: gasId },
      ]);
    });

    it("parentId verilmeyen PATCH mevcut bağlantıyı değiştirmez", async () => {
      const res = await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${esdId}`, headers: auth(adminToken), payload: { order: 2 } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.parentId).toBe(gasId);
    });

    it("kendisi, iki seviye, çocuklu uzmanlığa parent ve olmayan parent -> 422 parentId", async () => {
      const self = await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${gasId}`, headers: auth(adminToken), payload: { parentId: gasId } });
      expect(self.statusCode).toBe(422);
      expect(JSON.stringify(self.json().error)).toContain("parentId");

      // esd zaten alt uzmanlık: altına alt uzmanlık eklenemez (iki seviye).
      const twoLevel = await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${ercpId}`, headers: auth(adminToken), payload: { parentId: esdId } });
      expect(twoLevel.statusCode).toBe(422);
      expect(JSON.stringify(twoLevel.json().error)).toContain("parentId");
      const twoLevelCreate = await createSpecialty({ name: "Alt Alt", slug: "alt-alt", parentId: esdId });
      expect(twoLevelCreate.statusCode).toBe(422);

      // gastro'nun çocukları var: başka bir uzmanlığın altına taşınamaz (döngü/derinlik engeli).
      const hasChildren = await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${gasId}`, headers: auth(adminToken), payload: { parentId: cardId } });
      expect(hasChildren.statusCode).toBe(422);
      expect(JSON.stringify(hasChildren.json().error)).toContain("parentId");

      const missing = await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${ercpId}`, headers: auth(adminToken), payload: { parentId: crypto.randomUUID() } });
      expect(missing.statusCode).toBe(422);
      const notUuid = await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${ercpId}`, headers: auth(adminToken), payload: { parentId: "x" } });
      expect(notUuid.statusCode).toBe(422);

      expect((await app.prisma.specialty.findUniqueOrThrow({ where: { id: ercpId } })).parentId).toBeNull();
      expect((await app.prisma.specialty.findUniqueOrThrow({ where: { id: gasId } })).parentId).toBeNull();
    });

    it("admin listesi parentId/parentSlug döner", async () => {
      const list = await app.inject({ method: "GET", url: ADMIN_URL, headers: auth(adminToken) });
      const esd = list.json().data.find((s: { slug: string }) => s.slug === "esd");
      expect(esd).toMatchObject({ parentId: gasId, parentSlug: "gastroenterology" });
    });
  });

  describe("eşzamanlılık ve DB kısıtı", () => {
    it("iki eşzamanlı PATCH (A->B altına, B->A altına) tek seviye kuralını birlikte aşamaz", async () => {
      const a = (await createSpecialty({ name: "Yarış A", slug: "yaris-a", order: 30 })).json().data.id as string;
      const b = (await createSpecialty({ name: "Yarış B", slug: "yaris-b", order: 31 })).json().data.id as string;
      const [r1, r2] = await Promise.all([
        app.inject({ method: "PATCH", url: `${ADMIN_URL}/${a}`, headers: auth(adminToken), payload: { parentId: b } }),
        app.inject({ method: "PATCH", url: `${ADMIN_URL}/${b}`, headers: auth(adminToken), payload: { parentId: a } }),
      ]);
      expect([r1.statusCode, r2.statusCode].filter((c) => c === 200)).toHaveLength(1);
      expect([r1.statusCode, r2.statusCode]).toContain(422);
      const rows = await app.prisma.specialty.findMany({ where: { id: { in: [a, b] } } });
      expect(rows.filter((r) => r.parentId !== null)).toHaveLength(1);
      // Sonraki testlerin sıralı beklentilerini bozmasın.
      await app.prisma.specialty.updateMany({ where: { id: { in: [a, b] } }, data: { parentId: null } });
      await app.prisma.specialty.deleteMany({ where: { id: { in: [a, b] } } });
    });

    it("DB CHECK: bir uzmanlık kendisinin üstü olamaz", async () => {
      await expect(app.prisma.specialty.update({ where: { id: cardId }, data: { parentId: cardId } })).rejects.toThrow();
      expect((await app.prisma.specialty.findUniqueOrThrow({ where: { id: cardId } })).parentId).toBeNull();
    });
  });

  describe("public uçlar", () => {
    it("GET /specialties: tüm aktif uzmanlıklar + parentId/parentSlug (filtre yok)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/specialties" });
      const data = res.json().data as { slug: string; parentId: string | null; parentSlug: string | null }[];
      expect(data.map((s) => s.slug)).toEqual(["gastroenterology", "esd", "ercp", "poem", "cardiology"]);
      expect(data.find((s) => s.slug === "esd")).toMatchObject({ parentId: gasId, parentSlug: "gastroenterology" });
      expect(data.find((s) => s.slug === "gastroenterology")).toMatchObject({ parentId: null, parentSlug: null });
    });

    it("GET /specialties/:slug: üst -> children (aktif, order asc, yerelleştirilmiş); alt -> parent; doctorCount kendi hekimleri", async () => {
      await seedDoctor("gas-doc", gasId);
      const inactive = await createSpecialty({ name: "Pasif Alt", slug: "pasif-alt", order: 9, parentId: gasId, isActive: false });
      expect(inactive.statusCode).toBe(201);

      const parent = (await app.inject({ method: "GET", url: "/api/v1/specialties/gastroenterology" })).json().data;
      expect(parent.parent).toBeNull();
      expect(parent.children).toEqual([
        { slug: "esd", name: "ESD", icon: "heart-pulse" },
        { slug: "poem", name: "POEM", icon: "heart-pulse" },
      ]);
      expect(parent.doctorCount).toBe(1);

      const tr = (await app.inject({ method: "GET", url: "/api/v1/specialties/gastroenterology?locale=tr" })).json().data;
      expect(tr.children[0]).toMatchObject({ slug: "esd", name: "ESD (TR)" });

      const child = (await app.inject({ method: "GET", url: "/api/v1/specialties/esd?locale=tr" })).json().data;
      expect(child).toMatchObject({ parentId: gasId, parentSlug: "gastroenterology", parent: { slug: "gastroenterology", name: "Gastroenterology" }, children: [], doctorCount: 0 });

      const plain = (await app.inject({ method: "GET", url: "/api/v1/specialties/cardiology" })).json().data;
      expect(plain).toMatchObject({ parent: null, children: [], parentId: null });
    });

    it("üst uzmanlık PASİFSE alt uzmanlığın parentId/parentSlug/parent alanları public uçlarda null döner (admin gerçeği görür)", async () => {
      const parent = (await createSpecialty({ name: "Pasif Üst", slug: "pasif-ust", order: 20, isActive: false })).json().data;
      const child = (await createSpecialty({ name: "Alt Of Pasif", slug: "alt-of-pasif", order: 21, parentId: parent.id })).json().data;
      expect(child.parentId).toBe(parent.id);

      const list = (await app.inject({ method: "GET", url: "/api/v1/specialties" })).json().data as { slug: string; parentId: string | null; parentSlug: string | null }[];
      expect(list.find((x) => x.slug === "alt-of-pasif")).toMatchObject({ parentId: null, parentSlug: null });
      const detail = (await app.inject({ method: "GET", url: "/api/v1/specialties/alt-of-pasif" })).json().data;
      expect(detail).toMatchObject({ parentId: null, parentSlug: null, parent: null });

      const admin = (await app.inject({ method: "GET", url: ADMIN_URL, headers: auth(adminToken) })).json().data as { slug: string; parentId: string | null }[];
      expect(admin.find((x) => x.slug === "alt-of-pasif")?.parentId).toBe(parent.id);
    });

    it("GET /doctors?specialtySlug=esd DEĞİŞMEZ: yalnızca kendi hekimleri (üstünkiler gelmez)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/doctors?specialtySlug=esd" });
      expect(res.statusCode).toBe(200);
      expect(JSON.stringify(res.json().data)).not.toContain("gas-doc");
    });
  });

  describe("blog", () => {
    let cardPostCategoryId: string;

    async function seedPost(slug: string, specialtyId: string) {
      return app.prisma.blogPost.create({
        data: {
          title: `Başlık ${slug}`,
          slug,
          excerpt: "Özet",
          contentHtml: "<p>metin</p>",
          status: "PUBLISHED",
          publishedAt: new Date(),
          categoryId: cardPostCategoryId,
          specialtyId,
          medicalReviewStatus: "not_required",
          readingMinutes: 1,
        } as never,
      });
    }

    beforeAll(async () => {
      cardPostCategoryId = (await app.prisma.blogCategory.create({ data: { name: "Genel", slug: "genel", isMedical: false } })).id;
      await seedPost("gas-yazi", gasId);
      await seedPost("esd-yazi", esdId);
      await seedPost("poem-yazi", (await app.prisma.specialty.findUniqueOrThrow({ where: { slug: "poem" } })).id);
      await seedPost("kalp-yazi", cardId);
    });

    it("topics: yalnızca üst uzmanlıklar; alt uzmanlık yazıları üstte toplanır", async () => {
      const topics = (await app.inject({ method: "GET", url: "/api/v1/blog/topics" })).json().data as { specialty: { slug: string }; count: number }[];
      expect(topics.map((t) => t.specialty.slug)).toEqual(["gastroenterology", "cardiology"]);
      expect(topics.find((t) => t.specialty.slug === "gastroenterology")!.count).toBe(3);
      expect(topics.find((t) => t.specialty.slug === "cardiology")!.count).toBe(1);
    });

    it("topics: yalnızca alt uzmanlık yazısı olan üst uzmanlık da grup olur", async () => {
      await app.prisma.blogPost.deleteMany({ where: { slug: "gas-yazi" } });
      const topics = (await app.inject({ method: "GET", url: "/api/v1/blog/topics" })).json().data as { specialty: { slug: string }; count: number }[];
      expect(topics.find((t) => t.specialty.slug === "gastroenterology")!.count).toBe(2);
      expect(topics.some((t) => t.specialty.slug === "esd")).toBe(false);
    });

    it("?topic=<üst slug> alt uzmanlık yazılarını kapsar; ?topic=<alt slug> yalnızca o alt uzmanlık", async () => {
      const parent = (await app.inject({ method: "GET", url: "/api/v1/blog/posts?topic=gastroenterology" })).json().data;
      expect(parent.total).toBe(2);
      const child = (await app.inject({ method: "GET", url: "/api/v1/blog/posts?topic=esd" })).json().data;
      expect(child.total).toBe(1);
      expect(child.items[0].slug).toBe("esd-yazi");
      const other = (await app.inject({ method: "GET", url: "/api/v1/blog/posts?topic=cardiology" })).json().data;
      expect(other.total).toBe(1);
    });
  });

  describe("sihirbaz", () => {
    it("alt uzmanlık önerilirse üst uzmanlığın hekimleri aday olur; hekimsiz alt uzmanlık staffed sayılır; matchedSpecialtySlug üst olabilir", async () => {
      const { recommend } = await import("../../src/modules/matcher/matcher.service");
      const topic = await app.prisma.careTopic.create({
        data: { slug: "ag-esd-topic", bodyArea: "digestive", translations: { en: { label: "ESD topic" } }, specialties: { create: [{ specialtyId: esdId, weight: 100 }] } },
      });
      // gas-doc (gastro hekimi) zaten var; ayrıca ESD'nin kendi hekimi.
      await seedDoctor("esd-doc", esdId);

      const res = await recommend(app, { topicIds: [topic.id], preferredLanguage: "tr", locale: "en" });
      expect(res.redFlag).toBe(false);
      expect(res.specialties.map((s) => s.slug)).toEqual(["esd"]);
      const bySlug = Object.fromEntries(res.doctors.map((d) => [d.slug, d]));
      expect(Object.keys(bySlug).sort()).toEqual(["esd-doc", "gas-doc"]);
      expect(bySlug["esd-doc"]!.matchedSpecialtySlug).toBe("esd");
      expect(bySlug["gas-doc"]!.matchedSpecialtySlug).toBe("gastroenterology");

      // ESD'nin kendi hekimi silinse bile (hekimsiz alt uzmanlık) üst hekim sayesinde uzmanlık önerilir.
      await app.prisma.doctorProfile.delete({ where: { slug: "esd-doc" } });
      const only = await recommend(app, { topicIds: [topic.id], preferredLanguage: "tr", locale: "en" });
      expect(only.specialties.map((s) => s.slug)).toEqual(["esd"]);
      expect(only.doctors.map((d) => d.slug)).toEqual(["gas-doc"]);
      expect(only.coordinator).toBe(false);
    });

    it("üst uzmanlıkta da hekim yoksa alt uzmanlık hâlâ düşülür (koordinatör)", async () => {
      const { recommend } = await import("../../src/modules/matcher/matcher.service");
      const poemId = (await app.prisma.specialty.findUniqueOrThrow({ where: { slug: "poem" } })).id;
      await app.prisma.doctorProfile.deleteMany({});
      const topic = await app.prisma.careTopic.create({
        data: { slug: "ag-poem-topic", bodyArea: "digestive", translations: { en: { label: "POEM topic" } }, specialties: { create: [{ specialtyId: poemId, weight: 100 }] } },
      });
      const res = await recommend(app, { topicIds: [topic.id], preferredLanguage: "tr", locale: "en" });
      expect(res.specialties).toEqual([]);
      expect(res.coordinator).toBe(true);
    });
  });
});
