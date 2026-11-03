import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ok } from "../../lib/envelope";
import { ApiError, ForbiddenError, ServiceNotBookableError, ValidationError } from "../../lib/errors";
import { authenticateOptional } from "../../middleware/authenticate";
import { ApiSuccessSchema } from "../../schemas/common";
import { sanitizeText } from "../crm/crm.privacy";
import { normalizeEmail, normalizePhone } from "../crm/crm.leads";
import { pickLocale, type PackageText } from "../packages/packages.shared";
import { cleanMessage } from "../consultation-requests/consultation-requests.routes";
import { MEETING_JOIN_LEAD_MS } from "../telehealth/lib/meeting-livekit";
import {
  MAX_SLOT_RANGE_DAYS,
  assertBookable,
  computeSlotsForRange,
  isBookable,
  loadDeskContext,
} from "./service-desk";
import {
  bookServiceConsultation,
  cancelServiceConsultation,
  findByManageToken,
  lookupFlags,
  rescheduleServiceConsultation,
} from "./service-booking";
import { confirmationAllowed, notifyStaffOfServiceEvent, sendPatientEmailOrAlert, sendPatientServiceEmail, warnIfBookingVolumeHigh } from "./service-consultation-notify";
import { trackAdminBackgroundTask } from "../telehealth/lib/admin-booking-notifications";
import { formatConsultationNumber } from "./service-consultation-tokens";
import { ipRateKey } from "./service-ip";
import {
  CreateServiceConsultationResponseSchema,
  CreateServiceConsultationSchema,
  ManageCancelResponseSchema,
  ManageLookupResponseSchema,
  ManageTokenBodySchema,
  RescheduleBodySchema,
  ServiceConfigSchema,
  ServiceSlotsQuerySchema,
  ServiceSlotsResponseSchema,
} from "./service-consultations.schemas";
import { safeErrorMessage } from "../../lib/log-safe";

const SLOTS_RATE_LIMIT = { max: 60, timeWindow: "1 minute" };
const BOOK_RATE_LIMIT = { max: 5, timeWindow: "1 minute", keyGenerator: (request: { ip: string }) => `svc-book:${ipRateKey(request.ip)}` };
const MANAGE_RATE_LIMIT = { max: 30, timeWindow: "1 minute" };
/** IP basina 24 saatte en cok bu kadar rezervasyon (takvim doldurmaya karsi). */
export const BOOKINGS_PER_IP_PER_DAY = 10;

function rangeDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Paket AI (Is 3) - herkese acik hizmet gorusmesi uclari (`/service-consultations`). Oturum ZORUNLU DEGIL (misafir);
 * oturum varsa yalnizca "doktor profilli kullanici rezervasyon yapamaz" kurali icin okunur. Yanitlarda katilim baglantisi,
 * yonetim belirteci ve koordinator kimligi YOKTUR: baglantilar yalnizca e-postaya gider.
 */
