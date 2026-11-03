import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Paket AG (İş 3, kalan) — hizmete bağlı toplantı alanı (`serviceConsultation`), ADMIN/ev sahibi korumaları,
 * S3 (geri alınca yalnız genel toplantılar iptal), S5 (sonradan davet = yeni bağlantı + eskisi geçersiz).
 */
const lk = vi.hoisted(() => {
  process.env.LIVEKIT_URL = "wss://fake-project.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "fake-api-key";
  process.env.LIVEKIT_API_SECRET = "fake-api-secret-for-tests-only";
  return { rooms: new Map<string, string[]>(), mail: [] as Array<Record<string, unknown>> };
});

vi.mock("../../src/modules/telehealth/lib/livekit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/telehealth/lib/livekit")>();
  return {
    ...actual,
    listRoomParticipantIdentities: vi.fn(async (room: string) => [...(lk.rooms.get(room) ?? [])]),
    removeRoomParticipant: vi.fn(async () => true),
  };
});

vi.mock("../../src/lib/branded-mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/branded-mail")>();
  return {
    ...actual,
    sendBrandedMail: vi.fn(async (_app: unknown, input: Record<string, unknown>) => {
      lk.mail.push(input);
      return { messageId: "m1" };
    }),
  };
});

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { bearer, mkCoordinator, mkUser, nextIp, openDesk, seedConsultation } from "../helpers/service-desk";
import { generateGuestToken } from "../../src/modules/meetings/meeting-tokens";

let app: FastifyInstance;

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, user: { token: string }, payload?: unknown) {
  return app.inject({ method, url: `/api/v1${url}`, headers: bearer(user), ...(payload !== undefined ? { payload: payload as object } : {}), remoteAddress: nextIp("10.88") });
}

async function seedGeneral(hostUserId: string, startsInMin = 60) {
  const startsAt = new Date(Date.now() + startsInMin * 60_000);
  const { token, hash } = generateGuestToken();
  const meeting = await app.prisma.externalMeeting.create({
    data: {
      hostUserId,
      title: "Genel toplantı",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      durationMin: 30,
      maxParticipants: 4,
      roomName: `meet_${crypto.randomBytes(16).toString("hex")}`,
      guestTokenHash: hash,
      guestTokenCreatedAt: new Date(),
    },
  });
  return { meeting, token };
}

beforeAll(async () => {
  app = await buildTestApp();
  await resetDatabase(app.prisma);
  await openDesk(app);
});

afterAll(async () => {
  await resetDatabase(app.prisma);
  await app.close();
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;
});

beforeEach(async () => {
  lk.rooms.clear();
  lk.mail.length = 0;
});

