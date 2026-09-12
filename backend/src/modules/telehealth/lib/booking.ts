import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Appointment, AppointmentBooking } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { runSerializable } from "../../../lib/serializable-tx";
import { generateOpaqueToken, hashToken } from "../../../lib/tokens";
import { BookingNotPayableError, NotFoundError, SlotTakenError, ValidationError } from "../../../lib/errors";
import { isBookableSlotStart } from "./availability";
import { getWallClockParts } from "./timezone";

/**
 * `.claude/architect-scope-telehealth-template.md` §3.5 — LiveKit oda adı TAHMİN EDİLEMEZ,
 * `Appointment.id`'den TÜRETİLMEZ (id log/listelerde görünür). "room_" + 32 hex (16 rastgele bayt).
 */
export function generateMeetingRoomName(): string {
  return `room_${crypto.randomBytes(16).toString("hex")}`;
}

/**
 * §4.5 (bağlayıcı, [TCT] §9.7.6 TADİLATI) — konsültasyon katılım penceresi. SAF fonksiyon:
 * integration-agent bunu `POST /appointments/{id}/meeting-token` ucunda çağırır (backend-agent
 * KENDİ uçlarında KULLANMAZ — bu modülün uçları arasında meeting-token YOKTUR).
 *
 * [TCT] §9.7.6 madde 1 — `startsAt - 5 dk` → `startsAt - 10 dk` (dar tadilat, §4.5'in yerine).
 */
export const JOIN_WINDOW_BEFORE_START_MS = 10 * 60 * 1000;
export const JOIN_WINDOW_AFTER_END_MS = 15 * 60 * 1000;

export function isWithinJoinWindow(now: Date, startsAt: Date, endsAt: Date): boolean {
  return now.getTime() >= startsAt.getTime() - JOIN_WINDOW_BEFORE_START_MS && now.getTime() <= endsAt.getTime() + JOIN_WINDOW_AFTER_END_MS;
}

/**
 * [TCT] §9.7.6 madde 2/3 — çoklu slotta katılım penceresi TEK booking açıklığı üzerinden
 * hesaplanır: `min(startsAt) - 10dk` … `max(endsAt) + 15dk`. **YENİ ŞART (madde 4):**
 * `paymentStatus !== "PAID"` ise `null`/`null` döner — ödenmemiş bir görüşme hiçbir zaman
 * "katılınabilir" olarak GÖRÜNMEZ (DTO düzeyinde de bu tutarlılık korunur).
 */
export function getBookingJoinWindow(
  appointments: readonly Pick<Appointment, "startsAt" | "endsAt">[],
  paymentStatus: string
): { joinableFrom: Date | null; joinableUntil: Date | null } {
  if (paymentStatus !== "PAID" || appointments.length === 0) {
    return { joinableFrom: null, joinableUntil: null };
  }
  const minStartMs = Math.min(...appointments.map((a) => a.startsAt.getTime()));
  const maxEndMs = Math.max(...appointments.map((a) => a.endsAt.getTime()));
  return {
    joinableFrom: new Date(minStartMs - JOIN_WINDOW_BEFORE_START_MS),
    joinableUntil: new Date(maxEndMs + JOIN_WINDOW_AFTER_END_MS),
  };
}

/** [TCT] §9.7.2 KARAR H (bağlayıcı) — tek bir booking'de EN FAZLA 4 slot. */
export const MAX_BOOKING_SLOTS = 4;

/** [TCT] §9.7.1 madde 2/§9.7.3 — slot TUTMA süresi (Stripe Checkout `expires_at` ile AYNI). */
export const BOOKING_HOLD_MS = 30 * 60 * 1000;

/** compliance-agent'ın "TUR 2" onayındaki başlangıç sürümü (bkz. o doküman, satır ~502). */
export const DEFAULT_APPOINTMENT_CONSENT_VERSION = "v1";

/** Hastaya gösterilen okunabilir rezervasyon numarası — `checkout.routes.ts::generateOrderNumber` İLE AYNI desen. */
export function generateBookingNumber(): string {
  const timePart = Date.now().toString(36).toUpperCase();
  const randomPart = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `BKG-${timePart}-${randomPart}`;
}

export interface CreateBookingInput {
  doctorSlug: string;
  /** Sıralı OLMASI gerekmez — fonksiyon içeride sıralar. 1..`MAX_BOOKING_SLOTS` öğe. */
  slots: Date[];
  patientName: string;
  patientEmail: string;
  patientUserId: string | null;
  consentVersion?: string;
}

