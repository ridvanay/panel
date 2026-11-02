import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { env } from "../../../config/env";
import { sendBrandedMail } from "../../../lib/branded-mail";
import { doctorEmailName } from "../../../lib/doctor-email-name";
import { effectiveBookingNotificationRecipients } from "../../../lib/booking-notification-recipients";
import { buildBookingNotificationEmail, paymentLabel, type BookingNotificationEmailData } from "./booking-notification-email";

/**
 * Paket AG (Is 2) - her kesinlesen/iptal edilen/saati degisen randevuda admin alicilarina bildirim.
 *
 * - Cagri NOKTALARI mevcut akislarin SONUNDA (commit sonrasi) tek satirdir; bu modul ASLA firlatmaz.
 * - Idempotency: `AdminNotification.eventKey` tekil. Ayni olay ikinci kez gelirse (webhook tekrari vb.) kayit zaten
 *   vardir -> hicbir sey yapilmaz (cift gonderim yok).
 * - Kuyruk/yeniden deneme: kayit once `pending` (+2 dk kira) yazilir, hemen gonderim denenir. Basari -> `sent`.
 *   Hata -> `pending` + `attempts++` + `nextAttemptAt` (1, 5, 15 dk); 4. denemeden sonra `failed`. Alici listesi bossa
 *   `skipped`. Sweeper (`registerAdminNotificationSweeper`) `pending && nextAttemptAt <= now` olanlari yeniden dener.
 * - Icerik gonderim aninda DB'den okunur; hasta adi/e-postasi/telefonu/sikayeti HIC okunmaz (select'te yok).
 */
export type BookingNotificationEvent =
  | { kind: "confirmed"; bookingId: string }
  | { kind: "cancelled"; bookingId: string; appointmentId?: string | null }
  | { kind: "rescheduled"; appointmentId: string; oldStartsAt: Date; oldEndsAt: Date; newStartsAt: Date };

export const ADMIN_NOTIFICATION_MAX_ATTEMPTS = 4;
/** attempts (az once tamamlanan deneme sayisi) -> sonraki denemeye kadar bekleme. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];
const LEASE_MS = 2 * 60_000;
export const ADMIN_NOTIFICATION_SWEEP_INTERVAL_MS = 60_000;
const SETTINGS_ID = "singleton";

interface NotificationPayload {
  oldStartsAt?: string;
  oldEndsAt?: string;
  newStartsAt?: string;
}

export function bookingEventKey(event: BookingNotificationEvent): string {
  switch (event.kind) {
    case "confirmed":
      return `booking:${event.bookingId}:confirmed`;
    case "cancelled":
      return event.appointmentId ? `appointment:${event.appointmentId}:cancelled` : `booking:${event.bookingId}:cancelled`;
    case "rescheduled":
      return `appointment:${event.appointmentId}:rescheduled:${event.newStartsAt.toISOString()}`;
  }
}

/** PII'siz, kisa hata ozeti (e-posta adresleri ayiklanir). */
function safeError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : "unknown";
  return raw.replace(/[^\s@]+@[^\s@]+/g, "[address]").slice(0, 200);
}

export async function resolveBookingNotificationRecipients(app: FastifyInstance): Promise<string[]> {
  const row = await app.prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID }, select: { bookingNotificationRecipients: true } });
  return effectiveBookingNotificationRecipients(row?.bookingNotificationRecipients);
}

interface NotificationRow {
  id: string;
  kind: string;
  bookingId: string | null;
  appointmentId: string | null;
  attempts: number;
  payload: Prisma.JsonValue;
}

class MissingEntityError extends Error {
  constructor() {
    super("entity_not_found");
    this.name = "MissingEntityError";
  }
}

