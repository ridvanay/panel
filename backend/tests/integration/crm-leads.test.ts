import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { hashToken } from "../../src/lib/tokens";
import { DEFAULT_CRM_SETTINGS, writeCrmSettings } from "../../src/modules/crm/crm.settings";
import { resetFloodWindows } from "../../src/modules/crm/crm.collect";
import { anonymizeExpiredLeads, computeSla, runLeadIngest } from "../../src/modules/crm/crm.leads";
import { istanbulDate } from "../../src/modules/crm/crm.rollup";

/**
 * Paket N2 — talepler (içe alma, durumlar, notlar, eşleştirme önerileri, audit, CSV) ve hasta yolculuğu
 * hunisi (aşama sayıları, ciro, ilk/son temas).
 */
const ORIGIN = "http://localhost:3000";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function cid() {
  return crypto.randomBytes(16).toString("base64url").slice(0, 22);
}

async function collect(app: FastifyInstance, vid: string, sid: string, events: Record<string, unknown>[], ctx: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/crm/collect",
    headers: { origin: ORIGIN, "content-type": "text/plain", "user-agent": UA },
    payload: JSON.stringify({ v: 1, vid, sid, cv: "2026-10-23", mk: true, ctx, events: events.map((e) => ({ ts: Date.now(), ...e })), ...extra }),
  });
  expect(res.statusCode).toBe(204);
}