export interface CreateBookingResult {
  booking: AppointmentBooking;
  doctor: { id: string; title: string; fullName: string; slug: string };
  appointments: Appointment[];
  /** Booking'in KENDİ magic-link token'ı — `POST /appointments/bookings` yanıtında BİR KEZ döner. */
  rawAccessToken: string;
  /**
   * Her `appointments[i]`'e karşılık gelen, o SATIRIN KENDİ (booking'den bağımsız,
   * şema @unique zorunluluğu gereği var olan) ham erişim token'ı. Yeni çoklu-slot akışında
   * KULLANILMAZ/DÖNMEZ (booking'in token'ı kanoniktir) — YALNIZCA deprecated tek-slot
   * `POST /appointments` uyumluluğu için `bookAppointment()` tarafından tüketilir.
   */
  appointmentAccessTokens: string[];
}

/**
 * [TCT] §9.7.2 KARAR H (bağlayıcı) — çoklu slot rezervasyonu. `N` slot = `N` `Appointment`
 * satırı + 1 `AppointmentBooking` üst kaydı; `@@unique([doctorId, startsAt])` çifte rezervasyon
 * garantisi HİÇ DEĞİŞMEDEN çalışır (Appointment satırları üzerinde, booking eklenmeden ÖNCEKİYLE
 * BİREBİR AYNI).
 *
 * Kısıtlar (bağlayıcı): 1..4 slot, hepsi AYNI doktora ve doktorun kendi saat diliminde AYNI
 * takvim gününe ait, her biri `lib/availability.ts` ile AYRI AYRI doğrulanır; herhangi biri
 * dolu/geçersizse HİÇBİRİ oluşmaz (`409 SLOT_TAKEN` / `422`).
 *
 * `unitPriceCents`/`subtotalCents`/`totalCents` İSTEMCİDEN ASLA kabul edilmez — `DoctorProfile`'dan
 * (transaction İÇİNDE, taze) okunur ve sunucuda hesaplanır (§8 madde 3).
 */
