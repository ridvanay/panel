import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DoctorAvailabilityBulkOperation, Prisma } from "@prisma/client";
import { z } from "zod";
import { Prisma as PrismaNs } from "@prisma/client";
import { BulkConflictAckRequiredError, BulkPreviewStaleError, BulkUndoBlockedError, ConflictError, NotFoundError, ValidationError } from "../../../lib/errors";
import { AVAILABILITY_RULE_INPUT_SCHEMA, SetDoctorAvailabilityRequestSchema } from "../telehealth.schemas";
import { CreateTimeOffRequestSchema, insertTimeOffMany, overlaps, parseTimeOffRange, type TimeOffKind } from "./time-off";
import { findWeeklyOverlaps, normalizeWeeklyRules, replaceWeeklyAvailability, sameWeeklyRules, weeklyRuleKey, type WeeklyRule } from "./weekly-availability";
import { addCalendarDays, getStartOfCalendarDayInTimeZone, getWallClockParts, wallTimeToUtc, type CalendarDate } from "./timezone";
import { DAY_LABELS_TR, formatMinute, type BulkRowError, type ParsedBulkRow } from "./bulk-availability-csv";

/**
 * Paket Q — admin için toplu haftalık çalışma saati ve izin girişi. Üç kaynak (CSV dosyası, panelden
 * haftalık şablon, panelden toplu izin) AYNI akıştan geçer:
 *   girdi (`BulkInput`) → `computePlan` (doğrulama + değişiklik özeti + çakışma uyarıları)
 *   → bellekte 15 dk'lık önizleme → `applyPreview` (tek serializable transaction; plan yeniden
 *   hesaplanır, parmak izi değiştiyse "önizleme bayat") → geri alma kaydı → `undoBulkOperation`.
 * Yazma, tekil uçlarla aynı servis fonksiyonlarıyla yapılır (`replaceWeeklyAvailability`, `insertTimeOffMany`);
 * kural/izin doğrulaması mevcut zod şemalarıyla (`AVAILABILITY_RULE_INPUT_SCHEMA`,
 * `SetDoctorAvailabilityRequestSchema`, `CreateTimeOffRequestSchema` + `parseTimeOffRange`).
 * Onaylı randevulara HİÇBİR durumda dokunulmaz; çakışmalar yalnızca uyarıdır (onay kutusu zorunlu).
 */

/**
 * İnceleme bulgusu — büyük dosyada (yüzlerce doktor) Prisma'nın varsayılan 5 sn interaktif transaction
 * süresi yetmez. `lib/serializable-tx.ts::runSerializable` ödeme webhook'u da kullandığı için ona
 * dokunulmaz; aynı desen (Serializable + P2034'te yeniden deneme) burada uzun süreyle uygulanır.
 */
async function runBulkTransaction<T>(app: FastifyInstance, fn: (tx: Prisma.TransactionClient) => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await app.prisma.$transaction(fn, { isolationLevel: PrismaNs.TransactionIsolationLevel.Serializable, timeout: 60_000, maxWait: 10_000 });
    } catch (err) {
      const conflict = err instanceof PrismaNs.PrismaClientKnownRequestError && err.code === "P2034";
      if (!conflict || attempt >= attempts) throw err;
    }
  }
}

/** Çok hatalı dosyada yanıt şişmesin: ilk 200 hata + özet satırı. */
const MAX_REPORTED_ERRORS = 200;
function capErrors(errors: BulkRowError[]): BulkRowError[] {
  if (errors.length <= MAX_REPORTED_ERRORS) return errors;
  return [...errors.slice(0, MAX_REPORTED_ERRORS), { row: null, message: `… ve ${errors.length - MAX_REPORTED_ERRORS} hata daha. Önce yukarıdakileri düzeltin.` }];
}

export const WEEKLY_MODES = ["replace", "append"] as const;
export type WeeklyMode = (typeof WEEKLY_MODES)[number];
export const BULK_SOURCES = ["CSV", "TEMPLATE", "TIME_OFF"] as const;
export type BulkSource = (typeof BULK_SOURCES)[number];

interface WeeklyEntry {
  doctorId: string;
  rules: { rule: WeeklyRule; row: number | null }[];
}
interface TimeOffEntry {
  doctorId: string;
  startsAt: string;
  endsAt: string;
  kind: TimeOffKind;
  allDay: boolean;
  note: string | null;
  row: number | null;
}
export interface BulkInput {
  source: BulkSource;
  fileName: string | null;
  rowCount: number;
  weekly: WeeklyEntry[];
  timeOff: TimeOffEntry[];
}