/** Satirin olayini DB'den okuyarak e-posta iceriginin girdisini kurar (hasta PII'si okunmaz). */
async function loadEmailData(app: FastifyInstance, row: NotificationRow): Promise<BookingNotificationEmailData> {
  const kind = row.kind as BookingNotificationEmailData["kind"];
  const payload = (row.payload ?? {}) as NotificationPayload;
  let bookingId = row.bookingId;
  if (!bookingId && row.appointmentId) {
    const appt = await app.prisma.appointment.findUnique({ where: { id: row.appointmentId }, select: { bookingId: true } });
    bookingId = appt?.bookingId ?? null;
  }
  if (!bookingId) throw new MissingEntityError();

  const booking = await app.prisma.appointmentBooking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      bookingNumber: true,
      patientTimeZone: true,
      locale: true,
      paymentStatus: true,
      paidBy: true,
      doctor: { select: { title: true, translations: true, fullName: true, isFounder: true, publicName: true } },
      appointments: { select: { id: true, startsAt: true, endsAt: true, status: true }, orderBy: { startsAt: "asc" } },
      interpreterRequest: { select: { language: true } },
    },
  });
  if (!booking) throw new MissingEntityError();

  const base = {
    kind,
    bookingId: booking.id,
    bookingNumber: booking.bookingNumber,
    doctorName: doctorEmailName(booking.doctor, "en"),
    patientTimeZone: booking.patientTimeZone,
    frontendUrl: env.FRONTEND_URL,
  };

  if (kind === "confirmed") {
    return {
      ...base,
      slots: booking.appointments.filter((a) => a.status !== "CANCELLED").map((a) => ({ startsAt: a.startsAt, endsAt: a.endsAt })),
      interpreterLanguage: booking.interpreterRequest?.language ?? null,
      siteLocale: booking.locale,
      paymentLabel: paymentLabel(booking.paymentStatus, booking.paidBy),
    };
  }

  if (kind === "cancelled") {
    const cancelled = row.appointmentId
      ? booking.appointments.filter((a) => a.id === row.appointmentId)
      : booking.appointments.filter((a) => a.status === "CANCELLED");
    if (cancelled.length === 0) throw new MissingEntityError();
    return { ...base, slots: cancelled.map((a) => ({ startsAt: a.startsAt, endsAt: a.endsAt })) };
  }

  // rescheduled
  const target = booking.appointments.find((a) => a.id === row.appointmentId);
  if (!target || !payload.newStartsAt) throw new MissingEntityError();
  const newStartsAt = new Date(payload.newStartsAt);
  const durationMs = target.endsAt.getTime() - target.startsAt.getTime();
  return {
    ...base,
    slots: [{ startsAt: newStartsAt, endsAt: new Date(newStartsAt.getTime() + durationMs) }],
    previous: payload.oldStartsAt && payload.oldEndsAt ? { startsAt: new Date(payload.oldStartsAt), endsAt: new Date(payload.oldEndsAt) } : null,
  };
}

/** Tek gonderim denemesi: sonucu satira yazar. Firlatmaz. */
async function attemptDelivery(app: FastifyInstance, row: NotificationRow): Promise<"sent" | "pending" | "failed" | "skipped"> {
  const now = new Date();
  try {
    const recipients = await resolveBookingNotificationRecipients(app);
    if (recipients.length === 0) {
      await app.prisma.adminNotification.update({ where: { id: row.id }, data: { status: "skipped", nextAttemptAt: null } });
      return "skipped";
    }
    const mail = buildBookingNotificationEmail(await loadEmailData(app, row));
    await sendBrandedMail(app, {
      to: recipients.join(", "),
      subject: mail.subject,
      locale: "en",
      audience: "staff",
      preheader: mail.preheader,
      title: mail.title,
      bodyHtml: mail.bodyHtml,
      cta: mail.cta,
    });
    await app.prisma.adminNotification.update({
      where: { id: row.id },
      data: { status: "sent", attempts: row.attempts + 1, sentAt: new Date(), nextAttemptAt: null, lastError: null },
    });
    return "sent";
  } catch (err) {
    const attempts = row.attempts + 1;
    // Kalici hata (varlik yok) yeniden denemeyle duzelmez -> dogrudan failed.
    const exhausted = attempts >= ADMIN_NOTIFICATION_MAX_ATTEMPTS || err instanceof MissingEntityError;
    try {
      await app.prisma.adminNotification.update({
        where: { id: row.id },
        data: exhausted
          ? { status: "failed", attempts, nextAttemptAt: null, lastError: safeError(err) }
          : { status: "pending", attempts, nextAttemptAt: new Date(now.getTime() + RETRY_DELAYS_MS[attempts - 1]!), lastError: safeError(err) },
      });
    } catch (updateErr) {
      app.log.error({ err: safeError(updateErr), notificationId: row.id }, "Admin randevu bildirimi durumu yazilamadi.");
    }
    app.log.error({ notificationId: row.id, kind: row.kind, attempts, exhausted, reason: safeError(err) }, "Admin randevu bildirimi gonderilemedi.");
    return exhausted ? "failed" : "pending";
  }
}

