import type { FastifyInstance } from "fastify";
import type { ServiceConsultation } from "@prisma/client";
import { env } from "../../config/env";
import { sendBrandedMail } from "../../lib/branded-mail";
import { toCustomerEmailLocale } from "../../lib/branded-email";
import { notifyAdminsOfBookingEvent, trackAdminBackgroundTask } from "../telehealth/lib/admin-booking-notifications";
import { buildGuestLink } from "../meetings/meeting-tokens";
import { buildPatientServiceEmail, buildStaffServiceEmail, type ServiceEmailKind } from "./service-consultation-email";
import { buildManageLink, formatConsultationNumber } from "./service-consultation-tokens";
import { safeErrorMessage } from "../../lib/log-safe";

/** Posta bombasina karsi: YALNIZ adres basina saatte 3 onay e-postasi (site geneli tavan YOK: gercek hastanin onayi engellenmesin). */
export const CONFIRMATIONS_PER_ADDRESS_PER_HOUR = 3;
/** Site genelinde saatlik rezervasyon uyari esigi: asilirsa adminlere saatte en cok 1 uyari gider (rezervasyon ENGELLENMEZ). */
export const BOOKINGS_PER_HOUR_WARN = 20;

type EmailConsultation = Pick<ServiceConsultation, "id" | "seq" | "startsAt" | "endsAt" | "locale" | "patientTimeZone">;

/** Hastaya e-posta (best-effort; firlatmaz). Donus: gonderildi mi. Kisisel veri/belirtec loglanmaz. */
export async function sendPatientServiceEmail(
  app: FastifyInstance,
  params: { consultation: EmailConsultation; email: string | null; kind: ServiceEmailKind; joinToken?: string; manageToken?: string }
): Promise<boolean> {
  if (!params.email) return false;
  const c = params.consultation;
  const locale = c.locale ?? "en";
  try {
    const mail = buildPatientServiceEmail({
      kind: params.kind,
      locale,
      consultationNumber: formatConsultationNumber(c.seq),
      startsAt: c.startsAt,
      durationMin: Math.round((c.endsAt.getTime() - c.startsAt.getTime()) / 60_000),
      patientTimeZone: c.patientTimeZone,
      joinUrl: params.joinToken ? buildGuestLink(params.joinToken, locale) : null,
      manageUrl: params.manageToken ? buildManageLink(params.manageToken, locale) : null,
      bookAgainUrl: `${env.FRONTEND_URL.replace(/\/$/, "")}/${toCustomerEmailLocale(locale)}/book-consultation`,
    });
    await sendBrandedMail(app, {
      to: params.email,
      subject: mail.subject,
      preheader: mail.subject,
      bodyHtml: mail.bodyHtml,
      ...(mail.cta ? { cta: mail.cta } : {}),
      ...(mail.afterCtaHtml ? { afterCtaHtml: mail.afterCtaHtml } : {}),
      locale: mail.locale,
      audience: "patient",
    });
    return true;
  } catch (err) {
    app.log.warn({ err: safeErrorMessage(err), consultationId: c.id, kind: params.kind }, "Hizmet görüşmesi hasta e-postası gönderilemedi (best-effort).");
    return false;
  }
}

/** Onay e-postasi icin posta bombasi tavani (AH kurali). */
export async function confirmationAllowed(app: FastifyInstance, email: string, now: Date = new Date()): Promise<boolean> {
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const perAddress = await app.prisma.serviceConsultation.count({ where: { createdAt: { gte: hourAgo }, request: { email } } });
  return perAddress <= CONFIRMATIONS_PER_ADDRESS_PER_HOUR;
}

/**
 * Onay / saat degisikligi e-postasi: gonderilemezse PII'siz admin uyarisi (AdminNotification) yazar. Adres yoksa
 * (anonimlestirilmis) uyari gerekmez. Firlatmaz.
 */
export async function sendPatientEmailOrAlert(
  app: FastifyInstance,
  params: { consultation: EmailConsultation; email: string | null; kind: "confirmed" | "rescheduled"; joinToken?: string; manageToken?: string }
): Promise<boolean> {
  if (!params.email) return false;
  const sentOk = await sendPatientServiceEmail(app, params);
  if (!sentOk) {
    await notifyAdminsOfBookingEvent(app, {
      kind: "service_consultation_email_failed",
      consultationId: params.consultation.id,
      emailKind: params.kind,
      minuteBucket: new Date().toISOString().slice(0, 16),
    });
  }
  return sentOk;
}

