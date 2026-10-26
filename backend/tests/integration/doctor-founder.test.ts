import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { PageBlockListSchema } from "../../src/modules/pages/pages.schemas";

/**
 * Paket P (İş 3) — kurucu odaklı kadro: `isFounder` (tek kurucu, sunucu 409) + `rosterTier`;
 * public DTO'da döner; arşivli/pasif doktorlar public listede (dolayısıyla bloklarda) yok;
 * Öne Çıkan Doktorlar bloğu `pyramid` yerleşimini kabul eder (kurucu + 12).
 */
describe("Paket P — kurucu doktor", () => {
  let app: FastifyInstance;
  let auth: { authorization: string };

  const doctorPayload = (overrides: Record<string, unknown> = {}) => ({
    title: "Doç. Dr.",
    fullName: `Doktor ${crypto.randomUUID().slice(0, 8)}`,
    bio: "Genel cerrah. İkinci cümle.",
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 50000,
    ...overrides,
  });

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    const admin = await registerTestUser(app);
    auth = { authorization: `Bearer ${admin.accessToken}` };
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  const create = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/v1/admin/telehealth/doctors", headers: auth, payload });
  const patch = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: "PATCH", url: `/api/v1/admin/telehealth/doctors/${id}`, headers: auth, payload });

  it("aynı anda yalnızca bir kurucu: ikinci kurucu oluşturma/işaretleme 409; işaret kaldırılınca devredilebilir", async () => {
    const founder = await create(doctorPayload({ isFounder: true, rosterTier: 1 }));
    expect(founder.statusCode).toBe(201);
    expect(founder.json().data).toMatchObject({ isFounder: true, rosterTier: 1 });
    const founderId = founder.json().data.id as string;

    expect((await create(doctorPayload({ isFounder: true }))).statusCode).toBe(409);
    const other = await create(doctorPayload());
    expect(other.json().data.isFounder).toBe(false);
    const otherId = other.json().data.id as string;
    const conflict = await patch(otherId, { isFounder: true });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.message).toContain("Zaten bir kurucu doktor var");

    // Kurucunun kendisini yeniden işaretlemek serbest.
    expect((await patch(founderId, { isFounder: true, rosterTier: 2 })).statusCode).toBe(200);
    expect((await patch(founderId, { isFounder: false })).statusCode).toBe(200);
    expect((await patch(otherId, { isFounder: true })).statusCode).toBe(200);
    expect(await app.prisma.doctorProfile.count({ where: { isFounder: true } })).toBe(1);

    const list = (await app.inject({ method: "GET", url: "/api/v1/doctors" })).json().data as { id: string; isFounder: boolean }[];
    expect(list.find((d) => d.id === otherId)!.isFounder).toBe(true);
    expect(list.find((d) => d.id === founderId)!.isFounder).toBe(false);
  });

  it("arşivli ve pasif doktorlar public listede yok (blokların tek kaynağı)", async () => {
    const archived = await create(doctorPayload({ fullName: "Test Arşiv" }));
    await app.prisma.doctorProfile.update({ where: { id: archived.json().data.id }, data: { archivedAt: new Date(), isActive: false } });
    const inactive = await create(doctorPayload({ fullName: "Test Pasif", isActive: false }));
    const slugs = ((await app.inject({ method: "GET", url: "/api/v1/doctors" })).json().data as { slug: string }[]).map((d) => d.slug);
    expect(slugs).not.toContain(archived.json().data.slug);
    expect(slugs).not.toContain(inactive.json().data.slug);
  });

  it("geçersiz kadro katmanı 422", async () => {
    expect((await create(doctorPayload({ rosterTier: 0 }))).statusCode).toBe(422);
    expect((await create(doctorPayload({ rosterTier: 10 }))).statusCode).toBe(422);
  });

  it("Öne Çıkan Doktorlar bloğu: pyramid yerleşimi kabul edilir; sınır 13", () => {
    const ids = (n: number) => Array.from({ length: n }, () => crypto.randomUUID());
    const block = (layout: string, doctorIds: string[]) => [{ id: "fd", type: "featured-doctors", data: { layout, doctorIds } }];
    expect(PageBlockListSchema.safeParse(block("pyramid", ids(13))).success).toBe(true);
    expect(PageBlockListSchema.safeParse(block("pyramid", ids(14))).success).toBe(false);
    expect(PageBlockListSchema.safeParse(block("grid", ids(9))).success).toBe(false);
    expect(PageBlockListSchema.safeParse(block("zigzag", ids(2))).success).toBe(false);
  });
});
