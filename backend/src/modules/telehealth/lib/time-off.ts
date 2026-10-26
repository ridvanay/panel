import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { DoctorTimeOff } from "@prisma/client";
import { ValidationError } from "../../../lib/errors";

/**
 * Paket P (İş 2) — doktor izin/istisna aralıkları (`doctor_time_off`). Slot üretiminde düşülür;
 * mevcut haftalık kurallar, dolu randevu ve geçmiş saat kuralları AYNEN korunur (`lib/availability.ts`
 * değişmez — düşme işlemi üretilen slotlar üzerinde yapılır).
 *
 * KURALLAR:
 *  - Aralık UTC anlarıyla saklanır (`[startsAt, endsAt)`); "tam gün" istemcide doktorun diliminde
 *    gün başı/sonu olarak hesaplanıp gönderilir (`allDay` yalnızca gösterim bayrağıdır).
 *  - `note` İÇ nottur: sağlık verisi İÇERMEMELİ (admin formunda uyarı), hastaya/public uçlara ASLA dönmez.
 *  - Çakışma: aralıkta ONAYLI randevu (SCHEDULED/IN_PROGRESS) varsa kayıt ENGELLENMEZ; çakışan
 *    randevular yanıtta listelenir. Mevcut randevular otomatik iptal edilmez/değiştirilmez.
 */
export const TIME_OFF_KINDS = ["VACATION", "CONGRESS", "SURGERY_DAY", "OTHER"] as const;
export type TimeOffKind = (typeof TIME_OFF_KINDS)[number];

const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

export const CreateTimeOffRequestSchema = z
  .object({
    startsAt: z.string().datetime({ offset: false }),
    endsAt: z.string().datetime({ offset: false }),
    kind: z.enum(TIME_OFF_KINDS),
    allDay: z.boolean().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type CreateTimeOffRequest = z.infer<typeof CreateTimeOffRequestSchema>;

export const TimeOffIdParamSchema = z.object({ timeOffId: z.string().uuid() });

export const TimeOffConflictSchema = z.object({
  appointmentId: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  patientName: z.string(),
  bookingNumber: z.string().nullable(),
});
export type TimeOffConflictDto = z.infer<typeof TimeOffConflictSchema>;

export const TimeOffSchema = z.object({
  id: z.string(),
  doctorId: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  kind: z.enum(TIME_OFF_KINDS),
  allDay: z.boolean(),
  note: z.string().nullable(),
  createdAt: z.string(),
  /** Aralıktaki onaylı randevular (uyarı; kayıt engellenmez). */
  conflicts: z.array(TimeOffConflictSchema),
});
export type TimeOffDto = z.infer<typeof TimeOffSchema>;

export function parseTimeOffRange(input: Pick<CreateTimeOffRequest, "startsAt" | "endsAt">): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new ValidationError("Bitiş, başlangıçtan sonra olmalı.", { endsAt: ["Bitiş, başlangıçtan sonra olmalı."] });
  }
  if (endsAt.getTime() - startsAt.getTime() > MAX_RANGE_MS) {
    throw new ValidationError("İzin aralığı en fazla 366 gün olabilir.", { endsAt: ["İzin aralığı en fazla 366 gün olabilir."] });
  }
  return { startsAt, endsAt };
}

/** `[a, b)` ile `[c, d)` kesişiyor mu? */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Slot üretim sonucundan izin aralıklarıyla KESİŞEN slotları çıkarır (saf fonksiyon). */
export function subtractTimeOff<T extends { startsAt: Date; endsAt: Date }>(slots: T[], ranges: readonly { startsAt: Date; endsAt: Date }[]): T[] {
  if (ranges.length === 0) return slots;
  return slots.filter(
    (slot) => !ranges.some((r) => overlaps(slot.startsAt.getTime(), slot.endsAt.getTime(), r.startsAt.getTime(), r.endsAt.getTime()))
  );
}

/** Bir zaman penceresiyle kesişen izin aralıkları (slot uçları için). */
export async function findTimeOffInWindow(app: FastifyInstance, doctorId: string, from: Date, to: Date) {
  return app.prisma.doctorTimeOff.findMany({
    where: { doctorId, startsAt: { lt: to }, endsAt: { gt: from } },
    select: { startsAt: true, endsAt: true },
  });
}

/** Aralıktaki ONAYLI randevular (SCHEDULED/IN_PROGRESS) — uyarı listesi; hiçbirine dokunulmaz. */
export async function findConflictingAppointments(app: FastifyInstance, doctorId: string, startsAt: Date, endsAt: Date): Promise<TimeOffConflictDto[]> {
  const rows = await app.prisma.appointment.findMany({
    where: { doctorId, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    orderBy: { startsAt: "asc" },
    select: { id: true, startsAt: true, endsAt: true, patientName: true, booking: { select: { bookingNumber: true } } },
  });
  return rows.map((row) => ({
    appointmentId: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    patientName: row.patientName,
    bookingNumber: row.booking?.bookingNumber ?? null,
  }));
}

export function toTimeOffDto(row: DoctorTimeOff, conflicts: TimeOffConflictDto[]): TimeOffDto {
  return {
    id: row.id,
    doctorId: row.doctorId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    kind: (TIME_OFF_KINDS as readonly string[]).includes(row.kind) ? (row.kind as TimeOffKind) : "OTHER",
    allDay: row.allDay,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    conflicts,
  };
}

/** Liste: geçmişi 30 günden eski olmayan + gelecekteki izinler, her biri çakışmalarıyla. */
export async function listTimeOff(app: FastifyInstance, doctorId: string, now = new Date()): Promise<TimeOffDto[]> {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rows = await app.prisma.doctorTimeOff.findMany({ where: { doctorId, endsAt: { gt: since } }, orderBy: { startsAt: "asc" } });
  return Promise.all(rows.map(async (row) => toTimeOffDto(row, await findConflictingAppointments(app, doctorId, row.startsAt, row.endsAt))));
}

export async function createTimeOff(app: FastifyInstance, doctorId: string, body: CreateTimeOffRequest, createdById: string | null): Promise<TimeOffDto> {
  const { startsAt, endsAt } = parseTimeOffRange(body);
  const row = await app.prisma.doctorTimeOff.create({
    data: { doctorId, startsAt, endsAt, kind: body.kind, allDay: body.allDay ?? false, note: body.note?.trim() || null, createdById },
  });
  return toTimeOffDto(row, await findConflictingAppointments(app, doctorId, startsAt, endsAt));
}
