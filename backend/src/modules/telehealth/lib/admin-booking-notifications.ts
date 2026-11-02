import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { env } from "../../../config/env";
import { sendBrandedMail } from "../../../lib/branded-mail";
import { doctorEmailName } from "../../../lib/doctor-email-name";
import { effectiveBookingNotificationRecipients } from "../../../lib/booking-notification-recipients";
import { buildBookingNotificationEmail, paymentLabel, type BookingNotificationEmailData } from "./booking-notification-email";
import { buildConsultationAdminEmail, formatRequestNumber } from "../../consultation-requests/consultation-request-email";

/**
 * Paket AG (Is 2) - her kesinlesen/iptal edilen/saati degisen randevuda admin alicilarina bildirim.
 *
 * - Cagri NOKTALARI mevcut akislarin SONUNDA (commit sonrasi) tek satirdir; bu modul ASLA firlatmaz.
 * - Istek BLOKLANMAZ: kayit senkron yazilir, ilk gonderim denemesi istegin disinda (arka plan promise'i) calisir;
 *   testler/kapanis `waitForAdminNotifications()` ile bekler.
 * - Idempotency: `AdminNotification.eventKey` tekil. Ayni olay ikinci kez gelirse (webhook tekrari vb.) kayit zaten
 *   vardir -> hicbir sey yapilmaz (cift gonderim yok).
 * - Alici basina AYRI e-posta; basarili aliclar `payload.deliveredTo`'ya hemen yazilir, retry yalniz kalanlara gider.
 * - Kuyruk/yeniden deneme: kayit once `pending` (+kira) yazilir. Tum aliclar basarili -> `sent`. Hata -> `pending` +
 *   `attempts++` + `nextAttemptAt` (1, 5, 15 dk); 4. denemeden sonra `failed`. Alici listesi bossa `skipped`.
 *   Sweeper (`registerAdminNotificationSweeper`) `pending && nextAttemptAt <= now` olanlari yeniden dener.
 * - Icerik gonderim aninda DB'den okunur; hasta adi/e-postasi/telefonu/sikayeti HIC okunmaz (select'te yok).
 */
export type BookingNotificationEvent =
  | { kind: "confirmed"; bookingId: string }
  | { kind: "cancelled"; bookingId: string; appointmentId?: string | null }
  | { kind: "rescheduled"; appointmentId: string; oldStartsAt: Date; oldEndsAt: Date; newStartsAt: Date }
  // Paket AH - danisma talebi (ayni altyapi: idempotent eventKey, yeniden deneme, alici basina gonderim). PII YOK.
  | { kind: "consultation_request"; requestId: string }
  // Paket AH - saatlik tekil bildirim tavani asildi: alicilara saatte EN FAZLA 1 uyari (eventKey saat kovasi). PII YOK.
  | { kind: "consultation_cap_reached"; hourBucket: string };

export const ADMIN_NOTIFICATION_MAX_ATTEMPTS = 4;
/** attempts (az once tamamlanan deneme sayisi) -> sonraki denemeye kadar bekleme. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];
/** Kira, SMTP zaman asimlarinin (`SMTP_TIMEOUT_MS`=15 sn, alici basina) cok USTUNDE: 10 alici x olasi zaman asimi < kira. */
const LEASE_MS = 10 * 60_000;
/** `sent`/`skipped`/`failed` kayitlari bu sureden sonra sweeper icinde silinir. */
const RETENTION_MS = 90 * 24 * 60 * 60_000;
export const ADMIN_NOTIFICATION_SWEEP_INTERVAL_MS = 60_000;
const SETTINGS_ID = "singleton";

interface NotificationPayload {
  oldStartsAt?: string;
  oldEndsAt?: string;
  newStartsAt?: string;
  /** Yalniz consultation_request: ConsultationRequest.id. */
  requestId?: string;
  /** Yalniz consultation_cap_reached: `YYYY-MM-DDTHH` (UTC). */
  hourBucket?: string;
  /** Basariyla gonderilmis alici adresleri (kucuk harf) - retry'da tekrar gonderilmez. */
  deliveredTo?: string[];
}

