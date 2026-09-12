import { z } from "zod";

/** `.claude/architect-scope-telehealth-template.md` §3.2/§4.1 — Zod istek/param şemaları. */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_639_1_RE = /^[a-z]{2}$/;
// §4.3 madde 3 (bağlayıcı) — "gerçek bir SLOT" ile hizalanmak için `startsAt` yalnızca dakika
// çözünürlüğünde (saniye/milisaniye = 0) UTC bir an olarak kabul edilir. `z.string().datetime()`
// (offset ZORUNLU `Z`) ile birlikte kullanılır (bkz. openapi.yaml `CreateAppointmentRequest`).
const ISO_INSTANT_SCHEMA = z.string().datetime({ offset: false });

// ---------- Public ----------

export const ListPublicDoctorsQuerySchema = z.object({
  specialtySlug: z.string().min(1).max(80).optional(),
  language: z.string().regex(ISO_639_1_RE).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListPublicDoctorsQuery = z.infer<typeof ListPublicDoctorsQuerySchema>;

export const DoctorSlugParamSchema = z.object({
  slug: z.string().min(1).max(80),
});

/**
 * §4.2 — `GET /doctors/{slug}/slots?from=&to=`, en fazla 31 GÜNLÜK aralık. `from`/`to` doktorun
 * KENDİ takvim günüdür (bir zaman dilimi TAŞIMAZ) — dönüşüm `lib/timezone.ts`'te yapılır.
 */
export const DoctorSlotsQuerySchema = z
  .object({
    from: z.string().regex(ISO_DATE_RE, "`from` YYYY-MM-DD biçiminde olmalı."),
    to: z.string().regex(ISO_DATE_RE, "`to` YYYY-MM-DD biçiminde olmalı."),
  })
  .superRefine((data, ctx) => {
    const fromMs = Date.parse(`${data.from}T00:00:00Z`);
    const toMs = Date.parse(`${data.to}T00:00:00Z`);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Geçersiz tarih.", path: ["from"] });
      return;
    }
    const diffDays = (toMs - fromMs) / 86_400_000;
    if (diffDays < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "`to`, `from`'dan önce olamaz.", path: ["to"] });
    } else if (diffDays > 31) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Aralık en fazla 31 gün olabilir.", path: ["to"] });
    }
  });
export type DoctorSlotsQuery = z.infer<typeof DoctorSlotsQuerySchema>;

/**
 * §3.5 (bağlayıcı, compliance) — yalnızca ad + e-posta toplanır; semptom/şikâyet alanı YOKTUR.
 * `consent: true` — KVKK açık rıza onay kutusu, varsayılan işaretsiz (frontend), sunucu yalnızca
 * `true` kabul eder (`z.literal(true)` — checkout'taki `distanceSalesApproved` ile AYNI desen).
 */
export const CreateAppointmentRequestSchema = z.object({
  doctorSlug: z.string().min(1).max(80),
  startsAt: ISO_INSTANT_SCHEMA,
  patientName: z.string().trim().min(1).max(120),
  patientEmail: z.string().trim().toLowerCase().email().max(255),
  consent: z.literal(true),
});
export type CreateAppointmentRequest = z.infer<typeof CreateAppointmentRequestSchema>;

export const AppointmentIdParamSchema = z.object({
  id: z.string().uuid(),
});

/** `GET /appointments/{id}` ve `POST /appointments/{id}/cancel` — misafir erişimi için opak token. */
export const AccessTokenQuerySchema = z.object({
  t: z.string().min(1).max(512).optional(),
});

export const CancelAppointmentRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});
export type CancelAppointmentRequest = z.infer<typeof CancelAppointmentRequestSchema>;

