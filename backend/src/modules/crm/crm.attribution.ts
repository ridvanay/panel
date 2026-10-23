import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { hashToken } from "../../lib/tokens";
import { readCrmSettings } from "./crm.settings";
import { CRM_CLIENT_ID } from "./crm.collect";
import { isBotUserAgent } from "./crm.privacy";

/**
 * Paket N1 — randevu atfı. Randevu/ödeme KODUNA DOKUNULMAZ: sihirbaz, randevu oluşunca bir tarayıcı
 * olayı yayar; takip modülü (yalnızca analitik onayıyla yüklüyse) bu uca `bookingId` + hastanın randevu
 * erişim token'ını gönderir. Sahiplik `accessTokenHash` karşılaştırmasıyla doğrulanır; token SAKLANMAZ.
 *
 * Yazılan şey OTURUM DÜZEYİNDE bir anlık görüntüdür (ilk/son kaynak, UTM, açılış sayfası, ülke, dil,
 * cihaz, pazarlama onayı varsa gclid). Ziyaretçi/oturum kimliği ve sayfa geçmişi randevuya BAĞLANMAZ.
 * Ciro, raporlama anında `appointment_bookings.totalCents/paymentStatus`'tan okunur.
 */
export const AttributionRequestSchema = z
  .object({
    bookingId: z.string().uuid(),
    token: z.string().min(16).max(300),
    sid: z.string().regex(CRM_CLIENT_ID),
    vid: z.string().regex(CRM_CLIENT_ID),
  })
  .strict();

export type AttributionRequest = z.infer<typeof AttributionRequestSchema>;

/** Randevu oluştuktan sonra atıf bu süre içinde yazılabilir (eski randevulara sonradan atıf eklenemez). */
const ATTRIBUTION_WINDOW_MS = 2 * 60 * 60 * 1000;

export type AttributionOutcome = "created" | "exists" | "ignored";

export async function recordBookingAttribution(
  app: FastifyInstance,
  input: AttributionRequest,
  meta: { userAgent: string | undefined; now?: Date }
): Promise<AttributionOutcome> {
  const settings = await readCrmSettings(app.prisma);
  if (!settings.trackingEnabled || isBotUserAgent(meta.userAgent)) return "ignored";
  const now = meta.now ?? new Date();

  const booking = await app.prisma.appointmentBooking.findUnique({
    where: { id: input.bookingId },
    select: { id: true, accessTokenHash: true, createdAt: true },
  });
  if (!booking || booking.accessTokenHash !== hashToken(input.token)) return "ignored";
  if (now.getTime() - booking.createdAt.getTime() > ATTRIBUTION_WINDOW_MS) return "ignored";

  const session = await app.prisma.crmSession.findUnique({ where: { id: input.sid }, include: { visitor: true } });
  if (!session || session.visitorId !== input.vid || session.botFlagged) return "ignored";

  try {
    await app.prisma.$transaction([
      app.prisma.crmAttribution.create({
        data: {
          bookingId: booking.id,
          firstSource: session.visitor.firstSource,
          firstMedium: session.visitor.firstMedium,
          firstCampaign: session.visitor.firstCampaign,
          lastSource: session.source,
          lastMedium: session.medium,
          lastCampaign: session.campaign,
          term: session.term,
          content: session.content,
          landingPath: session.landingPath,
          referrerHost: session.referrerHost,
          country: session.country,
          language: session.language,
          deviceType: session.deviceType,
          gclid: session.gclid,
          gbraid: session.gbraid,
          wbraid: session.wbraid,
        },
      }),
      app.prisma.crmEvent.create({
        data: {
          sessionId: session.id,
          visitorId: session.visitorId,
          type: "BOOKING_COMPLETED",
          occurredAt: now,
          path: session.exitPath ?? session.landingPath,
          deviceType: session.deviceType,
        },
      }),
    ]);
    return "created";
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "exists";
    throw err;
  }
}

export const ConsentRequestSchema = z
  .object({
    cid: z.string().regex(CRM_CLIENT_ID),
    vid: z.string().regex(CRM_CLIENT_ID).optional(),
    v: z.string().min(1).max(40),
    a: z.boolean(),
    m: z.boolean(),
    act: z.enum(["ACCEPT_ALL", "REJECT_ALL", "CUSTOM", "WITHDRAW"]),
    l: z.string().max(10).optional(),
  })
  .strict();

export type ConsentRequest = z.infer<typeof ConsentRequestSchema>;

/**
 * Onay kaydı. Reddetmede de yazılır (hesap verebilirlik); ziyaretçi kimliği yalnızca analitik onayında.
 * Analitik onayı GERİ ALINIRSA o cihazın anonim ziyaret verisi (ziyaretçi → oturum → olay) silinir.
 */
export async function recordConsent(app: FastifyInstance, input: ConsentRequest): Promise<void> {
  if (!input.a && input.vid) {
    await app.prisma.crmVisitor.deleteMany({ where: { id: input.vid } });
  }
  await app.prisma.crmConsent.create({
    data: {
      consentId: input.cid,
      visitorId: input.a ? (input.vid ?? null) : null,
      version: input.v,
      analytics: input.a,
      marketing: input.m,
      action: input.act,
      locale: input.l ?? null,
    },
  });
}