describe("hizmete bağlı toplantı alanı ve korumaları", () => {
  it("ev sahibi listesi ve ADMIN listesi: bağlı toplantıda serviceConsultation.consultationNumber, genel toplantıda null", async () => {
    const admin = await mkUser(app, "ADMIN");
    const coord = await mkCoordinator(app, { role: "ADMIN" });
    const startsAt = new Date(Date.now() + 3 * 3600_000);
    const svc = await seedConsultation(app, { coordinatorProfileId: coord.profileId, coordinatorUserId: coord.id, startsAt });
    const general = await seedGeneral(coord.id, 240);

    const mine = await call("GET", "/meetings?scope=upcoming", coord);
    expect(mine.statusCode).toBe(200);
    const items = mine.json().data as Array<{ id: string; serviceConsultation: { consultationNumber: string } | null }>;
    const linked = items.find((m) => m.id === svc.meeting.id)!;
    expect(linked.serviceConsultation).toEqual({ consultationNumber: `SVC-${String(svc.consultation.seq).padStart(5, "0")}` });
    expect(items.find((m) => m.id === general.meeting.id)!.serviceConsultation).toBeNull();

    const adminList = await call("GET", "/admin/meetings?scope=all", admin);
    expect(adminList.statusCode).toBe(200);
    const adminItems = adminList.json().data as Array<{ id: string; serviceConsultation: unknown }>;
    expect(adminItems.find((m) => m.id === svc.meeting.id)!.serviceConsultation).toEqual(linked.serviceConsultation);
    expect(adminItems.find((m) => m.id === general.meeting.id)!.serviceConsultation).toBeNull();
    const adminHostNames = adminList.json().data as Array<{ id: string; hostName: string }>;
    expect(adminHostNames.find((m) => m.id === svc.meeting.id)!.hostName).toBe("Patient Coordinator · Ayşe K.");
    expect(adminHostNames.find((m) => m.id === general.meeting.id)!.hostName).toBe(coord.name);

    const detail = await call("GET", `/meetings/${svc.meeting.id}`, coord);
    expect(detail.json().data.serviceConsultation).toEqual(linked.serviceConsultation);
  });

  it("hizmete bağlı toplantı: ADMIN iptali 409 MEETING_MANAGED_BY_SERVICE_DESK; ev sahibi düzenle/iptal/bağlantı/davet 409", async () => {
    const admin = await mkUser(app, "ADMIN");
    const coord = await mkCoordinator(app, { role: "ADMIN" });
    const svc = await seedConsultation(app, { coordinatorProfileId: coord.profileId, coordinatorUserId: coord.id, startsAt: new Date(Date.now() + 3 * 3600_000) });

    const byAdmin = await call("POST", `/admin/meetings/${svc.meeting.id}/cancel`, admin);
    expect(byAdmin.statusCode).toBe(409);
    expect(byAdmin.json().error.code).toBe("MEETING_MANAGED_BY_SERVICE_DESK");

    for (const [method, url, body] of [
      ["PATCH", `/meetings/${svc.meeting.id}`, { title: "Yeni başlık" }],
      ["POST", `/meetings/${svc.meeting.id}/cancel`, undefined],
      ["POST", `/meetings/${svc.meeting.id}/guest-link`, {}],
      ["DELETE", `/meetings/${svc.meeting.id}/guest-link`, undefined],
      ["POST", `/meetings/${svc.meeting.id}/invite-email`, { email: "a@example.com" }],
    ] as const) {
      const res = await call(method, url, coord, body);
      expect(res.statusCode, `${method} ${url}`).toBe(409);
      expect(res.json().error.code).toBe("MEETING_MANAGED_BY_SERVICE_DESK");
    }
    const row = await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: svc.meeting.id } });
    expect(row.status).toBe("SCHEDULED");
    expect(row.guestTokenHash).not.toBeNull();
    expect(lk.mail).toHaveLength(0);
  });

  it("S3: yetki geri alınınca yalnız GENEL gelecek toplantılar iptal olur; hizmet görüşmesinin toplantısı SCHEDULED kalır", async () => {
    const admin = await mkUser(app, "ADMIN");
    const coord = await mkCoordinator(app, { role: "EDITOR" });
    await app.prisma.user.update({ where: { id: coord.id }, data: { meetingHostGrantedAt: new Date() } });
    const svc = await seedConsultation(app, { coordinatorProfileId: coord.profileId, coordinatorUserId: coord.id, startsAt: new Date(Date.now() + 3 * 3600_000) });
    const general = await seedGeneral(coord.id, 120);

    const res = await call("PATCH", `/admin/users/${coord.id}/meeting-host`, admin, { enabled: false });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.canHostMeetings).toBe(false);

    expect((await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: general.meeting.id } })).status).toBe("CANCELLED");
    const kept = await app.prisma.externalMeeting.findUniqueOrThrow({ where: { id: svc.meeting.id } });
    expect(kept.status).toBe("SCHEDULED");
    expect(kept.guestTokenHash).not.toBeNull();
    const revoked = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "user.meeting_host_revoked", targetId: coord.id } });
    expect(revoked.metadata).toMatchObject({ from: true, to: false, cancelledMeetings: 1 });
  });
});

describe("S5 — sonradan e-posta daveti", () => {
  it("guestLink verilmezse yeni bağlantı üretilir, eskisi geçersiz olur, yeni bağlantı yanıtta döner ve e-postadaki bağlantıdır", async () => {
    const host = await mkUser(app, "ADMIN");
    const created = await call("POST", "/meetings", host, { title: "Haftalık koordinasyon", startsAt: new Date(Date.now() + 3600_000).toISOString(), durationMin: 30, locale: "en" });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.meeting.id as string;
    const oldLink = created.json().data.guestLink as string;
    const oldToken = oldLink.slice(oldLink.lastIndexOf("#") + 1);

    const res = await call("POST", `/meetings/${id}/invite-email`, host, { email: "Konuk@Example.com", locale: "tr" });
    expect(res.statusCode).toBe(202);
    const data = res.json().data as { sent: boolean; guestLink: string };
    expect(data.sent).toBe(true);
    expect(data.guestLink).toMatch(/\/en\/meet\/join#mg_/);
    expect(data.guestLink).not.toBe(oldLink);

    // tr -> en (müşteri e-postası Türkçe olmaz); bağlantı e-postadakiyle aynı
    const mail = lk.mail[0] as { locale: string; cta: { url: string } };
    expect(mail.locale).toBe("en");
    expect(mail.cta.url.endsWith(data.guestLink)).toBe(true);

    // eski bağlantı geçersiz, yenisi geçerli
    const stale = await app.inject({ method: "POST", url: "/api/v1/meet/guest/preflight", payload: { t: oldToken }, remoteAddress: nextIp("10.89") });
    expect(stale.statusCode).toBe(404);
    const fresh = await app.inject({ method: "POST", url: "/api/v1/meet/guest/preflight", payload: { t: data.guestLink.slice(data.guestLink.lastIndexOf("#") + 1) }, remoteAddress: nextIp("10.89") });
    expect(fresh.statusCode).toBe(200);

    const audits = await app.prisma.auditLog.findMany({ where: { action: "meeting.guest_link.created", targetId: id } });
    expect(audits.some((a) => (a.metadata as { via?: string } | null)?.via === "invite_email")).toBe(true);
    expect(JSON.stringify(await app.prisma.auditLog.findMany())).not.toMatch(/Konuk|mg_/);
  });
});
