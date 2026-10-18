/**
 * Paket A2 (2026-10-18) — süresi geçmiş görüşmelerin otomatik kapatılması. `booking-expiry.ts` /
 * `appointment-reminders.ts` ile AYNI desen (süreç-içi `setInterval`, 5 dk kadans, `onClose`
 * temizliği, hata yakalanıp loglanır).
 *
 * Kimse "Tamamla" demediğinde randevu DB'de `SCHEDULED`/`IN_PROGRESS` olarak kalıyor ve geçmiş
 * sekmesinde "Devam Ediyor" görünüyordu. Kurallar (architect karar notu, rapora işlendi):
 *
 * - **Kesim booking bazındadır:** `getBookingJoinWindow(...).joinableUntil` (= `max(endsAt) + 15 dk`,
 *   katılım penceresiyle AYNI sabit) geçmeden booking'in HİÇBİR slotu kapanmaz. Booking'e bağlı
 *   olmayan (eski tekil akış) randevuda kendi `endsAt + JOIN_WINDOW_AFTER_END_MS` kullanılır.
 * - **Kanıt booking bazındadır:** token/`complete` her zaman ilk slot için çağrıldığından 2.+ slotlar
 *   hiç `startedAt` almaz. Booking'in HERHANGİ bir slotu `startedAt` dolu, `IN_PROGRESS` ya da
 *   `COMPLETED` ise açık slotlar → `COMPLETED` (`endedAt` boşsa planlanan `endsAt`); değilse → `NO_SHOW`.
 * - **Ödenmemiş booking (`paymentStatus !== "PAID"`) ATLANIR** ve yalnızca loglanır — bu satırlara
 *   zaten katılınamazdı, `NO_SHOW` yazmak ödeme sorununu hastanın kusuru gibi gösterirdi.
 * - Yalnızca `status` ve `endedAt` yazılır; ödeme, not, kayıt verisine DOKUNULMAZ. E-posta/webhook/
 *   revalidate tetiklenmez (bu modül bunları import etmez).
 * - Her geçiş AYNI transaction'da audit'e yazılır (`logAudit` hatayı yuttuğu için kullanılmaz —
 *   audit yazılamazsa geçiş de geri alınır, bir sonraki turda yeniden denenir).
 * - İdempotent: güncelleme okunan `fromStatus` koşuluyla yapılır, eşzamanlı `/complete` ya da
 *   ikinci tur 0 satır etkiler.
 *
 * Çekirdek fonksiyon `PrismaClient` alır ki `scripts/close-stale-appointments.ts` aynı mantığı
 * kullanabilsin.
 */
import type { FastifyInstance } from "fastify";
import type { AppointmentStatus, BookingPaymentStatus, Prisma, PrismaClient } from "@prisma/client";
import { getBookingJoinWindow, JOIN_WINDOW_AFTER_END_MS } from "../modules/telehealth/lib/booking";

export const APPOINTMENT_AUTO_CLOSE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
export const APPOINTMENT_AUTO_CLOSED_AUDIT_ACTION = "telehealth.appointment.auto_closed";

const OPEN_STATUSES = ["SCHEDULED", "IN_PROGRESS"] as const satisfies readonly AppointmentStatus[];

export type AutoCloseSource = "sweeper" | "backfill_script";
export type AutoCloseReason = "start_evidence" | "no_start_evidence";

export interface AutoCloseTransition {
  appointmentId: string;
  bookingId: string | null;
  doctorId: string;
  fromStatus: AppointmentStatus;
  toStatus: "COMPLETED" | "NO_SHOW";
  reason: AutoCloseReason;
  plannedEndsAt: Date;
  cutoffAt: Date;
  priceCents: number;
  currency: string;
}

export interface AutoCloseSkipped {
  bookingId: string;
  appointmentIds: string[];
  paymentStatus: BookingPaymentStatus;
}

export interface AutoCloseResult {
  /** `dryRun` ise YAPILACAK, değilse FİİLEN yapılan geçişler. */
  transitions: AutoCloseTransition[];
  /** Ödenmemiş booking'e bağlı açık randevular (anomali, dokunulmadı). */
  skippedUnpaid: AutoCloseSkipped[];
}

export interface AutoCloseOptions {
  now?: Date;
  dryRun?: boolean;
  source: AutoCloseSource;
}

type SlotRow = {
  id: string;
  bookingId: string | null;
  doctorId: string;
  status: AppointmentStatus;
  startsAt: Date;
  endsAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  priceCents: number;
  currency: string;
};

