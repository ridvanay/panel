import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { mkCoordinator, mkSpecialty, mkUser } from "../helpers/service-desk";

/** Paket AK (K2) - GET /public/site-metrics: canli sayac verisi, kisisel veri yok, 60 sn onbellek. */
describe("Paket AK - site-metrics", () => {
  let app: FastifyInstance;
  const get = (url = "/api/v1/public/site-metrics") => app.inject({ method: "GET", url });

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app.prisma);
  });

  it("anonim erisilir (API anahtari gerekmez), Cache-Control 60 sn; bos veride hizmet/koordinator/masa null", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("max-age=60");
    const d = res.json().data;
    expect(d.activeServices).toBeNull();
    expect(d.activeCoordinators).toBeNull();
    expect(d.consultationMinutes).toBeNull();
  });

  it("aktif UST hizmetleri sayar: alt hizmet ve pasif sayilmaz", async () => {
    const parent = await mkSpecialty(app, "Gastroenterology");
    await mkSpecialty(app, "Dental");
    const inactive = await mkSpecialty(app, "Hidden");
    await app.prisma.specialty.update({ where: { id: inactive.id }, data: { isActive: false } });
    const child = await mkSpecialty(app, "ERCP");
    await app.prisma.specialty.update({ where: { id: child.id }, data: { parentId: parent.id } });
    expect((await get()).json().data.activeServices).toBe(2);
  });

  it("ziyaretci dilleri etkin diller eksi tr", async () => {
    await app.prisma.locale.deleteMany({});
    await app.prisma.locale.createMany({
      data: [
        { code: "tr", label: "Turkce", nativeLabel: "Turkce", isDefault: true, enabled: true, sortOrder: 0 },
        { code: "en", label: "Ingilizce", nativeLabel: "English", enabled: true, sortOrder: 1 },
        { code: "de", label: "Almanca", nativeLabel: "Deutsch", enabled: true, sortOrder: 2 },
        { code: "fr", label: "Fransizca", nativeLabel: "Francais", enabled: false, sortOrder: 3 },
      ],
    });
    expect((await get()).json().data.visitorLanguages).toBe(2);
  });

  it("koordinator: yalniz uygun aktif (profil aktif, kullanici ACTIVE, doktorsuz, EDITOR/MANAGER)", async () => {
    await mkCoordinator(app);
    await mkCoordinator(app, { role: "MANAGER" });
    const off = await mkCoordinator(app);
    await app.prisma.coordinatorProfile.update({ where: { id: off.profileId }, data: { isActive: false } });
    const suspended = await mkCoordinator(app);
    await app.prisma.user.update({ where: { id: suspended.id }, data: { status: "SUSPENDED" } });
    const doc = await mkCoordinator(app);
    await app.prisma.doctorProfile.create({ data: { userId: doc.id, title: "Dr.", fullName: "Test Doc", slug: `doc-${doc.id.slice(0, 6)}`, bio: "x" } });
    const expected = 2;
    expect((await get()).json().data.activeCoordinators).toBe(expected);
  });

  it("dakika ServiceDesk.durationMin'den gelir; takma ad /site-metrics ayni veriyi doner; kisisel veri alani yok", async () => {
    await app.prisma.serviceDesk.upsert({ where: { id: "main" }, create: { id: "main", durationMin: 45 }, update: { durationMin: 45 } });
    await mkUser(app, "EDITOR");
    const a = (await get()).json().data;
    const b = (await get("/api/v1/site-metrics")).json().data;
    expect(a.consultationMinutes).toBe(45);
    expect(b).toEqual(a);
    expect(Object.keys(a).sort()).toEqual(["activeCoordinators", "activeServices", "consultationMinutes", "visitorLanguages"]);
  });
});