interface DoctorRef {
  id: string;
  slug: string;
  title: string;
  fullName: string;
  timeZone: string;
  isActive: boolean;
  archivedAt: Date | null;
}
const DOCTOR_REF_SELECT = { id: true, slug: true, title: true, fullName: true, timeZone: true, isActive: true, archivedAt: true } as const;
const doctorLabel = (d: Pick<DoctorRef, "title" | "fullName">) => `${d.title} ${d.fullName}`.trim();
function doctorStateProblem(d: DoctorRef): string | null {
  if (d.archivedAt) return "arşivlenmiş";
  if (!d.isActive) return "aktif değil";
  return null;
}
const ruleText = (r: Pick<WeeklyRule, "dayOfWeek" | "startMinute" | "endMinute">) =>
  `${DAY_LABELS_TR[r.dayOfWeek]} ${formatMinute(r.startMinute)}–${formatMinute(r.endMinute)}`;

// ---------------------------------------------------------------------------------------------
// İzin aralığı: doktorun duvar saatinden UTC'ye + mevcut doğrulama
// ---------------------------------------------------------------------------------------------

export function wallRangeToTimeOff(
  startDate: CalendarDate,
  endDate: CalendarDate,
  startMinute: number | null,
  endMinute: number | null,
  timeZone: string
): { startsAt: Date; endsAt: Date; allDay: boolean } | string {
  if (startMinute === null || endMinute === null) {
    return {
      startsAt: getStartOfCalendarDayInTimeZone(startDate, timeZone),
      endsAt: getStartOfCalendarDayInTimeZone(addCalendarDays(endDate, 1), timeZone),
      allDay: true,
    };
  }
  const toUtc = (d: CalendarDate, m: number) =>
    m >= 1440 ? getStartOfCalendarDayInTimeZone(addCalendarDays(d, 1), timeZone) : wallTimeToUtc({ ...d, hour: Math.floor(m / 60), minute: m % 60 }, timeZone);
  const startsAt = toUtc(startDate, startMinute);
  const endsAt = toUtc(endDate, endMinute);
  if (!startsAt || !endsAt) return "Bu saat doktorun saat diliminde yok (yaz saati geçişi); başka bir saat yazın.";
  return { startsAt, endsAt, allDay: false };
}