export async function serviceConsultationsPublicRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  // Yonetim baglantisi uclari: onbellek yok + arama motoru dizinlemesi yok (hook, rotalardan ONCE tanimlanmali).
  server.addHook("onRequest", async (request, reply) => {
    if (request.url.includes("/manage/")) {
      reply.header("Cache-Control", "no-store");
      reply.header("X-Robots-Tag", "noindex, nofollow");
    }
  });

  server.get("/config", { schema: { response: { 200: ApiSuccessSchema(ServiceConfigSchema) } } }, async (_request, reply) => {
    const ctx = await loadDeskContext(app.prisma);
    reply.header("Cache-Control", "public, max-age=60");
    return reply.send(
      ok({
        enabled: isBookable(ctx),
        timeZone: ctx.desk.timeZone,
        durationMin: ctx.desk.durationMin,
        minNoticeMin: ctx.desk.minNoticeMin,
        horizonDays: ctx.desk.horizonDays,
      })
    );
  });

  server.get(
    "/slots",
    { config: { rateLimit: SLOTS_RATE_LIMIT }, schema: { querystring: ServiceSlotsQuerySchema, response: { 200: ApiSuccessSchema(ServiceSlotsResponseSchema) } } },
    async (request, reply) => {
      const { from, to } = request.query;
      if (Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) {
        throw new ValidationError("Geçerli bir tarih girin.", { from: ["Geçerli bir tarih girin."] });
      }
      const days = rangeDays(from, to);
      if (days < 1 || days > MAX_SLOT_RANGE_DAYS) {
        throw new ValidationError(`Tarih aralığı 1-${MAX_SLOT_RANGE_DAYS} gün olmalı.`, { to: [`Tarih aralığı 1-${MAX_SLOT_RANGE_DAYS} gün olmalı.`] });
      }
      const ctx = await loadDeskContext(app.prisma);
      assertBookable(ctx);
      const result = await computeSlotsForRange(app.prisma, ctx, from, to, new Date());
      reply.header("Cache-Control", "no-store");
      return reply.send(
        ok({
          timeZone: ctx.desk.timeZone,
          durationMin: ctx.desk.durationMin,
          // Koordinator kimligi/sayisi YOK.
          slots: result.slots.map((s) => ({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
          days: result.days,
        })
      );
    }
  );

  server.post(
    "/",
    {
      preHandler: authenticateOptional,
      config: { rateLimit: BOOK_RATE_LIMIT },
      schema: { body: CreateServiceConsultationSchema, response: { 201: ApiSuccessSchema(CreateServiceConsultationResponseSchema) } },
    },
    async (request, reply) => {
      const body = request.body;
      const now = new Date();
      const ctx = await loadDeskContext(app.prisma);

      // Honeypot: bota sinyal verilmez; hicbir sey yazilmaz.
      if (body.website && body.website.trim().length > 0) {
        const endsAt = new Date(body.startsAt.getTime() + ctx.desk.durationMin * 60_000);
        return reply.status(201).send(
          ok({
            consultationNumber: formatConsultationNumber(10_000 + crypto.randomInt(90_000)),
            startsAt: body.startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            durationMin: ctx.desk.durationMin,
            joinOpensAt: new Date(body.startsAt.getTime() - MEETING_JOIN_LEAD_MS).toISOString(),
          })
        );
      }

      assertBookable(ctx);

      // Doktor hesabi hasta olarak rezervasyon yapamaz (mevcut booking kuraliyla tutarli).
      if (request.user) {
        const doctor = await app.prisma.doctorProfile.findUnique({ where: { userId: request.user.id }, select: { id: true } });
        if (doctor) throw new ForbiddenError("Doktor hesapları hizmet görüşmesi rezervasyonu yapamaz.");
      }

      // IP basina gunluk tavan (kayitli hizmet rezervasyonlari).
      if (request.ip) {
        // IPv4 tam adres, IPv6 /64 oneki: ayni onekteki tum adresler tek sayilir.
        const key = ipRateKey(request.ip);
        const recent = await app.prisma.consultationRequest.findMany({
          where: { ipAddress: { not: null }, createdAt: { gte: new Date(now.getTime() - 86_400_000) }, serviceConsultation: { isNot: null } },
          select: { ipAddress: true },
          take: 5000,
        });
        const today = recent.filter((r) => ipRateKey(r.ipAddress) === key).length;
        if (today >= BOOKINGS_PER_IP_PER_DAY) throw new ApiError(429, "RATE_LIMITED", "Günlük rezervasyon sınırına ulaşıldı.", { retryAfterSeconds: ["3600"] });
      }

      const email = normalizeEmail(body.email);
      if (!email) throw new ValidationError("Girdi doğrulama hatası.", { email: ["Geçerli bir e-posta adresi girin."] });

      const specialty = body.serviceSlug ? await app.prisma.specialty.findFirst({ where: { slug: body.serviceSlug, isActive: true }, select: { id: true, name: true } }) : null;
      if (body.serviceSlug && !specialty) throw new ServiceNotBookableError();
      const pkg = body.packageSlug
        ? await app.prisma.healthPackage.findFirst({ where: { slug: body.packageSlug, isActive: true }, select: { id: true, slug: true, translations: true } })
        : null;
      if (body.packageSlug && !pkg) throw new ServiceNotBookableError();

      const packageTitle = pkg ? sanitizeText(pickLocale<PackageText>(pkg.translations, "en")?.value.title ?? pkg.slug, 160) : null;
      const serviceName = sanitizeText(packageTitle && specialty ? `${packageTitle} (${specialty.name})` : (packageTitle ?? specialty?.name ?? ""), 200);
      const phone = body.phone && body.phone.trim() ? normalizePhone(body.phone) : null;

      const booked = await bookServiceConsultation(app, {
        specialtyId: specialty?.id ?? null,
        packageId: pkg?.id ?? null,
        serviceName,
        fullName: sanitizeText(body.fullName, 120),
        email,
        phone,
        country: body.country,
        contactLanguage: body.contactLanguage,
        needsInterpreter: body.needsInterpreter,
        interpreterLanguage: body.interpreterLanguage ? sanitizeText(body.interpreterLanguage, 12) : null,
        preferredContactChannel: body.preferredContactChannel ?? null,
        message: cleanMessage(body.message),
        healthDataConsent: body.healthDataConsent,
        locale: body.locale,
        patientTimeZone: body.patientTimeZone,
        startsAt: body.startsAt,
        ipAddress: request.ip ?? null,
        userAgent: sanitizeText(request.headers["user-agent"], 300) || null,
      });

      const c = booked.consultation;
      // Bildirimler istegin DISINDA; hata yutulur, yanit SMTP'yi beklemez.
      trackAdminBackgroundTask(
        (async () => {
          if (await confirmationAllowed(app, email, now)) {
            await sendPatientEmailOrAlert(app, { consultation: c, email, kind: "confirmed", joinToken: booked.joinToken, manageToken: booked.manageToken });
          }
          await warnIfBookingVolumeHigh(app, now);
        })().catch((err) => app.log.warn({ err: safeErrorMessage(err) }, "Hizmet görüşmesi onay e-postası gönderilemedi (best-effort).")),
      );
      notifyStaffOfServiceEvent(app, { consultationId: c.id, event: "booked" });

      return reply.status(201).send(
        ok({
          consultationNumber: formatConsultationNumber(c.seq),
          startsAt: c.startsAt.toISOString(),
          endsAt: c.endsAt.toISOString(),
          durationMin: booked.meeting.durationMin,
          joinOpensAt: new Date(c.startsAt.getTime() - MEETING_JOIN_LEAD_MS).toISOString(),
        })
      );
    }
  );

  // --- Yonetim baglantisi (sc_...): gecersiz belirtec her durumda TEK tip 404 -------------------------------------

  server.post(
    "/manage/lookup",
    { config: { rateLimit: MANAGE_RATE_LIMIT }, schema: { body: ManageTokenBodySchema, response: { 200: ApiSuccessSchema(ManageLookupResponseSchema) } } },
    async (request, reply) => {
      const c = await findByManageToken(app, request.body.t);
      const desk = await loadDeskContext(app.prisma);
      const flags = lookupFlags(c, desk.desk.minNoticeMin, new Date());
      return reply.send(
        ok({
          consultationNumber: formatConsultationNumber(c.seq),
          status: c.status,
          startsAt: c.startsAt.toISOString(),
          endsAt: c.endsAt.toISOString(),
          durationMin: c.meeting.durationMin,
          serviceName: c.serviceName,
          canCancel: flags.canCancel,
          canReschedule: flags.canReschedule && isBookable(desk),
          joinOpensAt: new Date(c.startsAt.getTime() - MEETING_JOIN_LEAD_MS).toISOString(),
        })
      );
    }
  );

  server.post(
    "/manage/cancel",
    { config: { rateLimit: MANAGE_RATE_LIMIT }, schema: { body: ManageTokenBodySchema, response: { 200: ApiSuccessSchema(ManageCancelResponseSchema) } } },
    async (request, reply) => {
      const c = await findByManageToken(app, request.body.t);
      const desk = await loadDeskContext(app.prisma);
      const result = await cancelServiceConsultation(app, c, { by: "patient", actorId: null, actorEmail: null, ipAddress: null }, desk.desk.minNoticeMin);
      if (result.changed) {
        trackAdminBackgroundTask(
          sendPatientServiceEmail(app, { consultation: c, email: c.request?.email ?? null, kind: "cancelled" }).catch(() => false),
        );
        notifyStaffOfServiceEvent(app, { consultationId: c.id, event: "cancelled" });
      }
      return reply.send(ok({ status: "CANCELLED" as const }));
    }
  );

  server.post(
    "/manage/reschedule",
    { config: { rateLimit: MANAGE_RATE_LIMIT }, schema: { body: RescheduleBodySchema, response: { 200: ApiSuccessSchema(ManageLookupResponseSchema) } } },
    async (request, reply) => {
      const c = await findByManageToken(app, request.body.t);
      const result = await rescheduleServiceConsultation(app, c, {
        startsAt: request.body.startsAt,
        patientTimeZone: request.body.patientTimeZone,
        ipAddress: request.ip ?? null,
      });
      const updated = result.consultation;
      const desk = await loadDeskContext(app.prisma);
      trackAdminBackgroundTask(
        sendPatientEmailOrAlert(app, {
          consultation: updated,
          email: c.request?.email ?? null,
          kind: "rescheduled",
          joinToken: result.joinToken,
          manageToken: request.body.t,
        }).catch(() => false),
      );
      notifyStaffOfServiceEvent(app, {
        consultationId: updated.id,
        event: "rescheduled",
        previousStartsAt: result.previousStartsAt,
        newStartsAt: updated.startsAt,
        previousCoordinatorId: result.previousCoordinatorId,
      });
      const flags = lookupFlags(updated, desk.desk.minNoticeMin, new Date());
      return reply.send(
        ok({
          consultationNumber: formatConsultationNumber(updated.seq),
          status: updated.status,
          startsAt: updated.startsAt.toISOString(),
          endsAt: updated.endsAt.toISOString(),
          durationMin: result.meeting.durationMin,
          serviceName: updated.serviceName,
          canCancel: flags.canCancel,
          canReschedule: flags.canReschedule,
          joinOpensAt: new Date(updated.startsAt.getTime() - MEETING_JOIN_LEAD_MS).toISOString(),
        })
      );
    }
  );
}