/**
 * `POST /appointments/{id}/complete` — opsiyonel epikriz/konsültasyon notu. `note` boş/undefined
 * ise mevcut davranış (yalnızca status/`endedAt`) DEĞİŞMEZ; DOLU ise (Tiptap zengin metin
 * editörünün ürettiği, `sanitizeRichHtml` ile temizlenmiş HTML) `Appointment.
 * consultationNoteCiphertext`'e AES-256-GCM şifreli yazılır (bkz. telehealth.livekit.routes.ts).
 * Üst sınır (`.max(20000)`) düz metin DEĞİL sanitize edilmiş HTML'i hesaba katar (etiketler +
 * tablo/liste yapısı düz metne göre daha fazla karakter kaplar).
 * Dıştaki `.nullish()` (`.optional()` DEĞİL) BİLİNÇLİDİR — `light-my-request`/Fastify, `payload`
 * HİÇ verilmediğinde gövdeyi `undefined` DEĞİL `null` gönderir (`StartImportJobRequestSchema`
 * ile YAŞANMIŞ AYNI kuyruk, bkz. tests/integration/import.test.ts yorumu); `.optional()` bu
 * durumda "Expected object, received null" ile 422 üretirdi.
 */
export const CompleteAppointmentRequestSchema = z.object({ note: z.string().trim().max(20000).nullish() }).nullish();
export type CompleteAppointmentRequest = z.infer<typeof CompleteAppointmentRequestSchema>;

// ---------- [TCT] §9.7 TADİLAT TURU 2 — booking (çoklu slot) + sağlık verisi + portal ----------

export const BookingIdParamSchema = z.object({
  bookingId: z.string().uuid(),
});

/**
 * §9.7.2 KARAR H (bağlayıcı) — `slots` 1..4 öğe (`MAX_BOOKING_SLOTS`); yinelenen/farklı-gün/
 * farklı-doktor doğrulaması `lib/booking.ts::createBooking` İÇİNDE (doktorun `timeZone`'una
 * ihtiyaç duyduğu için burada DEĞİL, orada) yapılır. `consent` — randevu KVKK onay kutusu,
 * sağlık verisi rızası DEĞİLDİR (o `UpsertIntakeRequestSchema.healthDataConsent` ile AYRI).
 */
export const CreateBookingRequestSchema = z.object({
  doctorSlug: z.string().min(1).max(80),
  slots: z.array(ISO_INSTANT_SCHEMA).min(1).max(4),
  patientName: z.string().trim().min(1).max(120),
  patientEmail: z.string().trim().toLowerCase().email().max(255),
  consent: z.literal(true),
  consentVersion: z.string().trim().min(1).max(40).optional(),
});
export type CreateBookingRequest = z.infer<typeof CreateBookingRequestSchema>;

export const CancelBookingRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});
export type CancelBookingRequest = z.infer<typeof CancelBookingRequestSchema>;

/**
 * §9.7.5 KARAR J (ENGELLEYİCİ, bağlayıcı) — `healthDataConsent` randevu onayından AYRI, ikinci
 * bir açık rızadır; varsayılan işaretsiz (frontend), sunucu yalnızca `true` kabul eder.
 * `true` DEĞİLSE `422 HEALTH_CONSENT_REQUIRED` (route katmanında, bu şema `z.literal(true)`
 * İLE ZATEN "eksikse `false`/undefined" olgusunu ZodError'a çevirir — ama route handler'ı
 * BAĞLAYICI hata KODUNU (`HEALTH_CONSENT_REQUIRED`, genel `VALIDATION_ERROR` DEĞİL) üretmek
 * için doğrulamayı elle de tekrarlar, bkz. telehealth.routes.ts).
 */
export const UpsertIntakeRequestSchema = z.object({
  note: z.string().trim().max(2000).nullable().optional(),
  healthDataConsent: z.boolean(),
  consentVersion: z.string().trim().min(1).max(40).optional(),
});
export type UpsertIntakeRequest = z.infer<typeof UpsertIntakeRequestSchema>;

export const AppointmentDocumentIdParamSchema = z.object({
  documentId: z.string().uuid(),
});

/** §9.7.1 madde 7 (bağlayıcı) — YALNIZCA ADMIN, `reason` ZORUNLU (denetim kaydı + `paidNote`). */
export const MarkBookingPaidRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type MarkBookingPaidRequest = z.infer<typeof MarkBookingPaidRequestSchema>;

