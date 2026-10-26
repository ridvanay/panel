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

/**
 * İnceleme bulgusu (CPU maliyeti) — doktor başına sonuç 60 sn bellekte tutulur (public liste her
 * istekte 30 günlük slot üretmesin). Randevu/izin/haftalık saat değişince `invalidateEarliestAvailability`.
 * Yeni bir randevu en geç 60 sn sonra yansır; slot ucunun kendisi önbelleksizdir (rezervasyon doğruluğu
 * etkilenmez — bu yalnızca gösterim bilgisidir).
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: string | null; expiresAt: number }>();

export function invalidateEarliestAvailability(doctorId?: string): void {
  if (doctorId) cache.delete(doctorId);
  else cache.clear();
}

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
  const nowMs = Date.now();
  const pending: DoctorForEarliest[] = [];
  for (const d of doctors) {
    const hit = cache.get(d.id);
    if (hit && hit.expiresAt > nowMs) result.set(d.id, hit.value);
    else {
      result.set(d.id, null);
      pending.push(d);
    }
  }
  const withRules = pending.filter((d) => d.availability && d.availability.some((r) => r.isActive));
  for (const d of pending) if (!withRules.includes(d)) cache.set(d.id, { value: null, expiresAt: nowMs + CACHE_TTL_MS });
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
    const value = open[0]?.startsAt.toISOString() ?? null;
    result.set(doctor.id, value);
    cache.set(doctor.id, { value, expiresAt: nowMs + CACHE_TTL_MS });
  }
  return result;
}
