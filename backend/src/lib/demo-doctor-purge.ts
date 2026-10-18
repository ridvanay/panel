import fs from "node:fs/promises";
import path from "node:path";
import type { BookingPaymentStatus, Prisma, PrismaClient } from "@prisma/client";

/**
 * 2026-10-18 (Paket B2) — demo doktor kalıcı temizliği. `scripts/purge-demo-doctors.ts` bu çekirdeği
 * çağırır; testler aynı fonksiyonu sahte dosya silicisiyle çalıştırır (`appointment-auto-close.ts`
 * deseni: çekirdek `PrismaClient` alır, `FastifyInstance` gerektirmez).
 *
 * YALNIZCA açıkça verilen slug'lar işlenir. Herhangi bir doktorda engel (blocker) varsa HİÇBİR şey
 * silinmez (tümü ya da hiçbiri). Engeller:
 * - Bağlı kullanıcı hesabı (`userId`) — gerçek bir hekim hesabı olabilir.
 * - Gerçek ödeme — booking ARŞİVLİ OLSA BİLE (compliance kararı, varsayılan güvenli seçenek).
 *   Demo simülatörü (`paidBy: "demo"`) ve ücretsiz seans (`paidBy: "free"`) tahsilat değildir.
 * - Gelecekte açık randevu — gerçek bir hastanın randevusu olabilir.
 * - Aktif kayıt (Egress `RECORDING`/`PROCESSING`) — dosya henüz yazılıyor olabilir.
 * - Klinik kayıt (compliance kararı, Hasta Hakları/Hasta Kayıtları saklama yükümlülüğü): konsültasyon
 *   notu, sağlık formu (intake), belge, tamamlanmış kayıt veya gerçekleşmiş görüşme (`startedAt`).
 *   `paidBy: "free"` ya da booking'siz (eski tekil) randevuda ASLA geçilemez; YALNIZCA tüm klinik
 *   içerik `paidBy: "demo"` booking'lerdeyse operatör açık gerekçeyle (`allowDemoClinicalReason`)
 *   geçebilir — gerekçe audit'e yazılır.
 *
 * SİLİNMEYENLER: hasta `User` hesapları, audit log satırları, avatar `Media` satırı.
 * Sıra: dry-run listesi → JSON yedek (0600) → tek Serializable transaction (engeller içeride yeniden
 * denetlenir) → commit SONRASI dosya silme (hata loglanır, DB geri alınmaz; yollar yedekte durur).
 */

export type PurgeBlockerCode =
  | "DOCTOR_NOT_FOUND"
  | "HAS_LINKED_USER"
  | "HAS_REAL_PAYMENT"
  | "HAS_UPCOMING_APPOINTMENT"
  | "RECORDING_IN_PROGRESS"
  | "HAS_CLINICAL_RECORD";

export interface PurgeBlocker {
  slug: string;
  code: PurgeBlockerCode;
  message: string;
}

export interface PurgeDoctorPlan {
  slug: string;
  doctorId: string;
  fullName: string;
  appointments: { id: string; startsAt: string; status: string; bookingId: string | null }[];
  bookings: {
    id: string;
    bookingNumber: string;
    paymentStatus: BookingPaymentStatus;
    paidBy: string | null;
    totalCents: number;
    currency: string;
    archivedAt: string | null;
  }[];
  availabilityCount: number;
  additionalSpecialtyCount: number;
  intakeCount: number;
  documents: { id: string; filename: string }[];
  recordings: { id: string; status: string }[];
}

export interface PurgePlan {
  doctors: PurgeDoctorPlan[];
  blockers: PurgeBlocker[];
}

export interface PurgeFileRemover {
  removeDocument(storagePath: string): Promise<void>;
  removeRecording(recordingId: string, storagePath: string | null): Promise<void>;
}

export interface PurgeResult {
  plan: PurgePlan;
  dryRun: boolean;
  backupFile: string | null;
  deleted: { doctors: number; appointments: number; bookings: number } | null;
  fileErrors: string[];
}

export class PurgeBlockedError extends Error {
  constructor(readonly blockers: PurgeBlocker[]) {
    super(`Temizlik durduruldu: ${blockers.map((b) => `${b.slug}: ${b.code}`).join(", ")}`);
    this.name = "PurgeBlockedError";
  }
}

