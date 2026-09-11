import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Appointment } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { runSerializable } from "../../../lib/serializable-tx";
import { generateOpaqueToken, hashToken } from "../../../lib/tokens";
import { NotFoundError, SlotTakenError, ValidationError } from "../../../lib/errors";
import { isBookableSlotStart } from "./availability";

/**
 * `.claude/architect-scope-telehealth-template.md` §3.5 — LiveKit oda adı TAHMİN EDİLEMEZ,
 * `Appointment.id`'den TÜRETİLMEZ (id log/listelerde görünür). "room_" + 32 hex (16 rastgele bayt).
 */
export function generateMeetingRoomName(): string {
  return `room_${crypto.randomBytes(16).toString("hex")}`;
}

/**
 * §4.5 (bağlayıcı) — konsültasyon katılım penceresi. SAF fonksiyon: integration-agent bunu
 * `POST /appointments/{id}/meeting-token` ucunda çağırır (backend-agent KENDİ uçlarında
 * KULLANMAZ — bkz. görev notu, bu modülün uçları arasında meeting-token YOKTUR).
 */
export const JOIN_WINDOW_BEFORE_START_MS = 5 * 60 * 1000;
export const JOIN_WINDOW_AFTER_END_MS = 15 * 60 * 1000;

export function isWithinJoinWindow(now: Date, startsAt: Date, endsAt: Date): boolean {
  return now.getTime() >= startsAt.getTime() - JOIN_WINDOW_BEFORE_START_MS && now.getTime() <= endsAt.getTime() + JOIN_WINDOW_AFTER_END_MS;
}

export interface BookAppointmentInput {
  doctorSlug: string;
  startsAt: Date;
  patientName: string;
  patientEmail: string;
  patientUserId: string | null;
}

export interface BookAppointmentResult {
  appointment: Appointment;
  rawAccessToken: string;
}

/**
 * §4.3 (bağlayıcı) — "check-then-act" rezervasyon. `runSerializable` BURADA GEREKLİDİR (webhook
 * stok düşürme ile AYNI sınıf yarış koruması): doktor+müsaitlik oku → istenen `startsAt`
 * GERÇEKTEN bir slot mu (saf, `lib/availability.ts`) → o slot dolu mu (`tx.appointment.findFirst`)
 * → değilse oluştur. `@@unique([doctorId, startsAt])` İKİNCİ savunma hattıdır — `P2002` yakalanıp
 * `409 SLOT_TAKEN`'e çevrilir (Serializable izolasyonda P2034 de mümkündür, o da retry'dan sonra
 * hâlâ çakışıyorsa aynı şekilde `SlotTakenError`'a normalize edilir — çağıranın bakış açısından
 * ikisi de "az önce dolduruldu" anlamına gelir).
 *
 * `priceCents`/`sessionDurationMin`/`currency` İSTEMCİDEN ASLA kabul edilmez — `DoctorProfile`'dan
 * (transaction İÇİNDE, taze) okunur.
 */
export async function bookAppointment(app: FastifyInstance, input: BookAppointmentInput): Promise<BookAppointmentResult> {
  const rawAccessToken = generateOpaqueToken();
  const accessTokenHash = hashToken(rawAccessToken);
  const meetingRoomName = generateMeetingRoomName();

  try {
    const appointment = await runSerializable(app, async (tx) => {
      const doctor = await tx.doctorProfile.findFirst({
        where: { slug: input.doctorSlug, isActive: true },
        include: { availability: true },
      });
      if (!doctor) throw new NotFoundError("Doktor bulunamadı.");

      const now = new Date();
      const isValidSlot = isBookableSlotStart(input.startsAt, {
        timeZone: doctor.timeZone,
        sessionDurationMin: doctor.sessionDurationMin,
        rules: doctor.availability,
        now,
      });
      if (!isValidSlot) {
        throw new ValidationError("Seçilen saat geçerli/müsait bir randevu zamanı değil.", {
          startsAt: ["Bu saat için randevu alınamaz — takvimi yenileyip tekrar deneyin."],
        });
      }

      // §4.3 — iptal edilen bir randevu bile `startsAt`'i DEĞİŞTİRMEZ ve slot yeniden
      // satılabilir DEĞİLDİR (`@@unique([doctorId, startsAt])` bunu zaten zorlar); bu yüzden
      // status'tan BAĞIMSIZ olarak AYNI (doctorId, startsAt) çifti üzerinde herhangi bir kayıt
      // varsa slot doludur.
      const existing = await tx.appointment.findFirst({ where: { doctorId: doctor.id, startsAt: input.startsAt } });
      if (existing) throw new SlotTakenError();

      const endsAt = new Date(input.startsAt.getTime() + doctor.sessionDurationMin * 60_000);

      return tx.appointment.create({
        data: {
          doctorId: doctor.id,
          patientUserId: input.patientUserId,
          patientName: input.patientName,
          patientEmail: input.patientEmail,
          startsAt: input.startsAt,
          endsAt,
          priceCents: doctor.sessionPriceCents,
          currency: doctor.currency,
          meetingRoomName,
          accessTokenHash,
        },
      });
    });

    return { appointment, rawAccessToken };
  } catch (err) {
    // İkinci savunma hattı — Serializable transaction İÇİNDEKİ `findFirst` kontrolüne rağmen
    // eşzamanlı iki istek YİNE DE `@@unique([doctorId, startsAt])`'i ihlal edebilir (P2002) YA DA
    // birkaç retry'dan sonra hâlâ write-conflict (P2034) verebilir — ikisi de çağıran için AYNI
    // anlama gelir: "bu saat az önce dolduruldu".
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2002" || err.code === "P2034")) {
      throw new SlotTakenError();
    }
    throw err;
  }
}
