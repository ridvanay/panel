import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";

/** Paket Z1-ek — GET /api/v1/blog/reviewers (onaylı yazısı olan, herkese açık hekimler). */
describe("GET /blog/reviewers", () => {
  let app: FastifyInstance;
  let specialtyId: string;
  let categoryId: string;

  const get = (locale?: string) =>
    app.inject({ method: "GET", url: `/api/v1/blog/reviewers${locale ? `?locale=${locale}` : ""}` });

  async function doctor(over: { fullName: string; isActive?: boolean; archivedAt?: Date | null; translations?: object }) {
    return app.prisma.doctorProfile.create({
      data: {
        title: "Prof. Dr.",
        fullName: over.fullName,
        slug: `rv-${crypto.randomUUID()}`,
        bio: "Test",
        languages: ["en"],
        isActive: over.isActive ?? true,
        archivedAt: over.archivedAt ?? null,
        specialtyId,
        translations: over.translations ?? {},
      },
    });
  }

  async function post(reviewerDoctorId: string, medicalReviewStatus: string, deletedAt: Date | null = null) {
    const slug = `rp-${crypto.randomUUID().slice(0, 8)}`;
    return app.prisma.blogPost.create({
      data: {
        title: slug,
        slug,
        contentHtml: "<p>x</p>",
        status: "PUBLISHED",
        publishedAt: new Date(),
        categoryId,
        specialtyId,
        reviewerDoctorId,
        medicalReviewStatus,
        deletedAt,
      } as never,
    });
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    specialtyId = (await app.prisma.specialty.create({ data: { name: "Kardiyoloji", slug: "cardiology", icon: "heart-pulse", translations: { en: { name: "Cardiology" } } } })).id;
    categoryId = (await app.prisma.blogCategory.create({ data: { name: "Rehber", slug: "rehber" } })).id;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("hiç onaylı yazı yoksa boş liste döner", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ items: [] });
  });

  it("yalnızca onaylı yazısı olan ve herkese açık hekimleri döner; sıra approvedCount desc", async () => {
    const many = await doctor({ fullName: "Hasan SOFU", translations: { en: { title: "Prof." } } });
    const one = await doctor({ fullName: "Ayşe Demir" });
    const noApproved = await doctor({ fullName: "Onaysız Hekim" });
    const inactive = await doctor({ fullName: "Pasif Hekim", isActive: false });
    const archived = await doctor({ fullName: "Arşivli Hekim", archivedAt: new Date() });
    await doctor({ fullName: "Yazısız Hekim" });

    await post(many.id, "approved");
    await post(many.id, "approved");
    await post(one.id, "approved");
    await post(one.id, "pending"); // sayılmaz
    await post(many.id, "approved", new Date()); // çöpte: sayılmaz
    await post(noApproved.id, "pending");
    await post(noApproved.id, "changes_requested");
    await post(inactive.id, "approved");
    await post(archived.id, "approved");

    const res = await get();
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items as Array<Record<string, unknown>>;
    expect(items.map((i) => i.slug)).toEqual([many.slug, one.slug]);
    expect(items.map((i) => i.approvedCount)).toEqual([2, 1]);
    expect(items[0]).toMatchObject({ avatarUrl: null, specialty: { slug: "cardiology", name: "Kardiyoloji" } });
    // Kişisel iletişim verisi yok.
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(["approvedCount", "avatarUrl", "name", "slug", "specialty", "title"]);
    }
  });

  it("unvan ve uzmanlık adı izleyici dilinde döner", async () => {
    const tr = (await get()).json().data.items[0];
    expect(tr.title).toBe("Prof. Dr.");
    expect(tr.name.startsWith("Prof. Dr.")).toBe(true);

    const en = (await get("en")).json().data.items[0];
    expect(en.title).toBe("Prof.");
    expect(en.name.startsWith("Prof.")).toBe(true);
    expect(en.name.startsWith("Prof. Dr.")).toBe(false);
    expect(en.specialty.name).toBe("Cardiology");
  });
});
