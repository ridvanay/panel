import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/** Paket AI (Is 3) - hizmet masasi admin uclari: RBAC, saatler, tatiller, koordinatorler, gorusme listesi/iptal. */
const mailSpy = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/mail")>();
  return { ...actual, sendMail: (...args: unknown[]) => (mailSpy(...args), Promise.resolve({ messageId: "test" })) };
});

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { waitForAdminNotifications } from "../../src/modules/telehealth/lib/admin-booking-notifications";
import { bearer, isoDay, mkCoordinator, mkSpecialty, mkUser, nextIp, openDesk, seedConsultation } from "../helpers/service-desk";

describe("Paket AI - hizmet masasi admin", () => {
  let app: FastifyInstance;
  let admin: Awaited<ReturnType<typeof mkUser>>;
  let manager: Awaited<ReturnType<typeof mkUser>>;
  let editor: Awaited<ReturnType<typeof mkUser>>;
  let c1: Awaited<ReturnType<typeof mkCoordinator>>;

  const api = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, who: { token: string }, payload?: unknown) =>
    app.inject({ method, url: `/api/v1/admin/service-desk${url}`, headers: bearer(who), ...(payload !== undefined ? { payload: payload as object } : {}), remoteAddress: nextIp("10.79") });

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app.prisma);
    mailSpy.mockClear();
    admin = await mkUser(app, "ADMIN");
    manager = await mkUser(app, "MANAGER");
    editor = await mkUser(app, "EDITOR");
    await mkSpecialty(app);
    c1 = await mkCoordinator(app);
    await openDesk(app);
  });

  it("RBAC: EDITOR 403 (tum uclar), oturumsuz 401; MANAGER okur/yazar; genel anahtari yalnizca ADMIN degistirir", async () => {
    expect((await api("GET", "/", editor)).statusCode).toBe(403);
    expect((await api("GET", "/coordinators", editor)).statusCode).toBe(403);
    expect((await api("GET", "/consultations", editor)).statusCode).toBe(403);
    expect((await api("PUT", "/hours", editor, { hours: [] })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/service-desk" })).statusCode).toBe(401);
    expect((await api("GET", "/", manager)).statusCode).toBe(200);
    expect((await api("PATCH", "/", manager, { minNoticeMin: 180 })).statusCode).toBe(200);
    const denied = await api("PATCH", "/", manager, { serviceBookingEnabled: false });
    expect(denied.statusCode).toBe(403);
    const okRes = await api("PATCH", "/", admin, { serviceBookingEnabled: false });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json().data.serviceBookingEnabled).toBe(false);
  });

  it("GET: masa varsayilanlari, saatler, yaklasan tatiller, istatistik", async () => {
    await app.prisma.serviceDeskClosure.create({ data: { deskId: "main", date: new Date(`${isoDay(10)}T00:00:00Z`), note: "Bayram" } });
    const res = await api("GET", "/", admin);
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.desk).toMatchObject({ timeZone: "Europe/Istanbul", durationMin: 30, minNoticeMin: 120, horizonDays: 30, maxParticipants: 3, paidEnabled: false });
    expect(d.serviceBookingEnabled).toBe(true);
    expect(d.hours).toHaveLength(7);
    expect(d.closures).toEqual([expect.objectContaining({ date: isoDay(10), note: "Bayram" })]);
    expect(d.stats.activeCoordinators).toBe(1);
    expect(d.stats.next7DaysSlots).toBeGreaterThan(0);
  });

  it("PATCH: paidEnabled=true -> 422 PAID_CONSULTATIONS_DISABLED; sure 15/20/30/45/60 kabul, 75 ve 33 red; audit", async () => {
    const paid = await api("PATCH", "/", admin, { paidEnabled: true });
    expect(paid.statusCode).toBe(422);
    expect(paid.json().error.code).toBe("PAID_CONSULTATIONS_DISABLED");
    for (const m of [15, 20, 30, 45, 60]) expect((await api("PATCH", "/", admin, { durationMin: m })).statusCode).toBe(200);
    expect((await api("PATCH", "/", admin, { durationMin: 75 })).statusCode).toBe(422);
    expect((await api("PATCH", "/", admin, { durationMin: 33 })).statusCode).toBe(422);
    expect((await api("PATCH", "/", admin, { timeZone: "Mars/X" })).statusCode).toBe(422);
    expect(await app.prisma.auditLog.count({ where: { action: "service_desk.updated" } })).toBeGreaterThan(0);
  });

  it("PUT hours: { hours } govdesi, { hours } yaniti; cakisma 422; gecersiz aralik 422; tam liste degisir", async () => {
    const good = await api("PUT", "/hours", admin, { hours: [{ dayOfWeek: 1, startMinute: 540, endMinute: 720 }, { dayOfWeek: 1, startMinute: 780, endMinute: 1020 }] });
    expect(good.statusCode).toBe(200);
    expect(good.json().data.hours).toHaveLength(2);
    expect(await app.prisma.serviceDeskHours.count()).toBe(2);
    const overlap = await api("PUT", "/hours", admin, { hours: [{ dayOfWeek: 2, startMinute: 540, endMinute: 720 }, { dayOfWeek: 2, startMinute: 700, endMinute: 800 }] });
    expect(overlap.statusCode).toBe(422);
    const inverted = await api("PUT", "/hours", admin, { hours: [{ dayOfWeek: 2, startMinute: 700, endMinute: 600 }] });
    expect(inverted.statusCode).toBe(422);
    expect(await app.prisma.serviceDeskHours.count()).toBe(2);
  });

  it("tatil gunu: ekle/sil; ayni gun 409; o gunde SCHEDULED gorusme varsa 409 CLOSURE_HAS_CONSULTATIONS details.count", async () => {
    const day = isoDay(5);
    const add = await api("POST", "/closures", admin, { date: day, note: "Ic not" });
    expect(add.statusCode).toBe(201);
    expect((await api("POST", "/closures", admin, { date: day })).statusCode).toBe(409);
    expect((await api("DELETE", `/closures/${add.json().data.id}`, admin)).statusCode).toBe(204);
    expect(await app.prisma.serviceDeskClosure.count()).toBe(0);
    await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: new Date(`${isoDay(6)}T10:00:00Z`) });
    const blocked = await api("POST", "/closures", admin, { date: isoDay(6) });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("CLOSURE_HAS_CONSULTATIONS");
    expect(blocked.json().error.details.count).toEqual(["1"]);
  });

  it("koordinator: adaylar (doktor/zaten koordinator haric); doktor profilli 422 COORDINATOR_NOT_ELIGIBLE; varsayilan ad unvansiz; unvanli ad reddi", async () => {
    const candidate = await mkUser(app, "EDITOR", { name: "Dr. Ayşe Kaya" });
    const customer = await mkUser(app, "CUSTOMER");
    const doc = await mkUser(app, "EDITOR");
    const sp = await mkSpecialty(app, "Cardiology");
    await app.prisma.doctorProfile.create({
      data: { title: "Dr.", fullName: "Doktor", slug: `d-${doc.id}`, bio: "x", languages: ["tr"], timeZone: "Europe/Istanbul", specialtyId: sp.id, sessionDurationMin: 30, sessionPriceCents: 1, currency: "TRY", isActive: true, userId: doc.id },
    });
    const cands = (await api("GET", "/coordinator-candidates", manager)).json().data as Array<{ id: string }>;
    const ids = cands.map((c) => c.id);
    expect(ids).toContain(candidate.id);
    expect(ids).not.toContain(doc.id);
    expect(ids).not.toContain(customer.id);
    expect(ids).not.toContain(c1.id);
    const bad = await api("POST", "/coordinators", admin, { userId: doc.id, languages: [] });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe("COORDINATOR_NOT_ELIGIBLE");
    expect((await api("POST", "/coordinators", admin, { userId: customer.id, languages: [] })).statusCode).toBe(422);
    expect((await api("POST", "/coordinators", admin, { userId: candidate.id, displayName: "Dr. Ayşe K.", languages: [] })).statusCode).toBe(422);
    const created = await api("POST", "/coordinators", admin, { userId: candidate.id, languages: ["en", "AR"] });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ displayName: "Ayşe K.", languages: ["en", "ar"], isActive: true });
    expect((await api("POST", "/coordinators", admin, { userId: candidate.id, languages: [] })).statusCode).toBe(409);
    expect((await api("GET", "/coordinators", manager)).json().data).toHaveLength(2);
  });

  it("koordinator pasiflestirme: gelecek SCHEDULED gorusme varsa 409 COORDINATOR_HAS_UPCOMING_CONSULTATIONS; yoksa serbest", async () => {
    await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: new Date(Date.now() + 2 * 86_400_000) });
    const res = await api("PATCH", `/coordinators/${c1.profileId}`, admin, { isActive: false });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("COORDINATOR_HAS_UPCOMING_CONSULTATIONS");
    expect(res.json().error.details.count).toEqual(["1"]);
    const c2 = await mkCoordinator(app, { displayName: "Bora T." });
    const off = await api("PATCH", `/coordinators/${c2.profileId}`, admin, { isActive: false, languages: ["de"], displayName: "Bora Tan" });
    expect(off.statusCode).toBe(200);
    expect(off.json().data).toMatchObject({ isActive: false, languages: ["de"], displayName: "Bora Tan" });
  });

  it("gorusme listesi: hasta adi yalniz bas harfli; sayfalama meta; detay PII + audit; admin iptali", async () => {
    const a = await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: new Date(Date.now() + 2 * 86_400_000), fullName: "Zeynep Gizli", email: "z@example.com" });
    await seedConsultation(app, { coordinatorProfileId: c1.profileId, coordinatorUserId: c1.id, startsAt: new Date(Date.now() + 3 * 86_400_000) });
    const list = await api("GET", "/consultations?page=1&pageSize=1", manager);
    expect(list.statusCode).toBe(200);
    expect(list.json().meta).toEqual({ page: 1, pageSize: 1, total: 2, hasNext: true });
    const full = await api("GET", "/consultations", manager);
    const row = (full.json().data as Array<{ id: string; patientInitials: string }>).find((r) => r.id === a.consultation.id)!;
    expect(row.patientInitials).toBe("Z. G.");
    expect(JSON.stringify(full.json())).not.toMatch(/Zeynep|Gizli|z@example\.com/);
    expect((await api("GET", "/consultations?status=CANCELLED", manager)).json().data).toHaveLength(0);
    const detail = await api("GET", `/consultations/${a.consultation.id}`, manager);
    expect(detail.json().data).toMatchObject({ patientName: "Zeynep Gizli", email: "z@example.com", country: "DE", patientTimeZone: "Europe/Berlin", cancelledAt: null });
    expect(await app.prisma.auditLog.count({ where: { action: "service_consultation.admin_viewed" } })).toBe(1);
    const cancel = await api("POST", `/consultations/${a.consultation.id}/cancel`, manager, { reason: "test" });
    expect(cancel.statusCode).toBe(200);
    await waitForAdminNotifications();
    const after = await app.prisma.serviceConsultation.findUniqueOrThrow({ where: { id: a.consultation.id }, include: { meeting: true } });
    expect(after.status).toBe("CANCELLED");
    expect(after.cancelledBy).toBe("admin");
    expect(after.meeting.guestTokenHash).toBeNull();
    expect(await app.prisma.auditLog.count({ where: { action: "service_desk.consultation_cancelled" } })).toBe(1);
    expect((await api("GET", `/consultations/${a.consultation.id}`, manager)).json().data.cancelledAt).not.toBeNull();
    expect((await api("POST", `/consultations/00000000-0000-4000-8000-000000000000/cancel`, manager, {})).statusCode).toBe(404);
  });
});
