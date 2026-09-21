import { z } from "zod";
import { DoctorCvEntrySchema, DoctorPublicationSchema } from "../../schemas/entities";

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

/** `GET /specialties/{slug}` (public) — `DoctorSlugParamSchema` İLE AYNI şekil, ayrı isim (netlik). */
export const SpecialtySlugParamSchema = z.object({
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
 * `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §2.4/§2.6 —
 * `POST /appointments/bookings` ve `PUT .../identity` gövdesindeki kimlik nesnesi. Bu şema
 * yalnızca YÜZEYSEL şekli (uzunluk/regex) doğrular; TCKN checksum'u/pasaport biçimi/ülke kodu
 * kuralları/18 yaş sınırı gibi DERİN doğrulama `lib/identity.ts::validateBookingIdentityInput`
 * İÇİNDE, route katmanında yapılır (security-review ENGELLEYİCİ madde 3 — jenerik hata mesajı
 * disiplini Zod `.refine()` mesaj interpolasyonuyla İHLAL EDİLMESİN diye BİLİNÇLİ bir ayrım).
 * `citizenshipType` yalnızca `TR`/`FOREIGN` kabul eder — `FOREIGN_RESIDENT` bu turda hiçbir akış
 * tarafından YAZILMAZ (Prisma enum'unun kendisi §5'te 3 değerle tanımlı, girdi şeması burada
 * BİLİNÇLİ olarak dar tutulur).
 */
export const BookingIdentityInputSchema = z.object({
  citizenshipType: z.enum(["TR", "FOREIGN"]),
  identityNumber: z.string().min(6).max(20),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/, "Geçersiz ülke kodu.")
    .nullable()
    .optional(),
  birthDate: z.string().regex(ISO_DATE_RE, "`birthDate` YYYY-MM-DD biçiminde olmalı."),
});
export type BookingIdentityInput = z.infer<typeof BookingIdentityInputSchema>;

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
  // [DPI] §2.6 (bağlayıcı) — ZORUNLU. Kimlik, booking satırıyla AYNI transaction'da yazılır;
  // ayrı bir "önce booking aç, sonra kimlik ekle" adımı REDDEDİLDİ.
  identity: BookingIdentityInputSchema,
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

/** [DPI] §3.2 — konsolun durum filtresi (Tümü/Bugün/Gelecek/Tamamlanan). */
export const DoctorBookingsScopeSchema = z.enum(["all", "today", "upcoming", "completed"]);
export type DoctorBookingsScope = z.infer<typeof DoctorBookingsScopeSchema>;

export const DoctorBookingsQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    paymentStatus: z.enum(["PENDING", "PAID", "FAILED", "EXPIRED", "REFUNDED"]).optional(),
    scope: DoctorBookingsScopeSchema.default("all"),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  // [DPI] §3.2 (bağlayıcı) — `scope` (`all` DIŞINDA bir değer) `from`/`to` ile BİRLİKTE
  // gönderilemez (iki farklı zaman ekseni sessizce birleştirilmez). `scope` gönderilmediğinde
  // (varsayılan `all`) mevcut `from`/`to` davranışı GERİYE DÖNÜK olarak DEĞİŞMEZ.
  .superRefine((data, ctx) => {
    if (data.scope !== "all" && (data.from !== undefined || data.to !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "`scope`, `from`/`to` ile birlikte gönderilemez.",
        path: ["scope"],
      });
    }
  });
export type DoctorBookingsQuery = z.infer<typeof DoctorBookingsQuerySchema>;

/**
 * [KHP] `.claude/architect-scope-telehealth-template.md` §9.8.4 KARAR O — `GET /patient/bookings`
 * sekme filtresi (Aktif/Geçmiş/İptal). `DoctorBookingsScopeSchema` İLE AYNI desen, ama tanımları
 * hastanın bakış açısına göre KASITLI OLARAK FARKLIDIR (bkz. `lib/patient-booking-scope.ts`).
 * `from`/`to` YOKTUR (doktor ucunun aksine bu turda gerekmiyor) — bu yüzden `DoctorBookingsQuerySchema`
 * İLE AYNI `superRefine` çakışma kontrolüne de ihtiyaç yoktur.
 */
export const PatientBookingsScopeSchema = z.enum(["all", "upcoming", "past", "cancelled"]);
export type PatientBookingsScope = z.infer<typeof PatientBookingsScopeSchema>;

export const PatientBookingsQuerySchema = z.object({
  scope: PatientBookingsScopeSchema.default("all"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type PatientBookingsQuery = z.infer<typeof PatientBookingsQuerySchema>;

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
  // [DPI] §1.1 — alt branş/bağlı merkez, serbest metin, enum DEĞİL.
  subSpecialty: z.string().trim().min(1).max(120).nullable().optional(),
  fullName: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).optional(),
  bio: z.string().trim().min(1).max(5000),
  // [DPI] §1.1/§1.2 — `lib/html-sanitize.ts`'ten GEÇİRİLİR (route katmanında); temizlik sonrası
  // boşsa `null` yazılır.
  aboutHtml: z.string().max(20000).nullable().optional(),
  // [DPI] §1.1 — üst sınır (içinde bulunulan yıl) route katmanında dinamik olarak zorlanır.
  practiceStartYear: z.number().int().min(1950).nullable().optional(),
  cvEntries: z.array(DoctorCvEntrySchema).max(60).optional(),
  publications: z.array(DoctorPublicationSchema).max(200).optional(),
  languages: LANGUAGES_SCHEMA,
  timeZone: z.string().trim().min(1).max(80),
  specialtyId: z.string().uuid().nullable().optional(),
  sessionDurationMin: z.number().int().min(5).max(240),
  // `null` = ücret bilgisi tanımlanmamış (admin panelde "Ücretli Hizmet" toggle'ı kapalı) —
  // booking akışı bunu ücretsiz/bilgi-alınız seans olarak yorumlar, ödeme adımı atlanır.
  sessionPriceCents: z.number().int().min(0).nullable(),
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

/**
 * backend-agent görev notu (2026-09-15, "Doktorun kendi `timeZone`'unu güncelleyebilmesi") —
 * Node 20 tam ICU ile gelir (bkz. `lib/timezone.ts` dosya başı notu); YENİ bir kütüphane
 * EKLENMEZ, `Intl.DateTimeFormat` kurucusunun kendi doğrulaması "dener/fırlatır" deseniyle
 * yeniden kullanılır. Geçersiz bir IANA kimliği (ör. "UTC+3", boş dize, uydurma bölge) `RangeError`
 * fırlatır — bu `false` olarak yakalanır. Projede bu tur ÖNCESİNDE `timeZone` için ayrı bir
 * IANA-format doğrulaması YOKTU (admin `CreateDoctorRequestSchema.timeZone` yalnızca serbest
 * metin sınırı taşıyordu) — bu fonksiyon yalnızca BU alan için eklenir, admin şeması bilerek
 * DEĞİŞTİRİLMEZ (kapsam dışı).
 */
function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * [DPI] §1.4 (bağlayıcı) — `PUT /doctor/profile` gövdesi. **`UpdateDoctorRequestSchema`'dan
 * TÜRETİLMEZ** (admin şemasına ileride eklenecek bir alan sessizce doktorun yazma yüzeyine
 * düşmesin diye AYRI bir şema). `.strict()`: kapsam dışı alan (ör. `title`/`sessionPriceCents`/
 * `experienceYears`) → `422`, sessiz yok sayma YOK. Tüm alanlar opsiyoneldir (yalnızca
 * gönderilenler güncellenir); `cvEntries`/`publications` gönderilirse dizinin TAMAMINI değiştirir.
 *
 * `timeZone` — backend-agent görev notu (2026-09-15) ile eklendi: doktor konsolundaki saat
 * bilgisi hastanın rezervasyon saatiyle karşılaştırılamıyordu çünkü doktor kendi `timeZone`'unu
 * (varsayılan `"Europe/Istanbul"`) DEĞİŞTİREMİYORDU — artık self-service opsiyonel bir alan.
 * `isValidIanaTimeZone` ile doğrulanır ("UTC+3" gibi bir ofset dizesi KABUL EDİLMEZ, yalnızca
 * gerçek IANA kimlikleri, ör. "Europe/Istanbul", "America/New_York").
 */
export const UpdateDoctorSelfProfileRequestSchema = z
  .object({
    subSpecialty: z.string().trim().max(120).nullable().optional(),
    bio: z.string().trim().min(1).max(5000).optional(),
    aboutHtml: z.string().max(20000).nullable().optional(),
    practiceStartYear: z.number().int().min(1950).nullable().optional(),
    languages: LANGUAGES_SCHEMA.optional(),
    cvEntries: z.array(DoctorCvEntrySchema).max(60).optional(),
    publications: z.array(DoctorPublicationSchema).max(200).optional(),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine(isValidIanaTimeZone, { message: "Geçerli bir IANA saat dilimi kimliği olmalı (ör. \"Europe/Istanbul\")." })
      .optional(),
  })
  .strict();
export type UpdateDoctorSelfProfileRequest = z.infer<typeof UpdateDoctorSelfProfileRequestSchema>;

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

/**
 * [TCT] §9.7.7 KARAR K10a — `GET /admin/telehealth/analytics/overview`. Aralık çözümü
 * `lib/stats-query.ts::resolveStatsRange`'e DEVREDİLİR (`from`/`to` — varsayılan son 30 gün,
 * üst sınır 366 gün, aşımda 422); bu şema yalnızca ham string'leri KABUL eder, doğrulamayı
 * TEKRAR ETMEZ.
 */
export const TelehealthOverviewQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  granularity: z.enum(["day", "week", "month"]).default("day"),
});
export type TelehealthOverviewQuery = z.infer<typeof TelehealthOverviewQuerySchema>;

/**
 * NOT — 2026-09-15 (backend-agent görev notu, "Admin randevu yeniden planlama") —
 * `PATCH /admin/telehealth/appointments/{id}/reschedule` gövdesi. `id` bir **Appointment
 * ID'sidir** (booking ID DEĞİL) — bu uç YALNIZCA belirtilen TEK appointment satırını yeniden
 * planlar, booking'in DİĞER appointment'larına (çoklu-slot rezervasyonlarda) DOKUNMAZ. Bu,
 * çok-slotlu bir booking'in "blok" bütünlüğünü bozabilir (ör. 4 saatlik bloktan 1 saat başka
 * güne taşınabilir) — bilinçli/dar kapsam (backlog: "booking-geneli reschedule").
 * `newDate`/`newStartTime` randevunun DOKTORUNUN `DoctorProfile.timeZone` alanındaki DUVAR
 * SAATİ olarak yorumlanır (bkz. `lib/timezone.ts::wallTimeToUtc`, telehealth.admin.routes.ts).
 */
export const RescheduleAppointmentRequestSchema = z.object({
  newDate: z.string().regex(ISO_DATE_RE, "`newDate` YYYY-MM-DD biçiminde olmalı."),
  newStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "`newStartTime` HH:mm biçiminde olmalı."),
  reason: z.string().trim().max(500).optional(),
});
export type RescheduleAppointmentRequest = z.infer<typeof RescheduleAppointmentRequestSchema>;

export const ListAdminAppointmentsQuerySchema = z.object({
  doctorId: z.string().uuid().optional(),
  // [TCT] §9.7.3 — `PENDING_PAYMENT` eklendi (tutulmuş-ama-ödenmemiş slot da artık bir filtre değeridir).
  status: z.enum(["PENDING_PAYMENT", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListAdminAppointmentsQuery = z.infer<typeof ListAdminAppointmentsQuerySchema>;

// ---------- TUR 3 (bağlayıcı) — Sunucu tarafı görüşme kaydı (LiveKit Egress) ----------

/** Rıza istemi metninin gösterildiği sabit sürüm — `consentVersion` alanlarıyla AYNI desen (§9.7.5). */
export const RECORDING_CONSENT_VERSION = "v1";
/** Rıza isteminin geçerlilik penceresi (ms) — bu süre dolduktan sonra yanıt `RECORDING_CONSENT_EXPIRED` (409) ile reddedilir. */
export const RECORDING_CONSENT_TTL_MS = 120_000; // 2 dakika

export const RecordingConsentRequestSchema = z.object({ granted: z.boolean() });
export type RecordingConsentRequest = z.infer<typeof RecordingConsentRequestSchema>;

/** `?disposition=inline|attachment`, varsayılan `attachment` (indirme, izin verilen tek varsayılan). */
export const RecordingContentQuerySchema = AccessTokenQuerySchema.extend({
  disposition: z.enum(["inline", "attachment"]).default("attachment"),
});
export type RecordingContentQuery = z.infer<typeof RecordingContentQuerySchema>;