const SLOT_SELECT = {
  id: true,
  bookingId: true,
  doctorId: true,
  status: true,
  startsAt: true,
  endsAt: true,
  startedAt: true,
  endedAt: true,
  priceCents: true,
  currency: true,
} as const;

function isOpen(status: AppointmentStatus): boolean {
  return (OPEN_STATUSES as readonly AppointmentStatus[]).includes(status);
}

/**
 * SAF karar fonksiyonu — bir grubun (bir booking'in tüm slotları ya da tek bir tekil randevu) hangi
 * açık slotlarının neye geçeceğini hesaplar. Kesim geçmemişse ya da ödeme yoksa boş döner.
 */
export function planGroupTransitions(
  slots: readonly SlotRow[],
  paymentStatus: BookingPaymentStatus | null,
  now: Date
): { transitions: AutoCloseTransition[]; skippedUnpaid: boolean } {
  if (slots.length === 0) return { transitions: [], skippedUnpaid: false };

  let cutoffAt: Date;
  if (paymentStatus === null) {
    // Booking'e bağlı olmayan eski tekil randevu — tek slotluk grup.
    cutoffAt = new Date(Math.max(...slots.map((s) => s.endsAt.getTime())) + JOIN_WINDOW_AFTER_END_MS);
  } else {
    const { joinableUntil } = getBookingJoinWindow(slots, paymentStatus);
    if (!joinableUntil) {
      const hasOpen = slots.some((s) => isOpen(s.status));
      return { transitions: [], skippedUnpaid: hasOpen };
    }
    cutoffAt = joinableUntil;
  }
  if (now.getTime() <= cutoffAt.getTime()) return { transitions: [], skippedUnpaid: false };

  const started = slots.some((s) => s.startedAt !== null || s.status === "IN_PROGRESS" || s.status === "COMPLETED");
  const toStatus = started ? "COMPLETED" : "NO_SHOW";
  const reason: AutoCloseReason = started ? "start_evidence" : "no_start_evidence";

  const transitions = slots
    .filter((s) => isOpen(s.status))
    .map((s) => ({
      appointmentId: s.id,
      bookingId: s.bookingId,
      doctorId: s.doctorId,
      fromStatus: s.status,
      toStatus,
      reason,
      plannedEndsAt: s.endsAt,
      cutoffAt,
      priceCents: s.priceCents,
      currency: s.currency,
    })) satisfies AutoCloseTransition[];

  return { transitions, skippedUnpaid: false };
}

async function loadGroup(
  client: PrismaClient | Prisma.TransactionClient,
  key: { bookingId: string } | { appointmentId: string }
): Promise<{ slots: SlotRow[]; paymentStatus: BookingPaymentStatus | null }> {
  if ("bookingId" in key) {
    const booking = await client.appointmentBooking.findUnique({
      where: { id: key.bookingId },
      select: { paymentStatus: true, appointments: { select: SLOT_SELECT, orderBy: { startsAt: "asc" } } },
    });
    if (!booking) return { slots: [], paymentStatus: null };
    return { slots: booking.appointments, paymentStatus: booking.paymentStatus };
  }
  const slot = await client.appointment.findUnique({ where: { id: key.appointmentId }, select: SLOT_SELECT });
  return { slots: slot ? [slot] : [], paymentStatus: null };
}

async function applyTransitions(
  tx: Prisma.TransactionClient,
  transitions: readonly AutoCloseTransition[],
  slotsById: ReadonlyMap<string, SlotRow>,
  source: AutoCloseSource
): Promise<AutoCloseTransition[]> {
  const applied: AutoCloseTransition[] = [];
  for (const t of transitions) {
    const slot = slotsById.get(t.appointmentId);
    const data: Prisma.AppointmentUpdateManyMutationInput =
      t.toStatus === "COMPLETED" && !slot?.endedAt ? { status: t.toStatus, endedAt: t.plannedEndsAt } : { status: t.toStatus };
    const { count } = await tx.appointment.updateMany({ where: { id: t.appointmentId, status: t.fromStatus }, data });
    if (count !== 1) continue;
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: null,
        action: APPOINTMENT_AUTO_CLOSED_AUDIT_ACTION,
        targetType: "Appointment",
        targetId: t.appointmentId,
        ipAddress: null,
        metadata: {
          actor: "system",
          source,
          fromStatus: t.fromStatus,
          toStatus: t.toStatus,
          reason: t.reason,
          bookingId: t.bookingId,
          plannedEndsAt: t.plannedEndsAt.toISOString(),
          cutoffAt: t.cutoffAt.toISOString(),
        },
      },
    });
    applied.push(t);
  }
  return applied;
}