const REAL_PAYMENT_PROVIDERS = new Set(["stripe", "manual"]);
const NON_MONEY_PROVIDERS = new Set(["demo", "free"]);

/** Gerçek tahsilat izi: Stripe/manuel sağlayıcı, PaymentIntent, iade ya da sağlayıcısı belirsiz bir PAID. */
export function isRealPayment(booking: {
  paymentStatus: BookingPaymentStatus;
  paidBy: string | null;
  stripePaymentIntentId: string | null;
}): boolean {
  if (booking.paidBy && REAL_PAYMENT_PROVIDERS.has(booking.paidBy)) return true;
  if (booking.stripePaymentIntentId) return true;
  if (booking.paymentStatus === "REFUNDED") return true;
  if (booking.paymentStatus === "PAID") return !(booking.paidBy && NON_MONEY_PROVIDERS.has(booking.paidBy));
  return false;
}

/** Yedek dosyalarının saklama süresi (compliance kararı: geri alma penceresi, en fazla 30 gün). */
export const PURGE_BACKUP_RETENTION_DAYS = 30;

const DOCTOR_INCLUDE = {
  availability: true,
  additionalSpecialties: true,
  appointments: { include: { recording: true }, orderBy: { startsAt: "asc" } },
  appointmentBookings: { include: { intake: true, documents: true }, orderBy: { createdAt: "asc" } },
} as const satisfies Prisma.DoctorProfileInclude;

type DoctorWithRelations = Prisma.DoctorProfileGetPayload<{ include: typeof DOCTOR_INCLUDE }>;

interface BlockerOptions {
  allowDemoClinical: boolean;
}

/** Randevunun klinik iz taşıyıp taşımadığı + iz hangi tür booking'de (demo mu değil mi). */
function clinicalFindings(doctor: DoctorWithRelations): { demoOnly: string[]; other: string[] } {
  const bookingById = new Map(doctor.appointmentBookings.map((b) => [b.id, b]));
  const demoOnly: string[] = [];
  const other: string[] = [];
  const add = (isDemo: boolean, label: string) => (isDemo ? demoOnly : other).push(label);

  for (const booking of doctor.appointmentBookings) {
    const isDemo = booking.paidBy === "demo";
    if (booking.intake) add(isDemo, `intake@${booking.bookingNumber}`);
    if (booking.documents.length > 0) add(isDemo, `belge@${booking.bookingNumber}`);
  }
  for (const appointment of doctor.appointments) {
    const booking = appointment.bookingId ? bookingById.get(appointment.bookingId) : undefined;
    const isDemo = booking?.paidBy === "demo";
    const ref = booking?.bookingNumber ?? `randevu:${appointment.id}`;
    if (appointment.consultationNoteCiphertext) add(isDemo, `not@${ref}`);
    if (appointment.startedAt) add(isDemo, `görüşme@${ref}`);
    if (appointment.recording && appointment.recording.status === "COMPLETED" && !appointment.recording.deletedAt) {
      add(isDemo, `kayıt@${ref}`);
    }
  }
  return { demoOnly, other };
}

function blockersFor(doctor: DoctorWithRelations, now: Date, options: BlockerOptions): PurgeBlocker[] {
  const blockers: PurgeBlocker[] = [];
  const slug = doctor.slug;
  if (doctor.userId) {
    blockers.push({ slug, code: "HAS_LINKED_USER", message: "Doktora bağlı bir kullanıcı hesabı var." });
  }
  const paid = doctor.appointmentBookings.filter(isRealPayment);
  if (paid.length > 0) {
    blockers.push({
      slug,
      code: "HAS_REAL_PAYMENT",
      message: `Gerçek ödemesi olan booking var (arşivli olsa bile durur): ${paid.map((b) => b.bookingNumber).join(", ")}`,
    });
  }
  const upcoming = doctor.appointments.filter(
    (a) => ["PENDING_PAYMENT", "SCHEDULED", "IN_PROGRESS"].includes(a.status) && a.endsAt.getTime() > now.getTime()
  );
  if (upcoming.length > 0) {
    blockers.push({ slug, code: "HAS_UPCOMING_APPOINTMENT", message: `Gelecekte açık randevu var: ${upcoming.length} adet.` });
  }
  const activeRecordings = doctor.appointments.filter((a) => a.recording && ["RECORDING", "PROCESSING"].includes(a.recording.status));
  if (activeRecordings.length > 0) {
    blockers.push({ slug, code: "RECORDING_IN_PROGRESS", message: "Devam eden/işlenen bir görüşme kaydı var." });
  }
  const clinical = clinicalFindings(doctor);
  if (clinical.other.length > 0) {
    blockers.push({
      slug,
      code: "HAS_CLINICAL_RECORD",
      message: `Demo ödemeli olmayan klinik kayıt var (geçilemez): ${clinical.other.join(", ")}`,
    });
  }
  if (clinical.demoOnly.length > 0 && !options.allowDemoClinical) {
    blockers.push({
      slug,
      code: "HAS_CLINICAL_RECORD",
      message: `Demo booking'lerde klinik içerik var: ${clinical.demoOnly.join(", ")}. Test verisi olduğundan eminseniz --allow-demo-clinical="<gerekçe>" ile geçin.`,
    });
  }
  return blockers;
}