export function bookingEventKey(event: BookingNotificationEvent): string {
  switch (event.kind) {
    case "confirmed":
      return `booking:${event.bookingId}:confirmed`;
    case "cancelled":
      return event.appointmentId ? `appointment:${event.appointmentId}:cancelled` : `booking:${event.bookingId}:cancelled`;
    case "consultation_request":
      return `consultation-request:${event.requestId}:created`;
    case "consultation_cap_reached":
      return `consultation-cap:${event.hourBucket}`;
    case "rescheduled":
      // Eski + yeni baslangic: A->B->C->B zincirinde ucuncu olay (C->B) onceki B olayiyla carpismaz.
      return `appointment:${event.appointmentId}:rescheduled:${event.oldStartsAt.toISOString()}:${event.newStartsAt.toISOString()}`;
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

interface AdminMail {
  subject: string;
  preheader: string;
  title: string;
  bodyHtml: string;
  cta: { label: string; url: string };
}

/** Paket AH - danisma talebi bildirimi: yalniz PII'siz alanlar okunur (ad/e-posta/telefon/mesaj select'te YOK). */
async function loadConsultationMail(app: FastifyInstance, row: NotificationRow): Promise<AdminMail> {
  if (row.kind === "consultation_cap_reached") {
    const subject = "Consultation request notification cap reached";
    return {
      subject,
      preheader: subject,
      title: subject,
      bodyHtml: "<p>More than 30 consultation requests were received within the last hour. Individual notification emails are paused until the rate drops; every request remains visible in the admin panel.</p><p>This warning is sent at most once per hour.</p>",
      cta: { label: "Open requests", url: `${env.FRONTEND_URL.replace(/\/$/, "")}/admin/crm/leads?channel=CONSULTATION_REQUEST` },
    };
  }
  const requestId = ((row.payload ?? {}) as NotificationPayload).requestId;
  if (!requestId) throw new MissingEntityError();
  const request = await app.prisma.consultationRequest.findUnique({
    where: { id: requestId },
    select: { seq: true, leadId: true, serviceName: true, country: true, contactLanguage: true, needsInterpreter: true, preferredFrom: true, preferredTo: true },
  });
  if (!request) throw new MissingEntityError();
  return buildConsultationAdminEmail({
    requestNumber: formatRequestNumber(request.seq),
    serviceName: request.serviceName,
    country: request.country,
    contactLanguage: request.contactLanguage,
    needsInterpreter: request.needsInterpreter,
    preferredFrom: request.preferredFrom ? request.preferredFrom.toISOString().slice(0, 10) : null,
    preferredTo: request.preferredTo ? request.preferredTo.toISOString().slice(0, 10) : null,
    leadId: request.leadId,
    frontendUrl: env.FRONTEND_URL,
  });
}

/** Tek gonderim denemesi (alici basina ayri e-posta): sonucu satira yazar. Firlatmaz. */
async function attemptDelivery(app: FastifyInstance, row: NotificationRow): Promise<"sent" | "pending" | "failed" | "skipped"> {
  const now = new Date();
  const payload: NotificationPayload = { ...((row.payload ?? {}) as NotificationPayload) };
  const delivered = new Set((payload.deliveredTo ?? []).map((a) => a.toLowerCase()));
  let firstError: unknown = null;
  try {
    const recipients = await resolveBookingNotificationRecipients(app);
    if (recipients.length === 0) {
      await app.prisma.adminNotification.update({ where: { id: row.id }, data: { status: "skipped", nextAttemptAt: null } });
      return "skipped";
    }
    const remaining = recipients.filter((a) => !delivered.has(a));
    if (remaining.length > 0) {
      const mail: AdminMail = row.kind === "consultation_request" || row.kind === "consultation_cap_reached" ? await loadConsultationMail(app, row) : buildBookingNotificationEmail(await loadEmailData(app, row));
      for (const to of remaining) {
        try {
          await sendBrandedMail(app, { to, subject: mail.subject, locale: "en", audience: "staff", preheader: mail.preheader, title: mail.title, bodyHtml: mail.bodyHtml, cta: mail.cta });
          delivered.add(to);
          payload.deliveredTo = [...delivered];
          // Basari hemen kalici yazilir: surec cokse bile bu aliciya tekrar gonderilmez.
          await app.prisma.adminNotification.update({ where: { id: row.id }, data: { payload: payload as unknown as Prisma.InputJsonValue } });
        } catch (err) {
          firstError ??= err;
        }
      }
    }
    if (firstError) throw firstError;
    await app.prisma.adminNotification.update({
      where: { id: row.id },
      data: { status: "sent", attempts: row.attempts + 1, sentAt: new Date(), nextAttemptAt: null, lastError: null, payload: { ...payload, deliveredTo: [...delivered] } as unknown as Prisma.InputJsonValue },
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

const inflight = new Set<Promise<unknown>>();

/** Paket AH - baska modullerin (ornegin danisma talebi onay e-postasi) arka plan isi; `waitForAdminNotifications` bunu da bekler. */
export function trackAdminBackgroundTask(promise: Promise<unknown>): void {
  const task: Promise<unknown> = promise.catch(() => undefined).finally(() => inflight.delete(task));
  inflight.add(task);
}

/** Arka planda calisan gonderim denemelerinin bitmesini bekler (testler ve kapanis icin). */
export async function waitForAdminNotifications(): Promise<void> {
  while (inflight.size > 0) await Promise.allSettled([...inflight]);
}

/**
 * Olayi senkron KAYDEDER; ilk gonderim denemesi istegin disinda (arka planda) calisir - yanit SMTP'yi beklemez.
 * ASLA firlatmaz, akisi/yaniti degistirmez. Donus: `"queued"`; kayit zaten varsa `"duplicate"`.
 */
export async function notifyAdminsOfBookingEvent(app: FastifyInstance, event: BookingNotificationEvent): Promise<"queued" | "duplicate" | "error"> {
  try {
    const eventKey = bookingEventKey(event);
    const bookingId = event.kind === "rescheduled" || event.kind === "consultation_request" || event.kind === "consultation_cap_reached" ? null : event.bookingId;
    const appointmentId = event.kind === "rescheduled" ? event.appointmentId : event.kind === "cancelled" ? (event.appointmentId ?? null) : null;
    const payload: NotificationPayload =
      event.kind === "rescheduled"
        ? { oldStartsAt: event.oldStartsAt.toISOString(), oldEndsAt: event.oldEndsAt.toISOString(), newStartsAt: event.newStartsAt.toISOString() }
        : event.kind === "consultation_request"
          ? { requestId: event.requestId }
          : event.kind === "consultation_cap_reached"
            ? { hourBucket: event.hourBucket }
            : {};

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
          payload: payload as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, kind: true, bookingId: true, appointmentId: true, attempts: true, payload: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "duplicate";
      throw err;
    }
    const task: Promise<unknown> = attemptDelivery(app, row)
      .catch((err) => app.log.error({ reason: safeError(err) }, "Admin randevu bildirimi arka plan denemesi basarisiz."))
      .finally(() => inflight.delete(task));
    inflight.add(task);
    return "queued";
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
  // Eski sonuclanmis kayitlari temizle (pending'e dokunulmaz).
  await app.prisma.adminNotification
    .deleteMany({ where: { status: { in: ["sent", "skipped", "failed"] }, createdAt: { lt: new Date(now.getTime() - RETENTION_MS) } } })
    .catch((err) => app.log.error({ reason: safeError(err) }, "Eski admin bildirim kayitlari temizlenemedi."));
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
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await waitForAdminNotifications();
  });
}