export async function runAppointmentAutoClose(prisma: PrismaClient, options: AutoCloseOptions): Promise<AutoCloseResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const prefilterCutoff = new Date(now.getTime() - JOIN_WINDOW_AFTER_END_MS);

  // Ön filtre: slotun KENDİSİ kesimi geçmiş olmalı (booking kesimi en az bu kadar geç olduğundan
  // güvenli bir üst kümedir); asıl karar grup bazında aşağıda verilir.
  const candidates = await prisma.appointment.findMany({
    where: { status: { in: [...OPEN_STATUSES] }, startsAt: { lt: prefilterCutoff }, endsAt: { lt: prefilterCutoff } },
    select: { id: true, bookingId: true },
    orderBy: { startsAt: "asc" },
  });

  const groupKeys = new Map<string, { bookingId: string } | { appointmentId: string }>();
  for (const c of candidates) {
    if (c.bookingId) groupKeys.set(`b:${c.bookingId}`, { bookingId: c.bookingId });
    else groupKeys.set(`a:${c.id}`, { appointmentId: c.id });
  }

  const result: AutoCloseResult = { transitions: [], skippedUnpaid: [] };
  for (const key of groupKeys.values()) {
    if (dryRun) {
      const { slots, paymentStatus } = await loadGroup(prisma, key);
      const plan = planGroupTransitions(slots, paymentStatus, now);
      result.transitions.push(...plan.transitions);
      if (plan.skippedUnpaid && "bookingId" in key && paymentStatus) {
        result.skippedUnpaid.push({ bookingId: key.bookingId, appointmentIds: slots.filter((s) => isOpen(s.status)).map((s) => s.id), paymentStatus });
      }
      continue;
    }

    // Her grup KENDİ transaction'ında — kanıt da transaction içinde okunur.
    const groupOutcome = await prisma.$transaction(async (tx) => {
      const { slots, paymentStatus } = await loadGroup(tx, key);
      const plan = planGroupTransitions(slots, paymentStatus, now);
      const applied = await applyTransitions(tx, plan.transitions, new Map(slots.map((s) => [s.id, s])), options.source);
      const skipped: AutoCloseSkipped | null =
        plan.skippedUnpaid && "bookingId" in key && paymentStatus
          ? { bookingId: key.bookingId, appointmentIds: slots.filter((s) => isOpen(s.status)).map((s) => s.id), paymentStatus }
          : null;
      return { applied, skipped };
    });
    result.transitions.push(...groupOutcome.applied);
    if (groupOutcome.skipped) result.skippedUnpaid.push(groupOutcome.skipped);
  }

  return result;
}

/** `registerBookingExpirySweeper` İLE AYNI desen: açılışta bir kez, sonra her 5 dakikada bir. */
export function registerAppointmentAutoCloseSweeper(app: FastifyInstance): void {
  // Aynı ödenmemiş-booking anomalisi her turda tekrar `warn` basmasın — yalnızca küme değişince.
  let lastSkippedKey = "";
  const runSweep = () => {
    runAppointmentAutoClose(app.prisma, { source: "sweeper" })
      .then((result) => {
        if (result.transitions.length > 0) {
          app.log.info(
            {
              completed: result.transitions.filter((t) => t.toStatus === "COMPLETED").length,
              noShow: result.transitions.filter((t) => t.toStatus === "NO_SHOW").length,
            },
            "Süresi geçmiş randevular otomatik kapatıldı (appointment-auto-close)"
          );
        }
        const skippedKey = result.skippedUnpaid
          .map((s) => s.bookingId)
          .sort()
          .join(",");
        if (skippedKey !== lastSkippedKey && result.skippedUnpaid.length > 0) {
          app.log.warn(
            { count: result.skippedUnpaid.length, bookingIds: result.skippedUnpaid.map((s) => s.bookingId) },
            "Ödenmemiş booking'e bağlı açık randevular otomatik kapatılmadı (appointment-auto-close)"
          );
        }
        lastSkippedKey = skippedKey;
      })
      .catch((err) => {
        app.log.error({ err }, "Randevu otomatik kapatma (appointment-auto-close) taraması başarısız oldu");
      });
  };

  runSweep();
  const timer = setInterval(runSweep, APPOINTMENT_AUTO_CLOSE_SWEEP_INTERVAL_MS);
  timer.unref();

  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