export async function createBooking(app: FastifyInstance, input: CreateBookingInput): Promise<CreateBookingResult> {
  if (input.slots.length < 1 || input.slots.length > MAX_BOOKING_SLOTS) {
    throw new ValidationError(`Slot sayısı 1 ile ${MAX_BOOKING_SLOTS} arasında olmalıdır.`, {
      slots: [`En fazla ${MAX_BOOKING_SLOTS} slot seçilebilir.`],
    });
  }

  const sortedSlots = [...input.slots].sort((a, b) => a.getTime() - b.getTime());
  const uniqueTimes = new Set(sortedSlots.map((slot) => slot.getTime()));
  if (uniqueTimes.size !== sortedSlots.length) {
    throw new ValidationError("Aynı slot birden fazla kez seçilemez.", { slots: ["Yinelenen slot bulundu."] });
  }

  const bookingRawAccessToken = generateOpaqueToken();
  const bookingAccessTokenHash = hashToken(bookingRawAccessToken);
  const bookingMeetingRoomName = generateMeetingRoomName();
  const bookingNumber = generateBookingNumber();
  const expiresAt = new Date(Date.now() + BOOKING_HOLD_MS);
  const consentAt = new Date();
  const consentVersion = input.consentVersion?.trim() || DEFAULT_APPOINTMENT_CONSENT_VERSION;

  // Şema zorunluluğu: `Appointment.meetingRoomName`/`accessTokenHash` NOT NULL + @unique'tir
  // (booking'e bağlı satırlarda da KALDIRILMAZ — bkz. schema.prisma yorumu, "booking'inkiler
  // kanonik kabul edilir"). Her satır İÇİN AYRI, rastgele değerler üretilir; ham token'ları
  // yalnızca deprecated tek-slot uç tüketir (aşağıya bkz. `bookAppointment`).
  const perAppointmentTokens = sortedSlots.map(() => {
    const rawAccessToken = generateOpaqueToken();
    return { rawAccessToken, accessTokenHash: hashToken(rawAccessToken), meetingRoomName: generateMeetingRoomName() };
  });

  try {
    const { booking, doctor, appointments } = await runSerializable(app, async (tx) => {
      const doctor = await tx.doctorProfile.findFirst({
        where: { slug: input.doctorSlug, isActive: true },
        include: { availability: true },
      });
      if (!doctor) throw new NotFoundError("Doktor bulunamadı.");

      const now = new Date();

      // [TCT] §9.7.2 (bağlayıcı) — tüm slotlar doktorun kendi diliminde AYNI takvim gününe ait
      // olmalıdır (aksi hâlde booking açıklığı/oda/katılım penceresi kavramı çöker, §9.7.6).
      const calendarDayKeys = new Set(
        sortedSlots.map((slot) => {
          const wall = getWallClockParts(slot, doctor.timeZone);
          return `${wall.year}-${wall.month}-${wall.day}`;
        })
      );
      if (calendarDayKeys.size > 1) {
        throw new ValidationError("Tüm slotlar doktorun aynı takvim gününe ait olmalıdır.", {
          slots: ["Seçilen slotlar farklı günlere ait — tek bir rezervasyonda yalnızca aynı gün seçilebilir."],
        });
      }

      for (const slot of sortedSlots) {
        const isValid = isBookableSlotStart(slot, {
          timeZone: doctor.timeZone,
          sessionDurationMin: doctor.sessionDurationMin,
          rules: doctor.availability,
          now,
        });
        if (!isValid) {
          throw new ValidationError("Seçilen saatlerden biri geçerli/müsait bir randevu zamanı değil.", {
            slots: ["Bu saatlerden biri için randevu alınamaz — takvimi yenileyip tekrar deneyin."],
          });
        }
      }

      // §4.3/§9.7.2 — kısmi rezervasyon YOKTUR: herhangi bir slot doluysa HİÇBİRİ oluşturulmaz.
      const existing = await tx.appointment.findFirst({ where: { doctorId: doctor.id, startsAt: { in: sortedSlots } } });
      if (existing) throw new SlotTakenError();

      const unitPriceCents = doctor.sessionPriceCents;
      const slotCount = sortedSlots.length;
      const subtotalCents = unitPriceCents * slotCount;
      const totalCents = subtotalCents;

      const createdBooking = await tx.appointmentBooking.create({
        data: {
          bookingNumber,
          doctorId: doctor.id,
          patientUserId: input.patientUserId,
          patientName: input.patientName,
          patientEmail: input.patientEmail,
          slotCount,
          unitPriceCents,
          subtotalCents,
          totalCents,
          currency: doctor.currency,
          expiresAt,
          meetingRoomName: bookingMeetingRoomName,
          accessTokenHash: bookingAccessTokenHash,
          consentAt,
          consentVersion,
        },
      });

      const createdAppointments: Appointment[] = [];
      for (let i = 0; i < sortedSlots.length; i++) {
        const startsAt = sortedSlots[i]!;
        const endsAt = new Date(startsAt.getTime() + doctor.sessionDurationMin * 60_000);
        const tokenInfo = perAppointmentTokens[i]!;
        // Tek Serializable transaction İÇİNDE sıralı yazma zorunludur (çoklu satır tek seferde
        // `createMany` ile OLUŞTURULAMAZ: Prisma `createMany` çağrı başına tek dönüş değeri
        // vermez, biz her satırın kendi id/meetingRoomName'ini aşağıda ihtiyaç duyuyoruz).
        const appointment = await tx.appointment.create({
          data: {
            doctorId: doctor.id,
            bookingId: createdBooking.id,
            patientUserId: input.patientUserId,
            patientName: input.patientName,
            patientEmail: input.patientEmail,
            startsAt,
            endsAt,
            status: "PENDING_PAYMENT",
            priceCents: unitPriceCents,
            currency: doctor.currency,
            meetingRoomName: tokenInfo.meetingRoomName,
            accessTokenHash: tokenInfo.accessTokenHash,
          },
        });
        createdAppointments.push(appointment);
      }

      return {
        booking: createdBooking,
        doctor: { id: doctor.id, title: doctor.title, fullName: doctor.fullName, slug: doctor.slug },
        appointments: createdAppointments,
      };
    });

    return {
      booking,
      doctor,
      appointments,
      rawAccessToken: bookingRawAccessToken,
      appointmentAccessTokens: perAppointmentTokens.map((t) => t.rawAccessToken),
    };
  } catch (err) {
    // İkinci savunma hattı — Serializable transaction İÇİNDEKİ `findFirst` kontrolüne rağmen
    // eşzamanlı iki istek YİNE DE `@@unique([doctorId, startsAt])`'i ihlal edebilir (P2002) YA DA
    // birkaç retry'dan sonra hâlâ write-conflict (P2034) verebilir.
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2002" || err.code === "P2034")) {
      throw new SlotTakenError();
    }
    throw err;
  }
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
 * [TCT] §9.7.2 (bağlayıcı) — **DEPRECATED** `POST /appointments` (tek slot) iç olarak
 * `slotCount: 1` bir `createBooking()` çağrısı üretir. Geriye dönük uyumluluk için dönen
 * `rawAccessToken`, booking'in DEĞİL o TEK `Appointment` satırının KENDİ token'ıdır — mevcut
 * `GET/POST /appointments/{id}(/cancel)` uçları hâlâ `Appointment.accessTokenHash`'e karşı
 * doğrulama yapar (bu dosyanın/route'un DAVRANIŞI DEĞİŞTİRİLMEDİ).
 */
export async function bookAppointment(app: FastifyInstance, input: BookAppointmentInput): Promise<BookAppointmentResult> {
  const result = await createBooking(app, {
    doctorSlug: input.doctorSlug,
    slots: [input.startsAt],
    patientName: input.patientName,
    patientEmail: input.patientEmail,
    patientUserId: input.patientUserId,
  });

  return { appointment: result.appointments[0]!, rawAccessToken: result.appointmentAccessTokens[0]! };
}

export interface ConfirmBookingPaymentInput {
  bookingId: string;
  /** "stripe" | "manual" — serbest metin, enum DEĞİL (§9.7.1 madde 7, `BookingPaymentStatus` yorumu). */
  paidBy: string;
  paidNote?: string | null;
  stripePaymentIntentId?: string | null;
  /**
   * VARSA (ör. integration-agent'ın Stripe Checkout `metadata`'sında TAŞIDIĞI orijinal booking
   * token'ı), `accessTokenHash` ROTATE EDİLMEZ — hastanın `POST /appointments/bookings`
   * yanıtında aldığı bağlantı ödeme SONRASI da ÇALIŞMAYA DEVAM EDER (en yaygın/otomatik Stripe
   * akışı için önerilen kullanım). Verilmezse (ör. ADMIN'in manuel `mark-paid` ucu — ham token
   * hiçbir yerde plaintext saklanmadığı için erişilemez) `resend-link` ucuyla AYNI ilkeyle YENİ
   * bir token ÜRETİLİR (rotate).
   */
  knownRawAccessToken?: string;
}

export interface ConfirmBookingPaymentResult {
  booking: AppointmentBooking;
  appointments: Appointment[];
  /**
   * APPOINTMENT_CONFIRMATION e-postasında kullanılacak magic-link token'ı — `knownRawAccessToken`
   * verildiyse AYNEN o, verilmediyse TAZE üretilmiş (rotate edilmiş) bir token. Çağıran taraf
   * bunu ASLA loglamaz/API yanıtına koymaz.
   */
  rawAccessToken: string;
}

/**
 * [TCT] §9.7.1 madde 5 (bağlayıcı) — booking onayı: TEK `runSerializable` transaction'da
 * `paymentStatus = PAID` + `paidAt` + TÜM `PENDING_PAYMENT` randevuları `SCHEDULED`'a çevirir.
 * Stok düşürme YOKTUR (satılan bir envanter değil, bir zaman dilimidir).
 *
 * **Paylaşılan hook noktası:** hem `POST /admin/telehealth/bookings/{id}/mark-paid`
 * (backend-agent) HEM DE integration-agent'ın `webhooks/stripe.routes.ts::handleCheckoutCompleted`
 * yeni dalı BU fonksiyonu çağırmalıdır — ödeme onayının iş mantığı (booking/randevu durum geçişi)
 * TEK yerde yaşar, Stripe'a özgü kod (imza doğrulama, idempotency, checkout session okuma)
 * integration-agent'ın kendi dosyasında KALIR.
 *
 * `booking.paymentStatus !== "PENDING"` ise `BookingNotPayableError` (409) fırlatır — bu hem
 * ADMIN'in "zaten ödenmiş" tekrar denemesini HEM DE webhook'un kendi idempotency ön-kontrolünü
 * (integration-agent, `stripeCheckoutSessionId` + durum kontrolü) TAMAMLAYICI bir ikinci
 * savunma hattıdır.
 */
export async function confirmBookingPayment(app: FastifyInstance, input: ConfirmBookingPaymentInput): Promise<ConfirmBookingPaymentResult> {
  const rawAccessToken = input.knownRawAccessToken ?? generateOpaqueToken();
  const accessTokenHash = hashToken(rawAccessToken);

  const { booking, appointments } = await runSerializable(app, async (tx) => {
    const existing = await tx.appointmentBooking.findUnique({ where: { id: input.bookingId } });
    if (!existing) throw new NotFoundError("Rezervasyon bulunamadı.");
    if (existing.paymentStatus !== "PENDING") throw new BookingNotPayableError();

    const updatedBooking = await tx.appointmentBooking.update({
      where: { id: existing.id },
      data: {
        paymentStatus: "PAID",
        paidAt: new Date(),
        paidBy: input.paidBy,
        paidNote: input.paidNote ?? null,
        ...(input.stripePaymentIntentId ? { stripePaymentIntentId: input.stripePaymentIntentId } : {}),
        // `knownRawAccessToken` verildiyse hash ZATEN eşleşir (no-op update) — verilmediyse
        // rotate edilmiş YENİ hash yazılır.
        accessTokenHash,
      },
    });

    await tx.appointment.updateMany({
      where: { bookingId: existing.id, status: "PENDING_PAYMENT" },
      data: { status: "SCHEDULED" },
    });

    const updatedAppointments = await tx.appointment.findMany({
      where: { bookingId: existing.id },
      orderBy: { startsAt: "asc" },
    });

    return { booking: updatedBooking, appointments: updatedAppointments };
  });

  return { booking, appointments, rawAccessToken };
}
