import type { FastifyInstance } from "fastify";
import { generateAvailableSlots } from "./availability";
import { getWallClockParts } from "./timezone";
import { subtractTimeOff } from "./time-off";

/**
 * Paket P (İş 2) — doktor kartları ve profil kutusu için "En erken uygun randevu" anı. Public slot
 * ucuyla AYNI kurallar: haftalık kural + dolu randevu + geçmiş/2 saat tamponu + izin aralıkları.
 * Önümüzdeki `windowDays` gün içinde yoksa `null`. Liste uçlarında N+1 yok: randevular ve izinler
 * tüm doktorlar için tek sorguda alınır.
 */
export const EARLIEST_WINDOW_DAYS = 30;

interface DoctorForEarliest {
  id: string;
  timeZone: string;
  sessionDurationMin: number;
  availability?: { dayOfWeek: number; startMinute: number; endMinute: number; isActive: boolean }[];
}

export async function computeEarliestAvailability(
  app: FastifyInstance,
  doctors: readonly DoctorForEarliest[],
  now = new Date(),
  windowDays = EARLIEST_WINDOW_DAYS
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const withRules = doctors.filter((d) => d.availability && d.availability.some((r) => r.isActive));
  for (const d of doctors) result.set(d.id, null);
  if (withRules.length === 0) return result;

  const from = new Date(now.getTime() - 24 * 3600_000);
  const to = new Date(now.getTime() + (windowDays + 2) * 24 * 3600_000);
  const ids = withRules.map((d) => d.id);
  const [booked, timeOff] = await Promise.all([
    app.prisma.appointment.findMany({ where: { doctorId: { in: ids }, startsAt: { gte: from, lte: to } }, select: { doctorId: true, startsAt: true } }),
    app.prisma.doctorTimeOff.findMany({ where: { doctorId: { in: ids }, startsAt: { lt: to }, endsAt: { gt: from } }, select: { doctorId: true, startsAt: true, endsAt: true } }),
  ]);

  for (const doctor of withRules) {
    const start = getWallClockParts(now, doctor.timeZone);
    const end = getWallClockParts(new Date(now.getTime() + windowDays * 24 * 3600_000), doctor.timeZone);
    const slots = generateAvailableSlots({
      timeZone: doctor.timeZone,
      sessionDurationMin: doctor.sessionDurationMin,
      rules: doctor.availability!,
      fromDate: { year: start.year, month: start.month, day: start.day },
      toDate: { year: end.year, month: end.month, day: end.day },
      now,
      bookedStartTimesMs: new Set(booked.filter((b) => b.doctorId === doctor.id).map((b) => b.startsAt.getTime())),
    });
    const open = subtractTimeOff(
      slots.filter((s) => s.available),
      timeOff.filter((t) => t.doctorId === doctor.id)
    );
    result.set(doctor.id, open[0]?.startsAt.toISOString() ?? null);
  }
  return result;
}