/** Mevcut tekil izin doğrulaması (şema + aralık kuralları) + geçmiş tarih kontrolü. Hata metni ya da `null`. */
function validateTimeOff(range: { startsAt: Date; endsAt: Date; allDay: boolean }, kind: TimeOffKind, note: string | null, now: Date): string | null {
  const parsed = CreateTimeOffRequestSchema.safeParse({
    startsAt: range.startsAt.toISOString(),
    endsAt: range.endsAt.toISOString(),
    kind,
    allDay: range.allDay,
    note,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Geçersiz izin.";
  try {
    parseTimeOffRange(parsed.data);
  } catch (err) {
    return err instanceof ValidationError ? err.message : "Geçersiz izin aralığı.";
  }
  if (range.endsAt.getTime() <= now.getTime()) return "Geçmiş tarihli izin eklenemez.";
  return null;
}

function validateWeeklyRule(rule: WeeklyRule): string | null {
  const parsed = AVAILABILITY_RULE_INPUT_SCHEMA.safeParse(rule);
  return parsed.success ? null : "Geçersiz çalışma aralığı (bitiş başlangıçtan sonra olmalı, 00:00–24:00).";
}

const MAX_WEEKLY_RULES = 21;

function addWeekly(map: Map<string, WeeklyEntry>, doctorId: string, rule: WeeklyRule, row: number | null) {
  const entry = map.get(doctorId) ?? { doctorId, rules: [] };
  entry.rules.push({ rule, row });
  map.set(doctorId, entry);
}

/** Aynı doktorun aynı gün çakışan aralıkları (dosya/şablon içinde). */
function weeklyOverlapErrors(entry: WeeklyEntry, label: string): BulkRowError[] {
  return findWeeklyOverlaps(entry.rules.map((r) => r.rule)).map(([i, j]) => {
    const a = entry.rules[i]!;
    const b = entry.rules[j]!;
    const where = a.row !== null ? ` (satır ${a.row})` : "";
    return { row: b.row, message: `${label}: ${ruleText(b.rule)} aralığı ${ruleText(a.rule)}${where} ile çakışıyor.` };
  });
}

// ---------------------------------------------------------------------------------------------
// Girdi üreticiler (CSV / haftalık şablon / toplu izin)
// ---------------------------------------------------------------------------------------------

export async function buildInputFromCsv(
  db: Prisma.TransactionClient,
  parsed: { rows: ParsedBulkRow[]; rowCount: number },
  fileName: string,
  now = new Date()
): Promise<{ input: BulkInput; errors: BulkRowError[] }> {
  const errors: BulkRowError[] = [];
  const slugs = [...new Set(parsed.rows.map((r) => r.doctorSlug))];
  const doctors = await db.doctorProfile.findMany({ where: { slug: { in: slugs } }, select: DOCTOR_REF_SELECT });
  const bySlug = new Map(doctors.map((d) => [d.slug, d]));
  const weekly = new Map<string, WeeklyEntry>();
  const timeOff: TimeOffEntry[] = [];

  for (const row of parsed.rows) {
    const doctor = bySlug.get(row.doctorSlug);
    if (!doctor) {
      errors.push({ row: row.row, message: `Bilinmeyen doktor kodu "${row.doctorSlug}".` });
      continue;
    }
    const problem = doctorStateProblem(doctor);
    if (problem) {
      errors.push({ row: row.row, message: `"${row.doctorSlug}" kodlu doktor ${problem}; toplu işleme dahil edilemez.` });
      continue;
    }
    if (row.type === "WORK") {
      const rule: WeeklyRule = { dayOfWeek: row.dayOfWeek, startMinute: row.startMinute, endMinute: row.endMinute, isActive: true };
      const problemText = validateWeeklyRule(rule);
      if (problemText) errors.push({ row: row.row, message: problemText });
      else addWeekly(weekly, doctor.id, rule, row.row);
    } else {
      const range = wallRangeToTimeOff(row.startDate, row.endDate, row.startMinute, row.endMinute, doctor.timeZone);
      if (typeof range === "string") {
        errors.push({ row: row.row, message: range });
        continue;
      }
      const problemText = validateTimeOff(range, row.kind, row.note, now);
      if (problemText) {
        errors.push({ row: row.row, message: problemText });
        continue;
      }
      timeOff.push({
        doctorId: doctor.id,
        startsAt: range.startsAt.toISOString(),
        endsAt: range.endsAt.toISOString(),
        kind: row.kind,
        allDay: range.allDay,
        note: row.note,
        row: row.row,
      });
    }
  }
  for (const entry of weekly.values()) {
    const doctor = doctors.find((d) => d.id === entry.doctorId)!;
    if (entry.rules.length > MAX_WEEKLY_RULES) {
      errors.push({ row: entry.rules[MAX_WEEKLY_RULES]!.row, message: `${doctorLabel(doctor)}: bir doktor için en fazla ${MAX_WEEKLY_RULES} CALISMA satırı olabilir.` });
      continue;
    }
    errors.push(...weeklyOverlapErrors(entry, doctorLabel(doctor)));
  }
  return { input: { source: "CSV", fileName, rowCount: parsed.rowCount, weekly: [...weekly.values()], timeOff }, errors };
}

async function loadSelectedDoctors(db: Prisma.TransactionClient, doctorIds: string[]): Promise<{ doctors: DoctorRef[]; errors: BulkRowError[] }> {
  const doctors = await db.doctorProfile.findMany({ where: { id: { in: doctorIds } }, select: DOCTOR_REF_SELECT });
  const errors: BulkRowError[] = [];
  for (const id of doctorIds) {
    const d = doctors.find((x) => x.id === id);
    if (!d) errors.push({ row: null, message: `Doktor bulunamadı (${id}).` });
    else {
      const problem = doctorStateProblem(d);
      if (problem) errors.push({ row: null, message: `${doctorLabel(d)} ${problem}; toplu işleme dahil edilemez.` });
    }
  }
  return { doctors, errors };
}

export async function buildInputFromWeeklyTemplate(
  db: Prisma.TransactionClient,
  body: { doctorIds: string[]; rules: { dayOfWeek: number; startMinute: number; endMinute: number }[] }
): Promise<{ input: BulkInput; errors: BulkRowError[] }> {
  const { doctors, errors } = await loadSelectedDoctors(db, body.doctorIds);
  const rules = normalizeWeeklyRules(body.rules);
  errors.push(...weeklyOverlapErrors({ doctorId: "", rules: rules.map((rule) => ({ rule, row: null })) }, "Şablon"));
  const weekly = doctors.map((d) => ({ doctorId: d.id, rules: rules.map((rule) => ({ rule, row: null })) }));
  return { input: { source: "TEMPLATE", fileName: null, rowCount: rules.length, weekly, timeOff: [] }, errors };
}

export async function buildInputFromTimeOff(
  db: Prisma.TransactionClient,
  body: { doctorIds: string[]; startDate: CalendarDate; endDate: CalendarDate; startMinute: number | null; endMinute: number | null; kind: TimeOffKind; note: string | null },
  now = new Date()
): Promise<{ input: BulkInput; errors: BulkRowError[] }> {
  const { doctors, errors } = await loadSelectedDoctors(db, body.doctorIds);
  const timeOff: TimeOffEntry[] = [];
  for (const d of doctors) {
    if (doctorStateProblem(d)) continue;
    const range = wallRangeToTimeOff(body.startDate, body.endDate, body.startMinute, body.endMinute, d.timeZone);
    const problem = typeof range === "string" ? range : validateTimeOff(range, body.kind, body.note, now);
    if (problem || typeof range === "string") {
      errors.push({ row: null, message: `${doctorLabel(d)}: ${problem}` });
      continue;
    }
    timeOff.push({ doctorId: d.id, startsAt: range.startsAt.toISOString(), endsAt: range.endsAt.toISOString(), kind: body.kind, allDay: range.allDay, note: body.note, row: null });
  }
  return { input: { source: "TIME_OFF", fileName: null, rowCount: 1, weekly: [], timeOff }, errors };
}

// ---------------------------------------------------------------------------------------------
// Plan (değişiklik özeti + çakışma uyarıları)
// ---------------------------------------------------------------------------------------------

export interface PlanConflict {
  appointmentId: string;
  bookingNumber: string | null;
  startsAt: string;
  endsAt: string;
  patientTimeZone: string | null;
  reason: "TIME_OFF" | "REMOVED_HOURS";
}
interface PlanTimeOff {
  startsAt: string;
  endsAt: string;
  kind: TimeOffKind;
  allDay: boolean;
  note: string | null;
}
interface PlanDoctor {
  doctorId: string;
  slug: string;
  name: string;
  timeZone: string;
  weekly: { before: WeeklyRule[]; after: WeeklyRule[]; added: WeeklyRule[]; removed: WeeklyRule[]; unchanged: WeeklyRule[] } | null;
  timeOff: { toAdd: PlanTimeOff[]; skipped: number };
  conflicts: PlanConflict[];
}
export interface BulkPlan {
  source: BulkSource;
  fileName: string | null;
  rowCount: number;
  weeklyMode: WeeklyMode;
  doctors: PlanDoctor[];
  untouchedDoctors: { doctorId: string; slug: string; name: string }[];
  totals: { doctors: number; rulesAdded: number; rulesRemoved: number; timeOffAdded: number; timeOffSkipped: number; conflicts: number };
}

/** Randevunun doktorun duvar saatindeki günü/dakikaları kurallarca tamamen kapsanıyor mu? */
function coveredBy(rules: readonly WeeklyRule[], startsAt: Date, endsAt: Date, timeZone: string): boolean {
  const w = getWallClockParts(startsAt, timeZone);
  const dow = ((new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay() + 6) % 7) + 1;
  const s = w.hour * 60 + w.minute;
  const e = s + Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
  return rules.some((r) => r.isActive && r.dayOfWeek === dow && r.startMinute <= s && e <= r.endMinute);
}

export async function computePlan(db: Prisma.TransactionClient, input: BulkInput, mode: WeeklyMode, now = new Date()): Promise<{ plan: BulkPlan; errors: BulkRowError[] }> {
  const errors: BulkRowError[] = [];
  const doctorIds = [...new Set([...input.weekly.map((w) => w.doctorId), ...input.timeOff.map((t) => t.doctorId)])];
  const doctors = await db.doctorProfile.findMany({ where: { id: { in: doctorIds } }, select: { ...DOCTOR_REF_SELECT, availability: true } });
  const byId = new Map(doctors.map((d) => [d.id, d]));
  for (const id of doctorIds) {
    const d = byId.get(id);
    const problem = d ? doctorStateProblem(d) : "silinmiş";
    if (problem) errors.push({ row: null, message: `${d ? doctorLabel(d) : id}: doktor ${problem}.` });
  }

  const planDoctors = new Map<string, PlanDoctor>();
  const planFor = (id: string): PlanDoctor => {
    let p = planDoctors.get(id);
    if (!p) {
      const d = byId.get(id)!;
      p = { doctorId: d.id, slug: d.slug, name: doctorLabel(d), timeZone: d.timeZone, weekly: null, timeOff: { toAdd: [], skipped: 0 }, conflicts: [] };
      planDoctors.set(id, p);
    }
    return p;
  };

  for (const entry of input.weekly) {
    const d = byId.get(entry.doctorId);
    if (!d) continue;
    const before = normalizeWeeklyRules(d.availability);
    const incoming = entry.rules.map((r) => r.rule);
    if (mode === "append") {
      for (const { rule, row } of entry.rules) {
        const clash = before.find((b) => b.isActive && b.dayOfWeek === rule.dayOfWeek && b.startMinute < rule.endMinute && rule.startMinute < b.endMinute);
        if (clash) errors.push({ row, message: `${doctorLabel(d)}: ${ruleText(rule)} mevcut ${ruleText(clash)} aralığıyla çakışıyor ("Yalnızca ekle" kipi).` });
      }
    }
    const after = normalizeWeeklyRules(mode === "append" ? [...before, ...incoming] : incoming);
    // `@@unique([doctorId, dayOfWeek, startMinute])` — pasif bir mevcut kuralla aynı başlangıç uygulamada 500 olmasın.
    const startKeys = new Set<string>();
    for (const r of after) {
      const k = `${r.dayOfWeek}:${r.startMinute}`;
      if (startKeys.has(k)) {
        const row = entry.rules.find((x) => x.rule.dayOfWeek === r.dayOfWeek && x.rule.startMinute === r.startMinute)?.row ?? null;
        errors.push({ row, message: `${doctorLabel(d)}: ${DAY_LABELS_TR[r.dayOfWeek]} ${formatMinute(r.startMinute)} başlangıçlı başka bir aralık (pasif olabilir) zaten var.` });
      }
      startKeys.add(k);
    }
    if (!SetDoctorAvailabilityRequestSchema.safeParse({ rules: after }).success) {
      errors.push({ row: null, message: `${doctorLabel(d)}: bir doktor için en fazla 21 haftalık aralık olabilir.` });
    }
    const beforeKeys = new Set(before.map(weeklyRuleKey));
    const afterKeys = new Set(after.map(weeklyRuleKey));
    planFor(d.id).weekly = {
      before,
      after,
      added: after.filter((r) => !beforeKeys.has(weeklyRuleKey(r))),
      removed: before.filter((r) => !afterKeys.has(weeklyRuleKey(r))),
      unchanged: after.filter((r) => beforeKeys.has(weeklyRuleKey(r))),
    };
  }

  if (input.timeOff.length > 0) {
    const ids = [...new Set(input.timeOff.map((t) => t.doctorId))];
    const existing = await db.doctorTimeOff.findMany({ where: { doctorId: { in: ids }, endsAt: { gt: now } }, select: { doctorId: true, startsAt: true, endsAt: true } });
    const seen = new Set(existing.map((t) => `${t.doctorId}|${t.startsAt.toISOString()}|${t.endsAt.toISOString()}`));
    for (const t of input.timeOff) {
      if (!byId.get(t.doctorId)) continue;
      const p = planFor(t.doctorId);
      const key = `${t.doctorId}|${t.startsAt}|${t.endsAt}`;
      // İdempotent: aynı doktor + aynı başlangıç/bitiş zaten varsa (ya da dosyada tekrar ediyorsa) atlanır.
      if (seen.has(key)) {
        p.timeOff.skipped++;
        continue;
      }
      seen.add(key);
      p.timeOff.toAdd.push({ startsAt: t.startsAt, endsAt: t.endsAt, kind: t.kind, allDay: t.allDay, note: t.note });
    }
  }

  // Çakışma uyarıları: yeni izne ya da kaldırılan çalışma saatine denk gelen ONAYLI gelecek randevular.
  const conflictDoctorIds = [...planDoctors.values()].filter((p) => p.timeOff.toAdd.length > 0 || (p.weekly?.removed.length ?? 0) > 0).map((p) => p.doctorId);
  if (conflictDoctorIds.length > 0) {
    const appointments = await db.appointment.findMany({
      where: { doctorId: { in: conflictDoctorIds }, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, endsAt: { gt: now } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      select: { id: true, doctorId: true, startsAt: true, endsAt: true, booking: { select: { bookingNumber: true, patientTimeZone: true } } },
    });
    for (const a of appointments) {
      const p = planDoctors.get(a.doctorId)!;
      const inTimeOff = p.timeOff.toAdd.some((t) => overlaps(a.startsAt.getTime(), a.endsAt.getTime(), new Date(t.startsAt).getTime(), new Date(t.endsAt).getTime()));
      const lostHours =
        !inTimeOff && p.weekly !== null && p.weekly.removed.length > 0 && coveredBy(p.weekly.before, a.startsAt, a.endsAt, p.timeZone) && !coveredBy(p.weekly.after, a.startsAt, a.endsAt, p.timeZone);
      if (!inTimeOff && !lostHours) continue;
      p.conflicts.push({
        appointmentId: a.id,
        bookingNumber: a.booking?.bookingNumber ?? null,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        patientTimeZone: a.booking?.patientTimeZone ?? null,
        reason: inTimeOff ? "TIME_OFF" : "REMOVED_HOURS",
      });
    }
  }

  const untouched = await db.doctorProfile.findMany({
    where: { isActive: true, archivedAt: null, id: { notIn: doctorIds } },
    select: { id: true, slug: true, title: true, fullName: true },
    orderBy: [{ order: "asc" }, { fullName: "asc" }],
  });
  const list = [...planDoctors.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const plan: BulkPlan = {
    source: input.source,
    fileName: input.fileName,
    rowCount: input.rowCount,
    weeklyMode: mode,
    doctors: list,
    untouchedDoctors: untouched.map((d) => ({ doctorId: d.id, slug: d.slug, name: doctorLabel(d) })),
    totals: {
      doctors: list.length,
      rulesAdded: list.reduce((n, p) => n + (p.weekly?.added.length ?? 0), 0),
      rulesRemoved: list.reduce((n, p) => n + (p.weekly?.removed.length ?? 0), 0),
      timeOffAdded: list.reduce((n, p) => n + p.timeOff.toAdd.length, 0),
      timeOffSkipped: list.reduce((n, p) => n + p.timeOff.skipped, 0),
      conflicts: list.reduce((n, p) => n + p.conflicts.length, 0),
    },
  };
  errors.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  return { plan, errors: capErrors(errors) };
}

function planFingerprint(plan: BulkPlan): string {
  const essence = {
    mode: plan.weeklyMode,
    doctors: plan.doctors.map((d) => ({ id: d.doctorId, tz: d.timeZone, weekly: d.weekly && { before: d.weekly.before, after: d.weekly.after }, timeOff: d.timeOff, conflicts: d.conflicts })),
  };
  return crypto.createHash("sha256").update(JSON.stringify(essence)).digest("hex");
}

/** Önizleme yanıtı: iç notlar GÖSTERİLMEZ (yalnızca "not var" bayrağı). */
export function toPreviewDto(plan: BulkPlan) {
  return {
    ...plan,
    doctors: plan.doctors.map((d) => ({
      ...d,
      timeOff: { skipped: d.timeOff.skipped, toAdd: d.timeOff.toAdd.map(({ note, ...t }) => ({ ...t, hasNote: Boolean(note) })) },
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Önizleme deposu (bellekte, 15 dk) — yüklenen dosya diske yazılmaz
// ---------------------------------------------------------------------------------------------

export const PREVIEW_TTL_MS = 15 * 60_000;
const MAX_PREVIEWS = 200;
const MAX_PREVIEWS_PER_ACTOR = 10;
interface StoredPreview {
  actorId: string;
  input: BulkInput;
  mode: WeeklyMode;
  fingerprint: string;
  conflictCount: number;
  expiresAt: number;
}
const previews = new Map<string, StoredPreview>();

/**
 * Süresi dolanlar atılır; admin başına en fazla 10 önizleme (kendi en eskisi düşer) — bir admin
 * başkasının önizlemesini taşırma yoluyla düşüremez. Depo süreç belleğindedir (prod tek backend
 * örneği); yeniden başlatmada önizleme 404 olur ve yeniden yüklenir.
 */
function prunePreviews(nowMs: number, actorId: string) {
  for (const [id, p] of previews) if (p.expiresAt <= nowMs) previews.delete(id);
  const own = [...previews.entries()].filter(([, p]) => p.actorId === actorId);
  for (const [id] of own.slice(0, Math.max(0, own.length - MAX_PREVIEWS_PER_ACTOR + 1))) previews.delete(id);
  while (previews.size >= MAX_PREVIEWS) previews.delete(previews.keys().next().value!);
}

function getPreview(actorId: string, previewId: string): StoredPreview {
  const entry = previews.get(previewId);
  if (!entry || entry.actorId !== actorId || entry.expiresAt <= Date.now()) {
    throw new NotFoundError("Önizleme bulunamadı ya da süresi doldu; dosyayı yeniden yükleyip önizleyin.");
  }
  return entry;
}

export type PreviewResult =
  | { valid: false; errors: BulkRowError[]; preview: null }
  | { valid: true; errors: []; preview: ReturnType<typeof toPreviewDto> & { previewId: string; expiresAt: string } };

export async function createPreview(
  app: FastifyInstance,
  actorId: string,
  built: { input: BulkInput; errors: BulkRowError[] },
  mode: WeeklyMode,
  previewId: string = crypto.randomUUID()
): Promise<PreviewResult> {
  const { plan, errors } = await computePlan(app.prisma, built.input, mode);
  const all = capErrors([...built.errors, ...errors].sort((a, b) => (a.row ?? 0) - (b.row ?? 0)));
  if (all.length > 0) {
    previews.delete(previewId);
    return { valid: false, errors: all, preview: null };
  }
  const nowMs = Date.now();
  previews.delete(previewId);
  prunePreviews(nowMs, actorId);
  const expiresAt = nowMs + PREVIEW_TTL_MS;
  previews.set(previewId, { actorId, input: built.input, mode, fingerprint: planFingerprint(plan), conflictCount: plan.totals.conflicts, expiresAt });
  return { valid: true, errors: [], preview: { ...toPreviewDto(plan), previewId, expiresAt: new Date(expiresAt).toISOString() } };
}

/** Önizleme ekranında kip değişince plan aynı girdiyle yeniden hesaplanır (aynı `previewId`). */
export async function changePreviewMode(app: FastifyInstance, actorId: string, previewId: string, mode: WeeklyMode): Promise<PreviewResult> {
  const entry = getPreview(actorId, previewId);
  return createPreview(app, actorId, { input: entry.input, errors: [] }, mode, previewId);
}

// ---------------------------------------------------------------------------------------------
// Uygulama ve geri alma
// ---------------------------------------------------------------------------------------------

const RuleSnapshotSchema = z.object({ dayOfWeek: z.number(), startMinute: z.number(), endMinute: z.number(), isActive: z.boolean() });
const SnapshotSchema = z.object({
  doctors: z.array(z.object({ doctorId: z.string(), name: z.string(), before: z.array(RuleSnapshotSchema), after: z.array(RuleSnapshotSchema) })),
  timeOff: z.array(z.object({ id: z.string(), doctorId: z.string(), name: z.string() })),
});
export const BulkSummarySchema = z.object({
  rulesAdded: z.number(),
  rulesRemoved: z.number(),
  timeOffAdded: z.number(),
  timeOffSkipped: z.number(),
  conflicts: z.number(),
  doctorNames: z.array(z.string()),
});

export interface ApplyResult {
  operation: DoctorAvailabilityBulkOperation;
  affectedDoctorIds: string[];
}

export async function applyPreview(
  app: FastifyInstance,
  actor: { id: string; email: string },
  previewId: string,
  acknowledgeConflicts: boolean
): Promise<ApplyResult> {
  const entry = getPreview(actor.id, previewId);
  if (entry.conflictCount > 0 && !acknowledgeConflicts) throw new BulkConflictAckRequiredError();

  const result = await runBulkTransaction(app, async (tx) => {
    // Uygulamadan hemen önce yeniden doğrula; önizlemeden sonra veri değiştiyse uygulama yok.
    const { plan, errors } = await computePlan(tx, entry.input, entry.mode);
    if (errors.length > 0 || planFingerprint(plan) !== entry.fingerprint) throw new BulkPreviewStaleError();

    const weeklyChanged = plan.doctors.filter((d) => d.weekly && (d.weekly.added.length > 0 || d.weekly.removed.length > 0));
    if (weeklyChanged.length === 0 && plan.totals.timeOffAdded === 0) {
      throw new ValidationError("Uygulanacak bir değişiklik yok (dosyadaki her şey zaten kayıtlı).");
    }
    for (const d of weeklyChanged) await replaceWeeklyAvailability(tx, d.doctorId, d.weekly!.after, { returnRows: false });
    const nameOf = new Map(plan.doctors.map((d) => [d.doctorId, d.name]));
    const inserted = await insertTimeOffMany(
      tx,
      plan.doctors.flatMap((d) =>
        d.timeOff.toAdd.map((t) => ({ doctorId: d.doctorId, startsAt: new Date(t.startsAt), endsAt: new Date(t.endsAt), kind: t.kind, allDay: t.allDay, note: t.note }))
      ),
      actor.id
    );
    const createdTimeOff = inserted.map((row) => ({ id: row.id, doctorId: row.doctorId, name: nameOf.get(row.doctorId) ?? "" }));
    const affected = plan.doctors.filter((d) => weeklyChanged.includes(d) || d.timeOff.toAdd.length > 0);
    const summary: z.infer<typeof BulkSummarySchema> = {
      rulesAdded: plan.totals.rulesAdded,
      rulesRemoved: plan.totals.rulesRemoved,
      timeOffAdded: plan.totals.timeOffAdded,
      timeOffSkipped: plan.totals.timeOffSkipped,
      conflicts: plan.totals.conflicts,
      doctorNames: affected.map((d) => d.name),
    };
    const snapshot: z.infer<typeof SnapshotSchema> = {
      doctors: weeklyChanged.map((d) => ({ doctorId: d.doctorId, name: d.name, before: d.weekly!.before, after: d.weekly!.after })),
      timeOff: createdTimeOff,
    };
    const operation = await tx.doctorAvailabilityBulkOperation.create({
      data: {
        source: plan.source,
        fileName: plan.fileName,
        rowCount: plan.rowCount,
        doctorCount: affected.length,
        summary,
        snapshot,
        actorId: actor.id,
        actorEmail: actor.email,
      },
    });
    return { operation, affectedDoctorIds: affected.map((d) => d.doctorId) };
  });
  previews.delete(previewId);
  return result;
}

export async function undoBulkOperation(app: FastifyInstance, actorId: string, operationId: string): Promise<ApplyResult> {
  return runBulkTransaction(app, async (tx) => {
    const op = await tx.doctorAvailabilityBulkOperation.findUnique({ where: { id: operationId } });
    if (!op) throw new NotFoundError("Toplu işlem bulunamadı.");
    if (op.undoneAt) throw new ConflictError("Bu işlem zaten geri alınmış.");
    const snap = SnapshotSchema.parse(op.snapshot);

    const changes: string[] = [];
    const doctorIds = snap.doctors.map((d) => d.doctorId);
    const current = await tx.doctorAvailability.findMany({ where: { doctorId: { in: doctorIds } } });
    for (const d of snap.doctors) {
      if (!sameWeeklyRules(current.filter((r) => r.doctorId === d.doctorId), d.after)) {
        changes.push(`${d.name}: haftalık çalışma saatleri bu işlemden sonra değiştirilmiş.`);
      }
    }
    const ids = snap.timeOff.map((t) => t.id);
    const remaining = new Set((await tx.doctorTimeOff.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((t) => t.id));
    const missingByDoctor = new Map<string, number>();
    for (const t of snap.timeOff) if (!remaining.has(t.id)) missingByDoctor.set(t.name, (missingByDoctor.get(t.name) ?? 0) + 1);
    for (const [name, count] of missingByDoctor) changes.push(`${name}: bu işlemle eklenen ${count} izin kaydı sonradan silinmiş.`);
    if (changes.length > 0) throw new BulkUndoBlockedError(changes);

    for (const d of snap.doctors) await replaceWeeklyAvailability(tx, d.doctorId, d.before, { returnRows: false });
    if (ids.length > 0) await tx.doctorTimeOff.deleteMany({ where: { id: { in: ids } } });
    const operation = await tx.doctorAvailabilityBulkOperation.update({ where: { id: op.id }, data: { undoneAt: new Date(), undoneById: actorId } });
    return { operation, affectedDoctorIds: [...new Set([...doctorIds, ...snap.timeOff.map((t) => t.doctorId)])] };
  });
}

export function toOperationDto(op: DoctorAvailabilityBulkOperation) {
  const summary = BulkSummarySchema.safeParse(op.summary);
  return {
    id: op.id,
    source: (BULK_SOURCES as readonly string[]).includes(op.source) ? (op.source as BulkSource) : "CSV",
    fileName: op.fileName,
    rowCount: op.rowCount,
    doctorCount: op.doctorCount,
    summary: summary.success ? summary.data : { rulesAdded: 0, rulesRemoved: 0, timeOffAdded: 0, timeOffSkipped: 0, conflicts: 0, doctorNames: [] },
    actorEmail: op.actorEmail,
    createdAt: op.createdAt.toISOString(),
    undoneAt: op.undoneAt?.toISOString() ?? null,
  };
}