export const ListAdminBookingsQuerySchema = z.object({
  doctorId: z.string().uuid().optional(),
  paymentStatus: z.enum(["PENDING", "PAID", "FAILED", "EXPIRED", "REFUNDED"]).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListAdminBookingsQuery = z.infer<typeof ListAdminBookingsQuerySchema>;

export const DoctorBookingsQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  paymentStatus: z.enum(["PENDING", "PAID", "FAILED", "EXPIRED", "REFUNDED"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type DoctorBookingsQuery = z.infer<typeof DoctorBookingsQuerySchema>;

// ---------- Admin ----------

export const SpecialtyIdParamSchema = z.object({
  specialtyId: z.string().uuid(),
});

export const CreateSpecialtyRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(80).optional(),
  icon: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).nullable().optional(),
  order: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export type CreateSpecialtyRequest = z.infer<typeof CreateSpecialtyRequestSchema>;

export const UpdateSpecialtyRequestSchema = CreateSpecialtyRequestSchema.partial();
export type UpdateSpecialtyRequest = z.infer<typeof UpdateSpecialtyRequestSchema>;

export const DoctorIdParamSchema = z.object({
  doctorId: z.string().uuid(),
});

export const ListAdminDoctorsQuerySchema = z.object({
  specialtyId: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListAdminDoctorsQuery = z.infer<typeof ListAdminDoctorsQuerySchema>;

const LANGUAGES_SCHEMA = z.array(z.string().regex(ISO_639_1_RE, "ISO 639-1 kod bekleniyor (ör. \"tr\")")).max(6);

export const CreateDoctorRequestSchema = z.object({
  title: z.string().trim().min(1).max(40),
  fullName: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).optional(),
  bio: z.string().trim().min(1).max(5000),
  languages: LANGUAGES_SCHEMA,
  timeZone: z.string().trim().min(1).max(80),
  specialtyId: z.string().uuid().nullable().optional(),
  sessionDurationMin: z.number().int().min(5).max(240),
  sessionPriceCents: z.number().int().min(0),
  currency: z.string().trim().length(3).optional(),
  avatarMediaId: z.string().uuid().nullable().optional(),
  // §7.2 şablon disiplini yalnızca `demo-templates` içe aktarıcısını bağlar — burası GERÇEK admin
  // CRUD'udur, `isVerified` bilinçli/manuel bir yönetici kararı olarak AYARLANABİLİR.
  isVerified: z.boolean().optional(),
  isActive: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  // Opsiyonel panel kullanıcısı bağlantısı (§2.5) — `User.id`, `@@unique` ihlali `409 CONFLICT`.
  userId: z.string().uuid().nullable().optional(),
});
export type CreateDoctorRequest = z.infer<typeof CreateDoctorRequestSchema>;

export const UpdateDoctorRequestSchema = CreateDoctorRequestSchema.partial();
export type UpdateDoctorRequest = z.infer<typeof UpdateDoctorRequestSchema>;

const AVAILABILITY_RULE_INPUT_SCHEMA = z
  .object({
    dayOfWeek: z.number().int().min(1).max(7),
    startMinute: z.number().int().min(0).max(1440),
    endMinute: z.number().int().min(0).max(1440),
    isActive: z.boolean().optional(),
  })
  .refine((rule) => rule.startMinute < rule.endMinute, {
    message: "`startMinute`, `endMinute`'dan küçük olmalı.",
    path: ["endMinute"],
  });

/**
 * `PUT /admin/telehealth/doctors/{id}/availability` — haftalık ızgaranın TAMAMINI değiştirir
 * (frontend editörü tüm hafta durumunu tek seferde gönderir; sunucu eski kuralları silip
 * yenilerini yazar, bkz. telehealth.admin.routes.ts). En fazla 21 satır (3 pencere × 7 gün,
 * [DTI]/[EPT] tavan disipliniyle TUTARLI bir üst sınır — makul bir yönetici girişini aşan
 * herhangi bir istek zaten bir hata/otomasyon belirtisidir).
 */
export const SetDoctorAvailabilityRequestSchema = z.object({
  rules: z.array(AVAILABILITY_RULE_INPUT_SCHEMA).max(21),
});
export type SetDoctorAvailabilityRequest = z.infer<typeof SetDoctorAvailabilityRequestSchema>;

export const ListAdminAppointmentsQuerySchema = z.object({
  doctorId: z.string().uuid().optional(),
  // [TCT] §9.7.3 — `PENDING_PAYMENT` eklendi (tutulmuş-ama-ödenmemiş slot da artık bir filtre değeridir).
  status: z.enum(["PENDING_PAYMENT", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListAdminAppointmentsQuery = z.infer<typeof ListAdminAppointmentsQuerySchema>;
