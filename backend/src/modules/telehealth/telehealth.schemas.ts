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
  status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListAdminAppointmentsQuery = z.infer<typeof ListAdminAppointmentsQuerySchema>;
