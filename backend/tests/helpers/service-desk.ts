import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { SiteRole } from "@prisma/client";
import { signAccessToken } from "../../src/lib/jwt";
import { generateGuestToken } from "../../src/modules/meetings/meeting-tokens";
import { generateManageToken } from "../../src/modules/service-consultations/service-consultation-tokens";
import { generateMeetingRoomName } from "../../src/modules/telehealth/lib/meeting-livekit";
import { encryptSecret } from "../../src/lib/crypto";

/** Paket AI (Is 3) test yardimcilari: kullanici/koordinator/masa fixture'lari ve dogrudan DB'ye gorusme yazma. */
let ipCounter = 0;
export function nextIp(prefix = "10.77"): string {
  ipCounter += 1;
  return `${prefix}.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

export function bearer(user: { token: string }) {
  return { authorization: `Bearer ${user.token}` };
}

export async function mkUser(app: FastifyInstance, role: SiteRole, extra: Record<string, unknown> = {}): Promise<TestUser & { name: string }> {
  const name = (extra.name as string | undefined) ?? `Test ${role} ${crypto.randomUUID().slice(0, 4)}`;
  const u = await app.prisma.user.create({
    data: { email: `svc-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`, passwordHash: "x", role, status: "ACTIVE", emailVerifiedAt: new Date(), twoFactorEnabled: true, ...extra, name },
  });
  return { id: u.id, email: u.email, name, token: signAccessToken({ sub: u.id, email: u.email }).token };
}

export async function mkCoordinator(app: FastifyInstance, opts: { displayName?: string; languages?: string[]; twoFactorEnabled?: boolean; role?: SiteRole } = {}) {
  const user = await mkUser(app, opts.role ?? "EDITOR", { twoFactorEnabled: opts.twoFactorEnabled ?? true });
  const profile = await app.prisma.coordinatorProfile.create({
    data: { userId: user.id, displayName: opts.displayName ?? "Ayşe K.", languages: opts.languages ?? ["en"] },
  });
  return { ...user, profileId: profile.id, displayName: profile.displayName };
}

export async function mkSpecialty(app: FastifyInstance, name = "Gastroenterology") {
  return app.prisma.specialty.create({ data: { name, slug: `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${crypto.randomUUID().slice(0, 6)}`, icon: "heart-pulse" } });
}

export async function openDesk(app: FastifyInstance, opts: { hours?: Array<[number, number, number]>; enabled?: boolean } = {}) {
  await app.prisma.serviceDesk.upsert({ where: { id: "main" }, create: { id: "main" }, update: {} });
  await app.prisma.serviceDeskHours.deleteMany({ where: { deskId: "main" } });
  const hours = opts.hours ?? [1, 2, 3, 4, 5, 6, 7].map((d) => [d, 9 * 60, 17 * 60] as [number, number, number]);
  await app.prisma.serviceDeskHours.createMany({ data: hours.map(([dayOfWeek, startMinute, endMinute]) => ({ deskId: "main", dayOfWeek, startMinute, endMinute })) });
  await app.prisma.siteSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", serviceBookingEnabled: opts.enabled ?? true },
    update: { serviceBookingEnabled: opts.enabled ?? true },
  });
}

/** Dogrudan DB'ye gorusme yazar (lead + talep + ExternalMeeting + ServiceConsultation); duz belirtecleri doner. */
export async function seedConsultation(
  app: FastifyInstance,
  opts: {
    coordinatorProfileId: string;
    coordinatorUserId: string;
    startsAt: Date;
    durationMin?: number;
    email?: string;
    fullName?: string;
    locale?: string;
    ipAddress?: string | null;
    message?: string | null;
    status?: "SCHEDULED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
    specialtyId?: string | null;
    needsInterpreter?: boolean;
    interpreterLanguage?: string | null;
    contactLanguage?: string;
  }
) {
  const durationMin = opts.durationMin ?? 30;
  const endsAt = new Date(opts.startsAt.getTime() + durationMin * 60_000);
  const join = generateGuestToken();
  const manage = generateManageToken();
  const lead = await app.prisma.crmLead.create({
    data: { channel: "CONSULTATION_REQUEST", status: "NEW", name: opts.fullName ?? "Seed Patient", email: opts.email ?? `seed-${crypto.randomUUID()}@example.com`, country: "DE", language: opts.contactLanguage ?? "en" },
  });
  const request = await app.prisma.consultationRequest.create({
    data: {
      leadId: lead.id,
      serviceName: "Gastroenterology",
      country: "DE",
      contactLanguage: opts.contactLanguage ?? "en",
      needsInterpreter: opts.needsInterpreter ?? false,
      fullName: opts.fullName ?? "Seed Patient",
      email: lead.email,
      phone: "+491701234567",
      messageEncrypted: opts.message ? encryptSecret(opts.message) : null,
      healthDataConsentAt: opts.message ? new Date() : null,
      contactConsentAt: new Date(),
      locale: opts.locale ?? "en",
      ipAddress: opts.ipAddress ?? null,
    },
  });
  const meeting = await app.prisma.externalMeeting.create({
    data: {
      hostUserId: opts.coordinatorUserId,
      title: "WM Health online consultation",
      startsAt: opts.startsAt,
      endsAt,
      durationMin,
      maxParticipants: 3,
      roomName: generateMeetingRoomName(),
      guestTokenHash: join.hash,
      guestTokenCreatedAt: new Date(),
      status: opts.status === "CANCELLED" ? "CANCELLED" : "SCHEDULED",
    },
  });
  const consultation = await app.prisma.serviceConsultation.create({
    data: {
      deskId: "main",
      coordinatorId: opts.coordinatorProfileId,
      meetingId: meeting.id,
      requestId: request.id,
      specialtyId: opts.specialtyId ?? null,
      serviceName: "Gastroenterology",
      startsAt: opts.startsAt,
      endsAt,
      status: opts.status ?? "SCHEDULED",
      patientTimeZone: "Europe/Berlin",
      locale: opts.locale ?? "en",
      needsInterpreter: opts.needsInterpreter ?? false,
      interpreterLanguage: opts.interpreterLanguage ?? null,
      manageTokenHash: manage.hash,
      consentVersion: "service-consultation-v1",
    },
  });
  return { consultation, meeting, request, lead, joinToken: join.token, manageToken: manage.token };
}

/** Masa gununun bugunku tarih anahtari (UTC bazli ±1 gun payli arama icin). */
export function isoDay(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export function bookingBody(specialtySlug: string, startsAt: string, over: Record<string, unknown> = {}) {
  return {
    serviceSlug: specialtySlug,
    packageSlug: null,
    country: "DE",
    contactLanguage: "en",
    needsInterpreter: false,
    fullName: "Max Mustermann",
    email: `max-${crypto.randomUUID().slice(0, 8)}@example.com`,
    phone: "+49 170 1234567",
    message: null,
    contactConsent: true,
    healthDataConsent: false,
    locale: "en",
    website: "",
    startsAt,
    patientTimeZone: "Europe/Berlin",
    ...over,
  };
}