function toPlan(doctor: DoctorWithRelations): PurgeDoctorPlan {
  return {
    slug: doctor.slug,
    doctorId: doctor.id,
    fullName: `${doctor.title} ${doctor.fullName}`.trim(),
    appointments: doctor.appointments.map((a) => ({
      id: a.id,
      startsAt: a.startsAt.toISOString(),
      status: a.status,
      bookingId: a.bookingId,
    })),
    bookings: doctor.appointmentBookings.map((b) => ({
      id: b.id,
      bookingNumber: b.bookingNumber,
      paymentStatus: b.paymentStatus,
      paidBy: b.paidBy,
      totalCents: b.totalCents,
      currency: b.currency,
      archivedAt: b.archivedAt ? b.archivedAt.toISOString() : null,
    })),
    availabilityCount: doctor.availability.length,
    additionalSpecialtyCount: doctor.additionalSpecialties.length,
    intakeCount: doctor.appointmentBookings.filter((b) => b.intake).length,
    documents: doctor.appointmentBookings.flatMap((b) => b.documents.map((d) => ({ id: d.id, filename: d.filename }))),
    recordings: doctor.appointments.flatMap((a) => (a.recording ? [{ id: a.recording.id, status: a.recording.status }] : [])),
  };
}

async function loadDoctors(client: PrismaClient | Prisma.TransactionClient, slugs: readonly string[]) {
  return client.doctorProfile.findMany({ where: { slug: { in: [...slugs] } }, include: DOCTOR_INCLUDE });
}

function buildPlan(slugs: readonly string[], doctors: DoctorWithRelations[], now: Date, options: BlockerOptions): PurgePlan {
  const blockers: PurgeBlocker[] = [];
  for (const slug of slugs) {
    if (!doctors.some((d) => d.slug === slug)) {
      blockers.push({ slug, code: "DOCTOR_NOT_FOUND", message: "Bu slug ile doktor bulunamadı." });
    }
  }
  for (const doctor of doctors) blockers.push(...blockersFor(doctor, now, options));
  return { doctors: doctors.map(toPlan), blockers };
}

export function parseSlugList(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0))];
}

