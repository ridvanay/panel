import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * Paket U (C3) — ziyaretçiye açık doktor uçlarının hiçbir dilde, kurucu dışındaki doktorların tam adını
 * içermemesi; kurucunun tam adla, `publicName`'in elle düzeltme olarak gösterilmesi; admin uçlarının tam
 * adı vermesi ve `publicName` yazabilmesi. Görev dosyasındaki tüm örnek adlarla, 9 dilde.
 */
const DOCTORS = [
  { fullName: "Hakan SOFU", short: "H. Sofu" },
  { fullName: "Doğukan YILDIRIM", short: "D. Yıldırım" },
  { fullName: "Kamil ÖZDİL", short: "K. Özdil" },
  { fullName: "Ayşe Zehra ÖZDEMİR KAYA", short: "A. Z. Özdemir Kaya" },
  { fullName: "Hasan Tuna Türkmen", short: "H. T. Türkmen" },
  { fullName: "Ali FIRAT", short: "A. Fırat" },
  { fullName: "Kadir KOLCUOĞLU", short: "K. Kolcuoğlu" },
];
const FOUNDER = "Vahit MUTLU";
const LOCALES = ["en", "tr", "es", "de", "ar", "ru", "ro", "fr", "sr-latn"];

/** Tam adın ziyaretçi çıktısında geçebileceği biçimler (büyük/küçük harf farkıyla, ad + soyad). */
function fullNameForms(fullName: string): RegExp {
  const firstName = fullName.split(" ")[0]!;
  return new RegExp(firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
}

describe("doktor görünen adı (Paket U, C)", () => {
  let app: FastifyInstance;
  let auth: { authorization: string };
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    const admin = await registerTestUser(app);
    auth = { authorization: `Bearer ${admin.accessToken}` };
    const base = { title: "Prof. Dr.", bio: "Uzman hekim.", languages: ["tr", "en"], timeZone: "Europe/Istanbul", sessionDurationMin: 30, sessionPriceCents: 50000 };
    for (const [i, d] of [...DOCTORS, { fullName: FOUNDER, short: FOUNDER }].entries()) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/admin/telehealth/doctors",
        headers: auth,
        payload: { ...base, fullName: d.fullName, slug: `doctor-${i}`, isFounder: d.fullName === FOUNDER },
      });
      expect(res.statusCode, res.body).toBe(201);
      ids[d.fullName] = res.json().data.id;
    }
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("public liste ve profil: 9 dilde kısaltılmış ad; kurucu dışındaki doktorların adı (ilk ad) hiç geçmez", async () => {
    for (const locale of LOCALES) {
      const list = await app.inject({ method: "GET", url: `/api/v1/doctors?limit=50&locale=${locale}` });
      expect(list.statusCode).toBe(200);
      const body = list.body;
      for (const d of DOCTORS) {
        expect(body, `${locale} ${d.fullName}`).not.toMatch(fullNameForms(d.fullName));
        expect(body).toContain(d.short);
      }
      expect(body).toContain(FOUNDER);
      for (const [i, d] of DOCTORS.entries()) {
        const detail = (await app.inject({ method: "GET", url: `/api/v1/doctors/doctor-${i}?locale=${locale}` })).json().data;
        expect([detail.fullName, detail.displayName]).toEqual([d.short, d.short]);
        expect(JSON.stringify(detail)).not.toMatch(fullNameForms(d.fullName));
        expect(detail.publicName).toBeUndefined();
      }
    }
  });

  it("admin uçları tam adı verir; publicName yazılır, public'te otomatik kısaltmanın yerine geçer, boş metin geri alır", async () => {
    const adminList = (await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/doctors?limit=50", headers: auth })).json().data as { fullName: string }[];
    for (const d of DOCTORS) expect(adminList.map((x) => x.fullName)).toContain(d.fullName);

    const id = ids["Hakan SOFU"]!;
    const patch = await app.inject({ method: "PATCH", url: `/api/v1/admin/telehealth/doctors/${id}`, headers: auth, payload: { publicName: "Hakan Sofu" } });
    expect(patch.statusCode, patch.body).toBe(200);
    expect(patch.json().data).toMatchObject({ fullName: "Hakan SOFU", publicName: "Hakan Sofu", displayName: "Hakan Sofu" });
    expect((await app.inject({ method: "GET", url: "/api/v1/doctors/doctor-0" })).json().data.fullName).toBe("Hakan Sofu");

    await app.inject({ method: "PATCH", url: `/api/v1/admin/telehealth/doctors/${id}`, headers: auth, payload: { publicName: "  " } });
    const row = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id } });
    expect(row.publicName).toBeNull();
    expect(row.fullName).toBe("Hakan SOFU");
    expect((await app.inject({ method: "GET", url: "/api/v1/doctors/doctor-0" })).json().data.fullName).toBe("H. Sofu");

    const html = await app.inject({ method: "PATCH", url: `/api/v1/admin/telehealth/doctors/${id}`, headers: auth, payload: { publicName: "<b>x</b>" } });
    expect(html.statusCode).toBe(422);
  });
});
