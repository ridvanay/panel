import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { isBookingArchivable } from "../modules/telehealth/lib/archive-filters";
import { isRealPayment } from "./demo-doctor-purge";

/**
 * 2026-10-18 (Paket B4) — test booking'lerini TOPLU arşivleme çekirdeği
 * (`scripts/archive-test-bookings.ts`). HİÇBİR ŞEY SİLMEZ: yalnızca `archivedAt` + `archivedReason`
 * yazar; ödeme/fatura/kayıt/randevu durumu değişmez.
 *
 * Seçim YALNIZCA açıkça verilen booking id'leriyle VEYA (başlangıç + bitiş tarihi + doktor slug'ı)
 * üçlüsüyle yapılır — filtresiz/kısmi filtreli çalıştırma reddedilir. `--dry-run` zorunlu ilk
 * adımdır: dry-run seçili id'ler + gerekçeden türetilen bir onay anahtarı basar; gerçek çalıştırma
 * aynı seçimi YENİDEN yapar ve anahtar eşleşmezse (seçim değişmiş/gerekçe farklı) hiçbir şey yazmaz.
 */

export type ArchiveSelection =
  | { kind: "ids"; ids: string[] }
  | { kind: "range"; from: string; to: string; doctorSlug: string };

export interface ArchiveCandidate {
  id: string;
  bookingNumber: string;
  doctorSlug: string;
  paymentStatus: string;
  paidBy: string | null;
  /** Compliance — gerçek tahsilat izi olan booking arşivlenirse gelir raporlarından düşer; çıktıda uyarılır. */
  realPayment: boolean;
  totalCents: number;
  currency: string;
  firstStartsAt: string | null;
}

