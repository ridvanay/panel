import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";

/**
 * Paket L (2026-10-23) — `DoctorProfile.translations`: public `/doctors` ve `/doctors/:slug`
 * `?locale=` ile title/bio/aboutHtml/subSpecialty çevirisini döner; çeviri yoksa, dil kapalıysa ya da
 * varsayılan dil istenirse kanonik (EN) değer. `aboutHtml` çevirisi sanitize edilir; `translations`
 * DTO'ya sızmaz.
 */
describe("doktor çevirileri (Paket L)", () => {
  let app: FastifyInstance;
  let originalLocales: Awaited<ReturnType<FastifyInstance["prisma"]["locale"]["findMany"]>> = [];

  beforeAll(async () => {
    app = await buildTestApp();
    originalLocales = await app.prisma.locale.findMany();
  });

  beforeEach(async () => {
    await resetDatabase(app.prisma);
    await app.prisma.locale.deleteMany({ where: { code: { in: ["es", "de", "ar", "ru"] } } });
    await app.prisma.locale.updateMany({ data: { isDefault: false } });
    for (const l of [
      { code: "en", label: "İngilizce", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0 },
      { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: false, enabled: true, sortOrder: 1 },
      { code: "es", label: "İspanyolca", nativeLabel: "Español", isDefault: false, enabled: true, sortOrder: 2 },
      { code: "de", label: "Almanca", nativeLabel: "Deutsch", isDefault: false, enabled: true, sortOrder: 3 },
      { code: "ru", label: "Rusça", nativeLabel: "Русский", isDefault: false, enabled: false, sortOrder: 4 },
    ]) {
      await app.prisma.locale.upsert({ where: { code: l.code }, create: l, update: l });
    }
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, update: { enabled: true }, create: { key: "telehealth", enabled: true } });
    await app.prisma.doctorProfile.create({
      data: {
        title: "Assoc. Prof. Dr.",
        fullName: "Vahit Mutlu",
        slug: "vahit-mutlu",
        bio: "General surgeon.",
        aboutHtml: "<p>English biography</p>",
        subSpecialty: "Bariatric Surgery",
        languages: ["tr", "en"],
        timeZone: "Europe/Istanbul",
        isActive: true,
        translations: {
          es: { title: "Prof. Asoc. Dr.", bio: "Cirujano general.", aboutHtml: '<p>Biografía</p><script>alert(1)</script>', subSpecialty: "" },
          ru: { title: "Доцент", bio: "Хирург." },
        },
      },
    });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.prisma.locale.deleteMany({ where: { code: { in: ["es", "de", "ar", "ru"] } } });
    await app.prisma.locale.updateMany({ data: { isDefault: false } });
    for (const row of originalLocales) await app.prisma.locale.upsert({ where: { code: row.code }, create: row, update: row });
    await app.close();
  });

  async function getDoctor(query: string) {
    const res = await app.inject({ method: "GET", url: `/api/v1/doctors/vahit-mutlu${query}` });
    expect(res.statusCode).toBe(200);
    return res.json().data as Record<string, unknown>;
  }

  it("es: çevrilmiş alanlar döner, boş çeviri (subSpecialty) kanoniğe düşer, aboutHtml sanitize edilir", async () => {
    const doctor = await getDoctor("?locale=es");
    expect(doctor).toMatchObject({ title: "Prof. Asoc. Dr.", bio: "Cirujano general.", subSpecialty: "Bariatric Surgery", fullName: "Vahit Mutlu" });
    expect(doctor.aboutHtml).toContain("Biografía");
    expect(doctor.aboutHtml).not.toContain("<script");
    expect(doctor).not.toHaveProperty("translations");
  });

  it("çeviri yoksa (de), dil kapalıysa (ru), varsayılan dil (en) veya locale yoksa kanonik EN", async () => {
    for (const query of ["?locale=de", "?locale=ru", "?locale=en", "", "?locale=xx"]) {
      const doctor = await getDoctor(query);
      expect(doctor).toMatchObject({ title: "Assoc. Prof. Dr.", bio: "General surgeon.", aboutHtml: "<p>English biography</p>" });
    }
  });

  it("liste ucu da aynı kuralla çevirir", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/doctors?locale=es" });
    const [doctor] = res.json().data as Record<string, unknown>[];
    expect(doctor).toMatchObject({ title: "Prof. Asoc. Dr.", bio: "Cirujano general." });
  });
});