async function login(app: FastifyInstance, role: "ADMIN" | "MANAGER", twoFactor = true) {
  const { hashPassword } = await import("../../src/lib/password");
  const user = await app.prisma.user.create({
    data: {
      email: `crm-leads-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      name: `Leads ${role}`,
      passwordHash: await hashPassword("Sifre12345!"),
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: "Sifre12345!" } });
  if (twoFactor) await app.prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
  return { token: res.json().data.tokens.accessToken as string, userId: user.id };
}

async function createDoctor(app: FastifyInstance, slug = `dr-${crypto.randomUUID().slice(0, 8)}`) {
  return app.prisma.doctorProfile.create({
    data: { title: "Op. Dr.", fullName: "Test Cerrah", slug, bio: "x", languages: ["tr"], sessionPriceCents: 10000, currency: "EUR", isActive: true },
  });
}

async function createBooking(app: FastifyInstance, doctorId: string, opts: { email: string; paymentStatus: "PENDING" | "PAID" | "EXPIRED"; expiresAt?: Date; token?: string; totalCents?: number }) {
  return app.prisma.appointmentBooking.create({
    data: {
      bookingNumber: `B-${crypto.randomUUID().slice(0, 10)}`,
      doctorId,
      patientName: "Hasta Kişi",
      patientEmail: opts.email,
      slotCount: 1,
      unitPriceCents: opts.totalCents ?? 10000,
      subtotalCents: opts.totalCents ?? 10000,
      totalCents: opts.totalCents ?? 10000,
      currency: "EUR",
      paymentStatus: opts.paymentStatus,
      paidAt: opts.paymentStatus === "PAID" ? new Date() : null,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 30 * 60_000),
      meetingRoomName: `room_${crypto.randomBytes(16).toString("hex")}`,
      accessTokenHash: hashToken(opts.token ?? crypto.randomBytes(24).toString("hex")),
      consentAt: new Date(),
      consentVersion: "v1",
    },
  });
}

describe("CRM N2 — saf", () => {
  it("SLA: zamanında yanıt / geç yanıt / bekliyor / aşıldı", () => {
    const created = new Date("2026-10-23T08:00:00Z");
    expect(computeSla({ createdAt: created, firstResponseAt: new Date("2026-10-23T09:00:00Z") }, 2)).toEqual({ state: "met", minutes: 60 });
    expect(computeSla({ createdAt: created, firstResponseAt: new Date("2026-10-23T11:00:00Z") }, 2)).toEqual({ state: "late", minutes: 180 });
    expect(computeSla({ createdAt: created, firstResponseAt: null }, 2, new Date("2026-10-23T09:30:00Z"))).toEqual({ state: "pending", minutes: 30 });
    expect(computeSla({ createdAt: created, firstResponseAt: null }, 2, new Date("2026-10-23T12:00:00Z"))).toEqual({ state: "breached", minutes: 120 });
  });
});

describe("CRM N2 — talepler ve huni", () => {
  let app: FastifyInstance;
  let admin: { token: string; userId: string };
  const auth = () => ({ authorization: `Bearer ${admin.token}` });

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    admin = await login(app, "ADMIN");
    await app.prisma.contactForm.create({ data: { id: "singleton" } });
  });

  beforeEach(async () => {
    resetFloodWindows();
    await app.prisma.crmLead.deleteMany();
    await app.prisma.crmVisitor.deleteMany();
    await app.prisma.crmAttribution.deleteMany();
    await app.prisma.appointment.deleteMany();
    await app.prisma.appointmentBooking.deleteMany();
    await app.prisma.contactSubmission.deleteMany();
    await app.prisma.supportChatSession.deleteMany();
    await app.prisma.auditLog.deleteMany();
    await app.prisma.siteModule.deleteMany({ where: { key: { in: ["crm", "crm-state"] } } });
    await writeCrmSettings(app.prisma, { ...DEFAULT_CRM_SETTINGS, trackingEnabled: true }, null);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("MANAGER ve 2FA'sız ADMIN talep uçlarına erişemez", async () => {
    const manager = await login(app, "MANAGER");
    const admin0 = await login(app, "ADMIN", false);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/crm/leads", headers: { authorization: `Bearer ${manager.token}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/crm/leads", headers: { authorization: `Bearer ${admin0.token}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/crm/funnel?from=2026-10-01&to=2026-10-23", headers: { authorization: `Bearer ${manager.token}` } })).statusCode).toBe(403);
  });

  it("içe alma: form, canlı destek, yarım randevu, WhatsApp adayı (ziyaretçi bağlanmaz); idempotent; mevcut tablolar değişmez", async () => {
    const submission = await app.prisma.contactSubmission.create({
      data: { formId: "singleton", name: "Ayşe Yılmaz", email: "AYSE@example.com", data: { name: "Ayşe Yılmaz", email: "ayse@example.com", Telefon: "+90 555 111 22 33", message: "Diz ağrısı" } },
    });
    await app.prisma.supportChatSession.create({
      data: { visitorName: "John Smith", visitorEmail: "john@example.com", visitorPhone: "+44 7700 900123", locale: "en", accessTokenHash: crypto.randomBytes(32).toString("hex") },
    });
    const doctor = await createDoctor(app);
    await createBooking(app, doctor.id, { email: "maria@example.com", paymentStatus: "PENDING", expiresAt: new Date(Date.now() - 60_000) });
    await createBooking(app, doctor.id, { email: "paid@example.com", paymentStatus: "PAID" });
    const vid = cid();
    const sid = cid();
    await collect(app, vid, sid, [{ t: "pageview", p: "/en/doctors/x" }, { t: "whatsapp_click", p: "/en/doctors/x", hr: "https://wa.me/90555" }, { t: "whatsapp_click", p: "/en/doctors/x" }], { us: "google", um: "cpc", uc: "diz" }, { ref: "ABC234" });
    const submissionBefore = await app.prisma.contactSubmission.findUniqueOrThrow({ where: { id: submission.id } });

    expect((await runLeadIngest(app)).created).toBe(4);
    expect((await runLeadIngest(app)).created).toBe(0);

    const leads = await app.prisma.crmLead.findMany({ orderBy: { channel: "asc" } });
    const byChannel = Object.fromEntries(leads.map((l) => [l.channel, l]));
    expect(byChannel.CONTACT_FORM).toMatchObject({ name: "Ayşe Yılmaz", email: "ayse@example.com", phone: "+905551112233", status: "NEW", candidate: false, sourceRefId: submission.id });
    expect(byChannel.LIVE_CHAT).toMatchObject({ name: "John Smith", phone: "+447700900123", language: "en" });
    expect(byChannel.BOOKING_ABANDONED).toMatchObject({ email: "maria@example.com", doctorName: "Op. Dr. Test Cerrah", bookingId: null });
    expect(byChannel.WHATSAPP).toMatchObject({ candidate: true, refCode: "ABC234", source: "google", medium: "cpc", campaign: "diz", visitorId: null, name: null });
    expect(leads.some((l) => l.email === "paid@example.com")).toBe(false);
    expect(await app.prisma.contactSubmission.findUniqueOrThrow({ where: { id: submission.id } })).toEqual(submissionBefore);
  });

  it("liste filtreleri, durum değişimi (not + ilk yanıt), toplu durum, şifreli notlar, detay audit'i", async () => {
    const create = (body: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/v1/admin/crm/leads", headers: auth(), payload: body });
    const a = (await create({ name: "Ali Kaya", phone: "0555 123 45 67", email: "ali@example.com", note: "Bel fıtığı ameliyatı soruyor" })).json().data;
    const b = (await create({ name: "Bob", channel: "PHONE" })).json().data;
    expect(a).toMatchObject({ channel: "MANUAL", status: "NEW", phone: "05551234567", sla: { state: "pending" } });

    const list = await app.inject({ method: "GET", url: "/api/v1/admin/crm/leads?channel=PHONE", headers: auth() });
    expect(list.json().data.map((l: { id: string }) => l.id)).toEqual([b.id]);
    const byPhone = await app.inject({ method: "GET", url: "/api/v1/admin/crm/leads?q=1234567", headers: auth() });
    expect(byPhone.json().data.map((l: { id: string }) => l.id)).toEqual([a.id]);
    expect(byPhone.json().meta.statusCounts.NEW).toBe(1);

    const patched = await app.inject({ method: "PATCH", url: `/api/v1/admin/crm/leads/${a.id}`, headers: auth(), payload: { status: "CALLED", assignedToId: admin.userId, nextActionAt: new Date().toISOString() } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data).toMatchObject({ status: "CALLED", assignedToId: admin.userId, sla: { state: "met" } });
    expect(patched.json().data.firstResponseAt).not.toBeNull();
    expect((await app.inject({ method: "PATCH", url: `/api/v1/admin/crm/leads/${a.id}`, headers: auth(), payload: { status: "UNKNOWN" } })).statusCode).toBe(422);
    expect((await app.inject({ method: "PATCH", url: `/api/v1/admin/crm/leads/${a.id}`, headers: auth(), payload: { assignedToId: crypto.randomUUID() } })).statusCode).toBe(422);

    const today = await app.inject({ method: "GET", url: "/api/v1/admin/crm/leads/today", headers: auth() });
    expect(today.json().data.map((l: { id: string }) => l.id)).toEqual([a.id]);

    const bulk = await app.inject({ method: "POST", url: "/api/v1/admin/crm/leads/bulk-status", headers: auth(), payload: { ids: [a.id, b.id], status: "SPAM" } });
    expect(bulk.json().data.updated).toBe(2);

    const note = await app.inject({ method: "POST", url: `/api/v1/admin/crm/leads/${b.id}/notes`, headers: auth(), payload: { body: "Hasta MR sonucunu gönderecek" } });
    expect(note.statusCode).toBe(201);
    const raw = await app.prisma.crmLeadNote.findMany({ where: { leadId: { in: [a.id, b.id] } } });
    expect(raw.length).toBeGreaterThanOrEqual(4);
    for (const n of raw) {
      expect(n.bodyCiphertext).not.toContain("fıtığı");
      expect(n.bodyCiphertext).not.toContain("MR sonucunu");
    }

    const detail = await app.inject({ method: "GET", url: `/api/v1/admin/crm/leads/${a.id}`, headers: auth() });
    const notes = detail.json().data.notes.map((n: { body: string }) => n.body);
    expect(notes).toContain("Bel fıtığı ameliyatı soruyor");
    expect(notes).toContain("Durum: Yeni → Arandı");
    expect(notes).toContain("Durum: Arandı → Test/Spam");
    const audits = await app.prisma.auditLog.findMany({ where: { action: "crm.lead.viewed" } });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain("Ali Kaya");
  });

  it("randevu eşleştirme önerisi + admin onayıyla bağlama; ziyaretçi adayları (Ref kodu)", async () => {
    const doctor = await createDoctor(app);
    const booking = await createBooking(app, doctor.id, { email: "deniz@example.com", paymentStatus: "PAID" });
    const lead = (await app.inject({ method: "POST", url: "/api/v1/admin/crm/leads", headers: auth(), payload: { name: "Deniz", email: "Deniz@Example.com" } })).json().data;

    const detail = (await app.inject({ method: "GET", url: `/api/v1/admin/crm/leads/${lead.id}`, headers: auth() })).json().data;
    expect(detail.bookingId).toBeNull();
    expect(detail.bookingSuggestions).toEqual([expect.objectContaining({ id: booking.id, reason: "Aynı e-posta adresi", paymentStatus: "PAID" })]);

    const linked = await app.inject({ method: "PATCH", url: `/api/v1/admin/crm/leads/${lead.id}`, headers: auth(), payload: { bookingId: booking.id } });
    expect(linked.json().data.bookingId).toBe(booking.id);
    const after = (await app.inject({ method: "GET", url: `/api/v1/admin/crm/leads/${lead.id}`, headers: auth() })).json().data;
    expect(after.bookingSuggestions).toEqual([]);
    expect(after.linkedBooking).toMatchObject({ id: booking.id, bookingNumber: booking.bookingNumber });

    const vid = cid();
    await collect(app, vid, cid(), [{ t: "pageview", p: "/en" }], {}, { ref: "XYZ789" });
    await app.prisma.crmLead.update({ where: { id: lead.id }, data: { refCode: "XYZ789" } });
    const candidates = (await app.inject({ method: "GET", url: `/api/v1/admin/crm/leads/${lead.id}/visitor-candidates`, headers: auth() })).json().data;
    expect(candidates[0]).toMatchObject({ id: vid, reason: "Ref kodu eşleşti" });
    expect((await app.prisma.crmLead.findUniqueOrThrow({ where: { id: lead.id } })).visitorId).toBeNull();
    const visitorLinked = await app.inject({ method: "PATCH", url: `/api/v1/admin/crm/leads/${lead.id}`, headers: auth(), payload: { visitorId: vid } });
    expect(visitorLinked.json().data.visitorId).toBe(vid);
  });

  it("CSV dışa aktarma: audit'li, formül enjeksiyonu nötr; silme audit'li", async () => {
    const lead = (await app.inject({ method: "POST", url: "/api/v1/admin/crm/leads", headers: auth(), payload: { name: "=HYPERLINK(\"http://x\")", email: "x@example.com" } })).json().data;
    const csv = await app.inject({ method: "GET", url: "/api/v1/admin/crm/leads/export", headers: auth() });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.body).toContain("'=HYPERLINK");
    expect(csv.body.split("\r\n")[0]).toContain("Kanal");
    expect(await app.prisma.auditLog.count({ where: { action: "crm.export" } })).toBe(1);

    expect((await app.inject({ method: "DELETE", url: `/api/v1/admin/crm/leads/${lead.id}`, headers: auth() })).statusCode).toBe(204);
    expect(await app.prisma.auditLog.count({ where: { action: "crm.lead.deleted", targetId: lead.id } })).toBe(1);
    expect((await app.inject({ method: "GET", url: `/api/v1/admin/crm/leads/${lead.id}`, headers: auth() })).statusCode).toBe(404);
  });

  it("saklama: süresi dolan talepte kişi alanları ve notlar silinir", async () => {
    const lead = (await app.inject({ method: "POST", url: "/api/v1/admin/crm/leads", headers: auth(), payload: { name: "Eski Hasta", phone: "05550000000", note: "x" } })).json().data;
    await app.prisma.crmLead.update({ where: { id: lead.id }, data: { createdAt: new Date(Date.now() - 800 * 86_400_000) } });
    expect(await anonymizeExpiredLeads(app)).toBe(1);
    const row = await app.prisma.crmLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row).toMatchObject({ name: null, phone: null, email: null, bookingId: null, sourceRefId: null, assignedToId: null, landingPath: null });
    expect(row.anonymizedAt).not.toBeNull();
    expect(await app.prisma.crmLeadNote.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it("huni: aşama sayıları, ödenen ciro, görüşme; ilk/son temas ve doktor kırılımı", async () => {
    const doctor = await createDoctor(app, "huni-doktor");
    const today = istanbulDate();
    const v1 = cid();
    const s1 = cid();
    // 1. ziyaret: Google organik, doktor sayfası, sihirbaz yok
    await collect(app, v1, s1, [{ t: "pageview", p: "/en/doctors/huni-doktor" }], { rf: "https://www.google.com/" });
    // 2. ziyaret (aynı ziyaretçi, yeni oturum): bülten kampanyası, sihirbaz başladı, randevu oluştu ve ödendi
    const s2 = cid();
    await collect(app, v1, s2, [{ t: "pageview", p: "/en/doctors/huni-doktor" }, { t: "booking_step", p: "/en/doctors/huni-doktor", st: 3 }], { us: "newsletter", um: "email", uc: "ekim" });
    // 3. ziyaretçi: doğrudan, yalnızca ana sayfa
    await collect(app, cid(), cid(), [{ t: "pageview", p: "/en" }]);

    const token = crypto.randomBytes(24).toString("hex");
    const booking = await createBooking(app, doctor.id, { email: "huni@example.com", paymentStatus: "PAID", token, totalCents: 15000 });
    await app.prisma.appointment.create({
      data: {
        doctorId: doctor.id,
        patientName: "Huni",
        patientEmail: "huni@example.com",
        startsAt: new Date(Date.now() - 3 * 3600_000),
        endsAt: new Date(Date.now() - 2.5 * 3600_000),
        status: "COMPLETED",
        priceCents: 15000,
        currency: "EUR",
        meetingRoomName: `room_${crypto.randomBytes(16).toString("hex")}`,
        accessTokenHash: crypto.randomBytes(32).toString("hex"),
        bookingId: booking.id,
      },
    });
    const attr = await app.inject({
      method: "POST",
      url: "/api/v1/crm/attribution",
      headers: { origin: ORIGIN, "content-type": "text/plain", "user-agent": UA },
      payload: JSON.stringify({ bookingId: booking.id, token, sid: s2, vid: v1 }),
    });
    expect(attr.statusCode).toBe(204);
    // Ödenmemiş ikinci randevu: randevu sayılır, ciroya girmez
    const token2 = crypto.randomBytes(24).toString("hex");
    const pending = await createBooking(app, doctor.id, { email: "p@example.com", paymentStatus: "PENDING", token: token2 });
    const s3 = cid();
    const v3 = cid();
    await collect(app, v3, s3, [{ t: "pageview", p: "/en/doctors/huni-doktor" }, { t: "booking_step", p: "/en/doctors/huni-doktor", st: 2 }]);
    await app.inject({ method: "POST", url: "/api/v1/crm/attribution", headers: { origin: ORIGIN, "content-type": "text/plain", "user-agent": UA }, payload: JSON.stringify({ bookingId: pending.id, token: token2, sid: s3, vid: v3 }) });

    const get = (qs: string) => app.inject({ method: "GET", url: `/api/v1/admin/crm/funnel?from=${today}&to=${today}&${qs}`, headers: auth() });
    const last = (await get("model=last&groupBy=source")).json().data;
    expect(last.total).toMatchObject({ visits: 4, doctorPage: 3, bookingStarted: 2, bookings: 2, paid: 1, consulted: 1, revenue: { EUR: 15000 } });
    expect(last.total.conversionRate).toBe(25);
    const newsletter = last.rows.find((r: { key: string }) => r.key === "newsletter / email");
    expect(newsletter).toMatchObject({ visits: 1, bookingStarted: 1, bookings: 1, paid: 1, revenue: { EUR: 15000 } });

    const first = (await get("model=first&groupBy=source")).json().data;
    const google = first.rows.find((r: { key: string }) => r.key === "google / organic");
    expect(google).toMatchObject({ visits: 2, paid: 1, revenue: { EUR: 15000 } });

    const byDoctor = (await get("groupBy=doctor")).json().data;
    expect(byDoctor.rows[0]).toMatchObject({ key: "huni-doktor", label: "Op. Dr. Test Cerrah", visits: 3, bookingStarted: 2, bookings: 2, paid: 1 });

    expect((await get("groupBy=nope")).statusCode).toBe(422);
  });
});
