import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * Paket U (kararlar sonrası, madde 2) — randevu oluşturma (`lib/booking.ts`) ve görüntülü görüşme
 * (`telehealth.livekit.routes.ts` `/complete`) yanıtlarında doktor sorgusuna yalnızca `isFounder` ve
 * `publicName` eklendi: kurucu tam adla, diğerleri kısa adla, `publicName` doluysa o adla döner.
 * Ödeme rotaları (`checkout-session`, demo-pay) aynı seçimi kullanır; mevcut testleri ayrıca koşulur.
 */
const VALID_TEST_IDENTITY = { citizenshipType: "TR" as const, identityNumber: "10000000146", birthDate: "1990-01-01" };

function nextMondayNineAmUtc(): Date {
  const now = new Date();
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday));
  return new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 6, 0, 0));
}

describe("kurucu tam adla, diğerleri kısa adla (randevu oluşturma + görüşme tamamlama)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  async function createDoctor(fullName: string, extra: { isFounder?: boolean; publicName?: string | null } = {}) {
    const doctor = await app.prisma.doctorProfile.create({
      data: {
        title: "Doç. Dr.",
        fullName,
        slug: `doktor-${crypto.randomUUID().slice(0, 8)}`,
        bio: "Test.",
        languages: ["tr"],
        timeZone: "Europe/Istanbul",
        sessionDurationMin: 30,
        sessionPriceCents: 50000,
        currency: "TRY",
        isActive: true,
        isFounder: extra.isFounder ?? false,
        publicName: extra.publicName ?? null,
      },
    });
    await app.prisma.doctorAvailability.create({ data: { doctorId: doctor.id, dayOfWeek: 1, startMinute: 540, endMinute: 1020, isActive: true } });
    return doctor;
  }

  async function book(slug: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      remoteAddress: `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`,
      payload: {
        doctorSlug: slug,
        slots: [nextMondayNineAmUtc().toISOString()],
        patientName: "Test Hasta",
        patientEmail: `hasta-${crypto.randomUUID()}@example.com`,
        identity: VALID_TEST_IDENTITY,
        consent: true,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    adminToken = (await registerTestUser(app, { email: `admin-${crypto.randomUUID()}@example.com` })).accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it.each([
    ["kurucu", "Vahit MUTLU", { isFounder: true }, "Vahit MUTLU"],
    ["diğer", "Hakan SOFU", {}, "H. Sofu"],
    ["elle düzeltme", "Kamil ÖZDİL", { publicName: "Kamil Özdil" }, "Kamil Özdil"],
  ] as const)("%s: randevu oluşturma ve görüşme tamamlama yanıtı", async (_label, fullName, extra, expected) => {
    const doctor = await createDoctor(fullName, extra);
    const booking = await book(doctor.slug);
    expect(booking.appointments[0].doctor.fullName).toBe(expected);

    const completed = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${booking.appointments[0].id}/complete`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(completed.statusCode, completed.body).toBe(200);
    expect(completed.json().data.doctor.fullName).toBe(expected);
  });
});