/**
 * Olayi kaydeder ve hemen gondermeyi dener. ASLA firlatmaz, akisi/yaniti degistirmez.
 * Donus: gonderim sonucu (testler/log icin); kayit zaten varsa `"duplicate"`.
 */
export async function notifyAdminsOfBookingEvent(
  app: FastifyInstance,
  event: BookingNotificationEvent
): Promise<"sent" | "pending" | "failed" | "skipped" | "duplicate" | "error"> {
  try {
    const eventKey = bookingEventKey(event);
    const bookingId = event.kind === "rescheduled" ? null : event.bookingId;
    const appointmentId = event.kind === "rescheduled" ? event.appointmentId : event.kind === "cancelled" ? (event.appointmentId ?? null) : null;
    const payload: NotificationPayload | null =
      event.kind === "rescheduled"
        ? { oldStartsAt: event.oldStartsAt.toISOString(), oldEndsAt: event.oldEndsAt.toISOString(), newStartsAt: event.newStartsAt.toISOString() }
        : null;

    let row: NotificationRow;
    try {
      row = await app.prisma.adminNotification.create({
        data: {
          eventKey,
          kind: event.kind,
          bookingId,
          appointmentId,
          status: "pending",
          nextAttemptAt: new Date(Date.now() + LEASE_MS),
          ...(payload ? { payload: payload as unknown as Prisma.InputJsonValue } : {}),
        },
        select: { id: true, kind: true, bookingId: true, appointmentId: true, attempts: true, payload: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "duplicate";
      throw err;
    }
    return await attemptDelivery(app, row);
  } catch (err) {
    app.log.error({ reason: safeError(err) }, "Admin randevu bildirimi kaydedilemedi (best-effort).");
    return "error";
  }
}

export interface AdminNotificationSweepResult {
  retried: number;
  sent: number;
  failed: number;
}

/** `pending && nextAttemptAt <= now` olanlari yeniden dener (elle cagrilabilir; testler bunu kullanir). */
export async function runAdminNotificationSweep(app: FastifyInstance, now: Date = new Date()): Promise<AdminNotificationSweepResult> {
  const result: AdminNotificationSweepResult = { retried: 0, sent: 0, failed: 0 };
  const due = await app.prisma.adminNotification.findMany({
    where: { status: "pending", nextAttemptAt: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true, kind: true, bookingId: true, appointmentId: true, attempts: true, payload: true },
  });
  for (const row of due) {
    // Claim-first: kira suresi ileri alinir; baska bir instance ayni satiri almis olabilir.
    const claim = await app.prisma.adminNotification.updateMany({
      where: { id: row.id, status: "pending", nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
    });
    if (claim.count !== 1) continue;
    result.retried += 1;
    const outcome = await attemptDelivery(app, row);
    if (outcome === "sent") result.sent += 1;
    if (outcome === "failed") result.failed += 1;
  }
  return result;
}

/** `appointment-reminders.ts::registerAppointmentReminderSweeper` ile AYNI desen (setInterval, unref, onClose). */
export function registerAdminNotificationSweeper(app: FastifyInstance): void {
  const run = () => {
    runAdminNotificationSweep(app)
      .then((result) => {
        if (result.retried > 0) app.log.info(result, "Admin randevu bildirimi yeniden deneme taramasi tamamlandi");
      })
      .catch((err) => {
        app.log.error({ reason: safeError(err) }, "Admin randevu bildirimi taramasi basarisiz oldu");
      });
  };
  run();
  const timer = setInterval(run, ADMIN_NOTIFICATION_SWEEP_INTERVAL_MS);
  timer.unref();
  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