export interface ArchivePlan {
  toArchive: ArchiveCandidate[];
  alreadyArchived: ArchiveCandidate[];
  notArchivable: ArchiveCandidate[];
  missingIds: string[];
  totalsByCurrency: Record<string, number>;
  confirmKey: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArchiveSelection(args: { ids?: string; from?: string; to?: string; doctor?: string }): ArchiveSelection {
  const hasRange = Boolean(args.from || args.to || args.doctor);
  if (args.ids && hasRange) throw new Error("--ids ile --from/--to/--doctor birlikte kullanılamaz.");
  if (args.ids) {
    const ids = [...new Set(args.ids.split(",").map((s) => s.trim()).filter(Boolean))];
    if (ids.length === 0) throw new Error("--ids boş olamaz.");
    const invalid = ids.filter((id) => !UUID_RE.test(id));
    if (invalid.length > 0) throw new Error(`Geçersiz booking id: ${invalid.join(", ")}`);
    return { kind: "ids", ids };
  }
  if (!args.from || !args.to || !args.doctor) {
    throw new Error("Seçim için --ids=... YA DA --from=YYYY-MM-DD --to=YYYY-MM-DD --doctor=<slug> (üçü birlikte) zorunludur.");
  }
  if (!ISO_DATE_RE.test(args.from) || !ISO_DATE_RE.test(args.to)) throw new Error("--from/--to YYYY-MM-DD biçiminde olmalı.");
  if (args.from > args.to) throw new Error("--from, --to'dan sonra olamaz.");
  return { kind: "range", from: args.from, to: args.to, doctorSlug: args.doctor };
}

export function computeConfirmKey(ids: readonly string[], reason: string): string {
  return crypto.createHash("sha256").update(`${[...ids].sort().join(",")}|${reason.trim()}`).digest("hex").slice(0, 16);
}

function selectionWhere(selection: ArchiveSelection): Prisma.AppointmentBookingWhereInput {
  if (selection.kind === "ids") return { id: { in: selection.ids } };
  // Tarih aralığı UTC takvim günleri, bitiş günü DAHİL; booking'in en az bir randevusu aralıkta başlamalı.
  const from = new Date(`${selection.from}T00:00:00.000Z`);
  const toExclusive = new Date(new Date(`${selection.to}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
  return { doctor: { slug: selection.doctorSlug }, appointments: { some: { startsAt: { gte: from, lt: toExclusive } } } };
}

export async function planTestBookingArchive(
  client: PrismaClient | Prisma.TransactionClient,
  selection: ArchiveSelection,
  reason: string,
  now: Date
): Promise<ArchivePlan> {
  const rows = await client.appointmentBooking.findMany({
    where: selectionWhere(selection),
    include: {
      doctor: { select: { slug: true } },
      appointments: { select: { status: true, startsAt: true }, orderBy: { startsAt: "asc" } },
    },
    orderBy: { seq: "asc" },
  });

  const toCandidate = (row: (typeof rows)[number]): ArchiveCandidate => ({
    id: row.id,
    bookingNumber: row.bookingNumber,
    doctorSlug: row.doctor.slug,
    paymentStatus: row.paymentStatus,
    paidBy: row.paidBy,
    realPayment: isRealPayment(row),
    totalCents: row.totalCents,
    currency: row.currency,
    firstStartsAt: row.appointments[0]?.startsAt.toISOString() ?? null,
  });

  const toArchive: ArchiveCandidate[] = [];
  const alreadyArchived: ArchiveCandidate[] = [];
  const notArchivable: ArchiveCandidate[] = [];
  for (const row of rows) {
    if (row.archivedAt) alreadyArchived.push(toCandidate(row));
    else if (!isBookingArchivable(row.appointments, now)) notArchivable.push(toCandidate(row));
    else toArchive.push(toCandidate(row));
  }

  const missingIds = selection.kind === "ids" ? selection.ids.filter((id) => !rows.some((r) => r.id === id)) : [];
  const totalsByCurrency: Record<string, number> = {};
  for (const c of toArchive) totalsByCurrency[c.currency] = (totalsByCurrency[c.currency] ?? 0) + c.totalCents;

  return {
    toArchive,
    alreadyArchived,
    notArchivable,
    missingIds,
    totalsByCurrency,
    confirmKey: computeConfirmKey(
      toArchive.map((c) => c.id),
      reason
    ),
  };
}

export async function runTestBookingArchive(
  prisma: PrismaClient,
  options: { selection: ArchiveSelection; reason: string; dryRun: boolean; operator: string; confirmKey?: string; now?: Date }
): Promise<{ plan: ArchivePlan; archivedCount: number }> {
  const now = options.now ?? new Date();
  const reason = options.reason.trim();
  if (reason.length < 3 || reason.length > 500) throw new Error("--reason 3..500 karakter olmalı (zorunlu).");
  if (options.operator.trim().length === 0) throw new Error("--operator zorunludur (audit kaydı için).");

  if (options.dryRun) {
    return { plan: await planTestBookingArchive(prisma, options.selection, reason, now), archivedCount: 0 };
  }
  if (!options.confirmKey) throw new Error("Gerçek çalıştırma için önce --dry-run ile alınan --confirm=<anahtar> zorunludur.");

  return prisma.$transaction(
    async (tx) => {
      const plan = await planTestBookingArchive(tx, options.selection, reason, now);
      if (plan.confirmKey !== options.confirmKey) {
        throw new Error("Onay anahtarı eşleşmiyor: seçim veya gerekçe dry-run'dan sonra değişti. Dry-run'ı yeniden çalıştırın.");
      }
      if (plan.toArchive.length === 0) return { plan, archivedCount: 0 };

      const ids = plan.toArchive.map((c) => c.id);
      const result = await tx.appointmentBooking.updateMany({
        where: { id: { in: ids }, archivedAt: null },
        data: { archivedAt: now, archivedReason: reason },
      });
      await tx.auditLog.createMany({
        data: plan.toArchive.map((c) => ({
          actorId: null,
          actorEmail: null,
          action: "telehealth.booking.archived",
          status: "SUCCESS" as const,
          targetType: "AppointmentBooking",
          targetId: c.id,
          metadata: {
            source: "archive_script",
            operator: options.operator.trim(),
            bookingNumber: c.bookingNumber,
            reason,
            paymentStatus: c.paymentStatus,
            totalCents: c.totalCents,
            currency: c.currency,
          },
        })),
      });
      return { plan, archivedCount: result.count };
    },
    { isolationLevel: "Serializable" }
  );
}