export async function runDemoDoctorPurge(
  prisma: PrismaClient,
  options: {
    slugs: readonly string[];
    dryRun: boolean;
    backupDir: string;
    fileRemover: PurgeFileRemover;
    /** Script'i çalıştıran kişi — audit'e yazılır (KVKK: "kim?"). Zorunlu. */
    operator: string;
    /** Yalnızca demo booking'lerdeki klinik içerik için açık gerekçe; boşsa engel uygulanır. */
    allowDemoClinicalReason?: string;
    now?: Date;
  }
): Promise<PurgeResult> {
  const now = options.now ?? new Date();
  if (options.slugs.length === 0) throw new Error("--slugs boş olamaz; yalnızca açıkça verilen slug'lar işlenir.");
  if (options.operator.trim().length === 0) throw new Error("--operator zorunludur (audit kaydı için).");
  const blockerOptions: BlockerOptions = { allowDemoClinical: Boolean(options.allowDemoClinicalReason?.trim()) };

  const doctors = await loadDoctors(prisma, options.slugs);
  const plan = buildPlan(options.slugs, doctors, now, blockerOptions);
  if (plan.blockers.length > 0) throw new PurgeBlockedError(plan.blockers);
  if (options.dryRun) return { plan, dryRun: true, backupFile: null, deleted: null, fileErrors: [] };

  // Yedek: silinecek her satırın TAM hâli (şifreli alanlar şifreli kalır). Hassas — 0600 izinli,
  // repoya girmeyen `storage/` altında. Saklama süresi rapordaki compliance notuna tabidir.
  await fs.mkdir(options.backupDir, { recursive: true });
  const backupFile = path.join(options.backupDir, `purge-demo-doctors-${now.toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(backupFile, JSON.stringify({ createdAt: now.toISOString(), slugs: options.slugs, doctors }, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });

  const deleted = await prisma.$transaction(
    async (tx) => {
      const fresh = await loadDoctors(tx, options.slugs);
      const recheck = buildPlan(options.slugs, fresh, now, blockerOptions);
      if (recheck.blockers.length > 0) throw new PurgeBlockedError(recheck.blockers);

      const doctorIds = fresh.map((d) => d.id);
      const appointmentIds = fresh.flatMap((d) => d.appointments.map((a) => a.id));
      await tx.consultationRecording.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
      const appointments = await tx.appointment.deleteMany({ where: { doctorId: { in: doctorIds } } });
      // Intake + belge satırları booking'e `onDelete: Cascade` ile bağlıdır.
      const bookings = await tx.appointmentBooking.deleteMany({ where: { doctorId: { in: doctorIds } } });
      // Müsaitlik + ek uzmanlık satırları doktora `onDelete: Cascade` ile bağlıdır.
      const removedDoctors = await tx.doctorProfile.deleteMany({ where: { id: { in: doctorIds } } });

      await tx.auditLog.create({
        data: {
          actorId: null,
          actorEmail: null,
          action: "telehealth.doctor.purged",
          status: "SUCCESS",
          targetType: "DoctorProfile",
          targetId: null,
          metadata: {
            source: "purge_script",
            operator: options.operator.trim(),
            allowDemoClinicalReason: options.allowDemoClinicalReason?.trim() || null,
            slugs: [...options.slugs],
            doctorIds,
            appointmentCount: appointments.count,
            bookingCount: bookings.count,
            backupFile: path.basename(backupFile),
          },
        },
      });

      return { doctors: removedDoctors.count, appointments: appointments.count, bookings: bookings.count };
    },
    { isolationLevel: "Serializable" }
  );

  const fileErrors: string[] = [];
  for (const doctor of doctors) {
    for (const booking of doctor.appointmentBookings) {
      for (const document of booking.documents) {
        await options.fileRemover.removeDocument(document.storagePath).catch((err: unknown) => {
          fileErrors.push(`belge ${document.id}: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }
    for (const appointment of doctor.appointments) {
      if (!appointment.recording) continue;
      const recording = appointment.recording;
      await options.fileRemover.removeRecording(recording.id, recording.storagePath).catch((err: unknown) => {
        fileErrors.push(`kayıt ${recording.id}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  return { plan, dryRun: false, backupFile, deleted, fileErrors };
}

/**
 * Compliance kararı — yedekler en fazla `PURGE_BACKUP_RETENTION_DAYS` gün tutulur. Süresi dolan
 * yedekleri siler ve her imhayı audit'e yazar (`telehealth.doctor.purge_backup_destroyed`).
 * Yalnızca `purge-demo-doctors-*.json` adlı dosyalara dokunur.
 */
export async function pruneDemoDoctorPurgeBackups(
  prisma: PrismaClient,
  options: { backupDir: string; operator: string; dryRun: boolean; now?: Date }
): Promise<string[]> {
  const now = options.now ?? new Date();
  if (options.operator.trim().length === 0) throw new Error("--operator zorunludur (audit kaydı için).");
  const cutoff = now.getTime() - PURGE_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const names = await fs.readdir(options.backupDir).catch(() => [] as string[]);
  const expired: string[] = [];
  for (const name of names) {
    if (!/^purge-demo-doctors-.*\.json$/.test(name)) continue;
    const stat = await fs.stat(path.join(options.backupDir, name));
    if (stat.mtimeMs < cutoff) expired.push(name);
  }
  if (options.dryRun) return expired;
  for (const name of expired) {
    await fs.rm(path.join(options.backupDir, name), { force: true });
    await prisma.auditLog.create({
      data: {
        action: "telehealth.doctor.purge_backup_destroyed",
        status: "SUCCESS",
        metadata: { source: "purge_script", operator: options.operator.trim(), backupFile: name },
      },
    });
  }
  return expired;
}