/** Saatlik rezervasyon tavani asildiysa adminlere (saatte en cok 1) uyari; rezervasyonu ENGELLEMEZ. */
export async function warnIfBookingVolumeHigh(app: FastifyInstance, now: Date = new Date()): Promise<void> {
  const lastHour = await app.prisma.serviceConsultation.count({ where: { createdAt: { gte: new Date(now.getTime() - 3_600_000) } } });
  if (lastHour > BOOKINGS_PER_HOUR_WARN) await notifyAdminsOfBookingEvent(app, { kind: "service_consultation_cap_reached", hourBucket: now.toISOString().slice(0, 13) });
}

export type StaffServiceEvent = "booked" | "cancelled" | "rescheduled";

/**
 * Yonetici bildirimi (AG altyapisi, PII'siz) + atanan koordinatore e-posta (PII'siz, panel baglantisi). Istegi BLOKLAMAZ,
 * firlatmaz. `previousCoordinatorId`: saat degisikliginde koordinator degistiyse eskisine "iptal" e-postasi gider.
 */
export function notifyStaffOfServiceEvent(
  app: FastifyInstance,
  params: { consultationId: string; event: StaffServiceEvent; previousStartsAt?: Date; newStartsAt?: Date; previousCoordinatorId?: string | null }
): void {
  trackAdminBackgroundTask(
    (async () => {
      if (params.event === "booked") await notifyAdminsOfBookingEvent(app, { kind: "service_consultation_booked", consultationId: params.consultationId });
      else if (params.event === "cancelled") await notifyAdminsOfBookingEvent(app, { kind: "service_consultation_cancelled", consultationId: params.consultationId });
      else if (params.previousStartsAt && params.newStartsAt) {
        await notifyAdminsOfBookingEvent(app, {
          kind: "service_consultation_rescheduled",
          consultationId: params.consultationId,
          oldStartsAt: params.previousStartsAt,
          newStartsAt: params.newStartsAt,
        });
      }
      await sendCoordinatorEmails(app, params);
    })().catch((err) => app.log.warn({ err: safeErrorMessage(err) }, "Hizmet görüşmesi personel bildirimi gönderilemedi (best-effort).")),
  );
}

async function sendCoordinatorEmails(
  app: FastifyInstance,
  params: { consultationId: string; event: StaffServiceEvent; previousStartsAt?: Date; previousCoordinatorId?: string | null }
): Promise<void> {
  const c = await app.prisma.serviceConsultation.findUnique({
    where: { id: params.consultationId },
    select: {
      id: true,
      seq: true,
      serviceName: true,
      startsAt: true,
      endsAt: true,
      coordinatorId: true,
      needsInterpreter: true,
      interpreterLanguage: true,
      coordinator: { select: { displayName: true, languages: true, user: { select: { email: true } } } },
      request: { select: { contactLanguage: true } },
    },
  });
  if (!c) return;
  const base = {
    consultationNumber: formatConsultationNumber(c.seq),
    serviceName: c.serviceName,
    startsAt: c.startsAt,
    durationMin: Math.round((c.endsAt.getTime() - c.startsAt.getTime()) / 60_000),
    coordinatorName: c.coordinator.displayName,
    contactLanguage: c.request?.contactLanguage ?? null,
    needsInterpreter: c.needsInterpreter,
    interpreterLanguage: c.interpreterLanguage,
    coordinatorSpeaksInterpreterLanguage: Boolean(c.interpreterLanguage && c.coordinator.languages.map((l) => l.toLowerCase()).includes(c.interpreterLanguage.toLowerCase())),
    consultationId: c.id,
    frontendUrl: env.FRONTEND_URL,
  };
  const send = async (to: string, event: StaffServiceEvent) => {
    const mail = buildStaffServiceEmail({ ...base, event, audience: "coordinator", previousStartsAt: params.previousStartsAt ?? null });
    await sendBrandedMail(app, { to, subject: mail.subject, preheader: mail.preheader, title: mail.title, bodyHtml: mail.bodyHtml, cta: mail.cta, locale: "en", audience: "staff" });
  };
  // Saat degisikliginde yeni koordinatore "atandi", eski koordinatore "iptal" gider; ayni koordinatorse "saat degisti".
  const event: StaffServiceEvent = params.event === "rescheduled" && params.previousCoordinatorId && params.previousCoordinatorId !== c.coordinatorId ? "booked" : params.event;
  await send(c.coordinator.user.email, event);
  if (params.event === "rescheduled" && params.previousCoordinatorId && params.previousCoordinatorId !== c.coordinatorId) {
    const previous = await app.prisma.coordinatorProfile.findUnique({ where: { id: params.previousCoordinatorId }, select: { user: { select: { email: true } } } });
    if (previous) {
      const mail = buildStaffServiceEmail({ ...base, event: "cancelled", audience: "coordinator", previousStartsAt: null });
      await sendBrandedMail(app, { to: previous.user.email, subject: mail.subject, preheader: mail.preheader, title: mail.title, bodyHtml: mail.bodyHtml, cta: mail.cta, locale: "en", audience: "staff" });
    }
  }
}
