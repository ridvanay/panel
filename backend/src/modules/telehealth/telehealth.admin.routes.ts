import type { FastifyInstance } from "fastify";
import { resolveCvEntryMedia } from "./lib/cv-entry-media";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ROLES_ADMIN, ROLES_ADMIN_MANAGER, ROLES_PANEL } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta } from "../../schemas/common";
import {
  AppointmentBookingSchema,
  AppointmentSchema,
  DoctorAvailabilityRuleSchema,
  DoctorProfileSchema,
  SpecialtySchema,
  UpdateTelehealthThemeSettingsRequestSchema,
} from "../../schemas/entities";
import { toAppointmentBookingDto, toAppointmentDto, toDoctorProfileDto, toSpecialtyDto } from "../../mappers";
import {
  AppointmentNotDeletableError,
  AppointmentRescheduleConflictError,
  BookingNotArchivableError,
  ConflictError,
  DoctorHasHistoryError,
  DoctorHasUpcomingAppointmentsError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../lib/errors";
import { buildPageMeta, parseCursor } from "../../lib/pagination";
import { isImageMimeType } from "../../lib/mime-detect";
import { slugify } from "../../lib/slug";
import { logAudit } from "../../lib/audit";
import { sanitizeRichHtml } from "../../lib/html-sanitize";
import { canAccessBookingHealthData } from "../../lib/telehealth-access";
import { CACHE_TAGS, revalidateTagsOnWrite, triggerTagRevalidation } from "../../lib/revalidate";
import { runSerializable } from "../../lib/serializable-tx";
import { confirmBookingPayment } from "./lib/booking";
import { APPOINTMENT_DELETION_INCLUDE, getAppointmentDeletionBlockers, toDeletionInput } from "./lib/appointment-deletion";
import { triggerAppointmentConfirmationEmail, triggerAppointmentRescheduledEmail } from "./lib/notifications";
import { provisionPatientAccountForBooking } from "./lib/patient-account";
import { parseTelehealthTheme } from "./lib/theme-settings";
import {
  TelehealthSettingsResponseSchema,
  UpdateEmergencyNoticeRequestSchema,
  applyEmergencyNoticeUpdate,
  mergeTelehealthSettings,
  parseEmergencyNotice,
  toTelehealthSettingsDto,
} from "./lib/emergency-notice";
import { UpdateDoctorHeroRequestSchema, applyDoctorHeroUpdate, parseDoctorHero, resolveDoctorHero } from "./lib/doctor-hero";
import { wallTimeToUtc } from "./lib/timezone";
import { replaceWeeklyAvailability } from "./lib/weekly-availability";
import { invalidateEarliestAvailability } from "./lib/earliest-availability";
import {
  NOT_ARCHIVED_APPOINTMENT_WHERE,
  NOT_ARCHIVED_BOOKING_WHERE,
  NOT_ARCHIVED_DOCTOR_WHERE,
  isBookingArchivable,
  upcomingDoctorAppointmentsWhere,
} from "./lib/archive-filters";
import {
  AppointmentDeletionCheckSchema,
  AppointmentIdParamSchema,
  ArchiveBookingRequestSchema,
  BookingIdParamSchema,
  CreateDoctorRequestSchema,
  CreateSpecialtyRequestSchema,
  DeleteAppointmentRequestSchema,
  DoctorDeletionCheckSchema,
  DoctorIdParamSchema,
  ListAdminAppointmentsQuerySchema,
  ListAdminBookingsQuerySchema,
  ListAdminDoctorsQuerySchema,
  MarkBookingPaidRequestSchema,
  RescheduleAppointmentRequestSchema,
  SetDoctorAvailabilityRequestSchema,
  SpecialtyIdParamSchema,
  UpdateDoctorRequestSchema,
  UpdateSpecialtyRequestSchema,
} from "./telehealth.schemas";

const WITH_DOCTOR_RELATIONS = {
  specialty: true,
  avatarMedia: true,
  availability: true,
  additionalSpecialties: { include: { specialty: true } },
} as const;
// Paket P — admin listesinde hastanın saati de gösterilir (booking'deki `patientTimeZone`).
const WITH_APPOINTMENT_RELATIONS = {
  doctor: { select: { id: true, title: true, fullName: true, slug: true } },
  booking: { select: { patientTimeZone: true } },
} as const;
const WITH_BOOKING_RELATIONS = {
  doctor: { select: { id: true, title: true, fullName: true, slug: true, userId: true } },
  // `startsAt asc` — `telehealth.routes.ts::WITH_BOOKING_RELATIONS` İLE AYNI disiplin (ilişki
  // sırası Prisma/Postgres tarafından GARANTİLİ DEĞİLDİR, `appointments[0]`'a dayanan mantık
  // deterministik sıra GEREKTİRİR).
  appointments: { orderBy: { startsAt: "asc" } },
  intake: { select: { id: true } },
  documents: { where: { deletedAt: null }, select: { id: true } },
} as const;

/**
 * [TCT] §9.7.7 KARAR K8 (GÜVENLİK DÜZELTMESİ, bağlayıcı) — bir `DoctorProfile`'ı bir `User.id`'ye
 * bağlamak/çözmek (ayrıcalık yükseltme yüzeyi: bir MANAGER, herhangi bir kullanıcı hesabını
 * -bir ADMIN'inki dahil- doktor portalı üzerinden hasta PII'sine erişim kazandıracak şekilde
 * bağlayabilirdi) YALNIZCA `SiteRole=ADMIN` tarafından yapılabilir. İstek gövdesinde `userId`
 * anahtarı YOKSA (bağlantıya dokunulmuyor) bu kontrol DEVREYE GİRMEZ.
 */
function assertUserLinkChangeAllowed(request: { user?: { role: string } | null; body: Record<string, unknown> }) {
  if (!("userId" in request.body)) return;
  if (request.user?.role !== "ADMIN") {
    throw new ForbiddenError("Doktor profilini bir kullanıcı hesabına bağlama/çözme yetkisi yalnızca ADMIN'dedir.");
  }
}

/**
 * [DPI] §1.1 — `practiceStartYear` üst sınırı (içinde bulunulan yıl) sabit `.max()` İLE
 * DEĞİL, dinamik olarak burada zorlanır (aksi hâlde her 1 Ocak'ta sessizce eskiyen bir sabit
 * gerekirdi — saklanan bir "deneyim yılı" değil, bir "başlangıç yılı ÜST SINIRI" olduğu için).
 */
function assertPracticeStartYearNotFuture(practiceStartYear: number | null | undefined) {
  if (practiceStartYear == null) return;
  const currentYear = new Date().getUTCFullYear();
  if (practiceStartYear > currentYear) {
    throw new ValidationError("Geçersiz mesleğe başlama yılı.", { practiceStartYear: ["Gelecekte bir yıl olamaz."] });
  }
}

/**
 * Paket P (İş 3) — aynı anda yalnızca BİR kurucu doktor olabilir. Başka bir doktor zaten kurucuysa
 * `409` (sessizce devralma yok: admin önce eskisinin işaretini kaldırır). `exceptId` güncellenen doktor.
 */
/**
 * Yazma SONRASI ikinci savunma (inceleme bulgusu — check-then-write yarışı): eşzamanlı iki istek
 * ön kontrolü birlikte geçerse, bu doktorun işareti geri alınır ve `409` döner. Üçüncü hat DB'dir:
 * kısmi benzersiz indeks `doctor_profiles_single_founder_key` → `rethrowFounderConflict`.
 */
async function enforceSingleFounderAfterWrite(app: FastifyInstance, doctorId: string): Promise<void> {
  const founders = await app.prisma.doctorProfile.count({ where: { isFounder: true } });
  if (founders <= 1) return;
  await app.prisma.doctorProfile.update({ where: { id: doctorId }, data: { isFounder: false } });
  throw new ConflictError("Aynı anda başka bir kurucu işaretlendi; işlem geri alındı. Önce mevcut kurucunun işaretini kaldırın.");
}

const FOUNDER_INDEX_NAME = "doctor_profiles_single_founder_key";
const FOUNDER_RACE_MESSAGE = "Aynı anda başka bir kurucu işaretlendi; işlem kaydedilmedi. Önce mevcut kurucunun işaretini kaldırın.";

/** Kısmi benzersiz indeks ihlalini (P2002) genel "Bu kayıt zaten mevcut." yerine anlaşılır `409`'a çevirir. */
export function rethrowFounderConflict(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = err.meta?.target;
    const targets = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
    if (targets.some((t) => t === "isFounder" || t.includes(FOUNDER_INDEX_NAME))) throw new ConflictError(FOUNDER_RACE_MESSAGE);
  }
  throw err;
}

async function assertNoOtherFounder(app: FastifyInstance, exceptId: string | null): Promise<void> {
  const other = await app.prisma.doctorProfile.findFirst({
    where: { isFounder: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { title: true, fullName: true },
  });
  if (other) {
    throw new ConflictError(`Zaten bir kurucu doktor var (${other.title} ${other.fullName}). Önce onun kurucu işaretini kaldırın.`);
  }
}

/** [DPI] §1.1/§1.2 — `aboutHtml` `lib/html-sanitize.ts`'ten geçer; temizlik SONRASI boşsa `null`. */
function sanitizeAboutHtml(aboutHtml: string | null | undefined): string | null | undefined {
  if (aboutHtml === undefined) return undefined;
  if (aboutHtml === null) return null;
  const sanitized = sanitizeRichHtml(aboutHtml);
  return sanitized.length > 0 ? sanitized : null;
}

async function assertImageMedia(app: FastifyInstance, mediaId: string) {
  const media = await app.prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) throw new NotFoundError("Medya bulunamadı.");
  if (!isImageMimeType(media.mimeType)) {
    throw new ConflictError("Bu alan yalnızca görsel medya kabul eder.");
  }
}

/** Uzmanlık kartı görseli için izin verilen türler — GIF/PDF/SVG KABUL EDİLMEZ. */
const SPECIALTY_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

async function assertSpecialtyImageMedia(app: FastifyInstance, mediaId: string) {
  const media = await app.prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) throw new NotFoundError("Medya bulunamadı.");
  if (!SPECIALTY_IMAGE_MIME_TYPES.has(media.mimeType)) {
    throw new ValidationError("Uzmanlık görseli yalnızca PNG, JPG veya WebP olabilir.", {
      imageMediaId: ["Uzmanlık görseli yalnızca PNG, JPG veya WebP olabilir."],
    });
  }
}

const WITH_SPECIALTY_IMAGE = { imageMedia: true } as const;

/** `/admin/telehealth/specialties` prefix'i altında bağlanır — okuma panel kapısı, yazma ADMIN+MANAGER (§8.4). */
export async function adminTelehealthSpecialtiesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  // Uzmanlık adı/görseli doktor sayfalarında, doktor sayısı uzmanlık sayfalarında görünür — ikisi birlikte yenilenir.
  revalidateTagsOnWrite(app, () => [CACHE_TAGS.specialties, CACHE_TAGS.doctors]);
  // §8.6/DoD (bağlayıcı, security-agent düzeltmesi) — modül kapalıyken TÜM public/admin
  // tele-sağlık uçları 404 döner; `authenticate`'DEN ÖNCE kontrol edilir (auth denemesi bile
  // kapalı bir modülün admin yüzeyinin VARLIĞINI sızdırmasın — public route'larla AYNI sıra).
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  server.get(
    "/",
    { schema: { response: { 200: ApiSuccessSchema(z.array(SpecialtySchema)) } } },
    async (_request, reply) => {
      const rows = await app.prisma.specialty.findMany({ orderBy: { order: "asc" }, include: WITH_SPECIALTY_IMAGE });
      return reply.send(ok(rows.map(toSpecialtyDto)));
    }
  );

  server.post(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { body: CreateSpecialtyRequestSchema, response: { 201: ApiSuccessSchema(SpecialtySchema) } },
    },
    async (request, reply) => {
      const { name, slug, icon, description, order, isActive, imageMediaId, translations } = request.body;
      if (imageMediaId) await assertSpecialtyImageMedia(app, imageMediaId);
      const specialty = await app.prisma.specialty.create({
        data: {
          name,
          slug: slug ? slugify(slug) : slugify(name),
          icon,
          description: description ?? null,
          order: order ?? 0,
          isActive: isActive ?? true,
          imageMediaId: imageMediaId ?? null,
          translations: translations ?? {},
        },
        include: WITH_SPECIALTY_IMAGE,
      });
      return reply.code(201).send(ok(toSpecialtyDto(specialty)));
    }
  );

  server.patch(
    "/:specialtyId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        params: SpecialtyIdParamSchema,
        body: UpdateSpecialtyRequestSchema,
        response: { 200: ApiSuccessSchema(SpecialtySchema) },
      },
    },
    async (request, reply) => {
      const { slug, description, imageMediaId, ...rest } = request.body;
      if (imageMediaId) await assertSpecialtyImageMedia(app, imageMediaId);
      const specialty = await app.prisma.specialty
        .update({
          where: { id: request.params.specialtyId },
          data: {
            ...rest,
            ...(slug !== undefined ? { slug: slugify(slug) } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(imageMediaId !== undefined ? { imageMediaId } : {}),
          },
          include: WITH_SPECIALTY_IMAGE,
        })
        .catch(() => {
          throw new NotFoundError("Uzmanlık bulunamadı.");
        });
      return reply.send(ok(toSpecialtyDto(specialty)));
    }
  );

  // Uzmanlık silindiğinde bağlı doktorların `specialtyId`'si `SetNull` ile boşa düşer (bkz.
  // prisma/schema.prisma::DoctorProfile.specialty onDelete) — ürün/kategori ile AYNI risk kabulü,
  // ayrı bir "kullanımda" 409 koruması BİLİNÇLİ olarak eklenmez (v1, backlog ile aynı disiplin).
  server.delete(
    "/:specialtyId",
    { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER), schema: { params: SpecialtyIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      await app.prisma.specialty.delete({ where: { id: request.params.specialtyId } }).catch(() => {
        throw new NotFoundError("Uzmanlık bulunamadı.");
      });
      return reply.code(204).send();
    }
  );
}

/** `/admin/telehealth/doctors` prefix'i altında bağlanır — okuma panel kapısı, yazma ADMIN+MANAGER (§8.4). */
export async function adminTelehealthDoctorsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  // Uzmanlık adı/görseli doktor sayfalarında, doktor sayısı uzmanlık sayfalarında görünür — ikisi birlikte yenilenir.
  revalidateTagsOnWrite(app, () => [CACHE_TAGS.specialties, CACHE_TAGS.doctors]);
  // §8.6/DoD (bağlayıcı, security-agent düzeltmesi) — bkz. adminTelehealthSpecialtiesRoutes yorumu.
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  server.get(
    "/",
    {
      schema: {
        querystring: ListAdminDoctorsQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(DoctorProfileSchema), z.object({ nextCursor: z.string().nullable() })) },
      },
    },
    async (request, reply) => {
      const { specialtyId, search, includeArchived, cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.doctorProfile.findMany({
        where: {
          ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
          ...(includeArchived ? {} : NOT_ARCHIVED_DOCTOR_WHERE),
          ...(specialtyId ? { specialtyId } : {}),
          ...(search
            ? {
                OR: [
                  { fullName: { contains: search, mode: "insensitive" } },
                  { slug: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { seq: "asc" },
        take: limit,
        include: WITH_DOCTOR_RELATIONS,
      });

      return reply.send(ok(rows.map(toDoctorProfileDto), buildPageMeta(rows, limit)));
    }
  );

  server.post(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { body: CreateDoctorRequestSchema, response: { 201: ApiSuccessSchema(DoctorProfileSchema) } },
    },
    async (request, reply) => {
      const body = request.body;
      assertUserLinkChangeAllowed(request);
      if (body.avatarMediaId) await assertImageMedia(app, body.avatarMediaId);
      assertPracticeStartYearNotFuture(body.practiceStartYear);
      if (body.isFounder === true) await assertNoOtherFounder(app, null);

      const doctor = await app.prisma.doctorProfile.create({
        data: {
          title: body.title,
          subSpecialty: body.subSpecialty ?? null,
          fullName: body.fullName,
          slug: body.slug ? slugify(body.slug) : slugify(body.fullName),
          bio: body.bio,
          aboutHtml: sanitizeAboutHtml(body.aboutHtml) ?? null,
          practiceStartYear: body.practiceStartYear ?? null,
          cvEntries: ((await resolveCvEntryMedia(app.prisma, body.cvEntries)) ?? []) as Prisma.InputJsonValue,
          publications: (body.publications ?? []) as Prisma.InputJsonValue,
          socialLinks: (body.socialLinks ?? []) as Prisma.InputJsonValue,
          languages: body.languages,
          timeZone: body.timeZone,
          specialtyId: body.specialtyId ?? null,
          sessionDurationMin: body.sessionDurationMin,
          sessionPriceCents: body.sessionPriceCents,
          currency: body.currency ?? "TRY",
          avatarMediaId: body.avatarMediaId ?? null,
          // §7.2 şablon disiplini yalnızca demo-templates içe aktarıcısını bağlar — bu GERÇEK
          // admin CRUD'udur; `isVerified` sunulmazsa güvenli varsayılan (false) korunur.
          isVerified: body.isVerified ?? false,
          isActive: body.isActive ?? true,
          order: body.order ?? 0,
          isFounder: body.isFounder ?? false,
          rosterTier: body.rosterTier ?? null,
          userId: body.userId ?? null,
        },
      }).catch(rethrowFounderConflict);
      if (body.isFounder === true) await enforceSingleFounderAfterWrite(app, doctor.id);

      // Birincil (`specialtyId`) DIŞINDAKİ EK uzmanlıklar — `additionalSpecialtyIds`
      // gönderilmezse (`undefined`) hiç yazılmaz (yeni doktorda zaten boş). `skipDuplicates`
      // hem DB'deki (burada yok) hem AYNI dizi içindeki olası tekrarları sessizce atlar.
      if (body.additionalSpecialtyIds !== undefined && body.additionalSpecialtyIds.length > 0) {
        await app.prisma.doctorAdditionalSpecialty.createMany({
          data: body.additionalSpecialtyIds.map((specialtyId) => ({ doctorId: doctor.id, specialtyId })),
          skipDuplicates: true,
        });
      }

      const doctorWithRelations = await app.prisma.doctorProfile.findUniqueOrThrow({
        where: { id: doctor.id },
        include: WITH_DOCTOR_RELATIONS,
      });

      // 2026-10-18 (Paket A4) — admin doktor kaydı denetimi; yalnızca alan ADLARI yazılır (içerik değil).
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.doctor.created",
        targetType: "DoctorProfile",
        targetId: doctor.id,
        metadata: { fields: Object.keys(body).sort() },
        ipAddress: request.ip,
      });

      // K8 — bağlama denetimi (yeni profil, `previousUserId` her zaman `null`).
      if ("userId" in body) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "telehealth.doctor.user_link",
          targetType: "DoctorProfile",
          targetId: doctor.id,
          metadata: { userId: body.userId ?? null, previousUserId: null },
          ipAddress: request.ip,
        });
      }

      return reply.code(201).send(ok(toDoctorProfileDto(doctorWithRelations)));
    }
  );

  server.get(
    "/:doctorId",
    { schema: { params: DoctorIdParamSchema, response: { 200: ApiSuccessSchema(DoctorProfileSchema) } } },
    async (request, reply) => {
      const doctor = await app.prisma.doctorProfile.findUnique({
        where: { id: request.params.doctorId },
        include: WITH_DOCTOR_RELATIONS,
      });
      if (!doctor) throw new NotFoundError("Doktor bulunamadı.");
      return reply.send(ok(toDoctorProfileDto(doctor)));
    }
  );

  server.patch(
    "/:doctorId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        params: DoctorIdParamSchema,
        body: UpdateDoctorRequestSchema,
        response: { 200: ApiSuccessSchema(DoctorProfileSchema) },
      },
    },
    async (request, reply) => {
      assertUserLinkChangeAllowed(request);

      const existing = await app.prisma.doctorProfile.findUnique({ where: { id: request.params.doctorId } });
      if (!existing) throw new NotFoundError("Doktor bulunamadı.");
      // Paket B2 — arşivli doktor önce arşivden çıkarılmadan aktifleştirilemez.
      if (existing.archivedAt && request.body.isActive === true) {
        throw new ConflictError("Arşivlenmiş bir doktor aktifleştirilemez; önce arşivden çıkarın.");
      }

      const {
        slug,
        avatarMediaId,
        aboutHtml,
        cvEntries,
        publications,
        socialLinks,
        practiceStartYear,
        additionalSpecialtyIds,
        ...rest
      } = request.body;
      if (avatarMediaId) await assertImageMedia(app, avatarMediaId);
      assertPracticeStartYearNotFuture(practiceStartYear);
      if (rest.isFounder === true) await assertNoOtherFounder(app, existing.id);

      await app.prisma.doctorProfile.update({
        where: { id: request.params.doctorId },
        data: {
          ...rest,
          ...(slug !== undefined ? { slug: slugify(slug) } : {}),
          ...(avatarMediaId !== undefined ? { avatarMediaId } : {}),
          ...(aboutHtml !== undefined ? { aboutHtml: sanitizeAboutHtml(aboutHtml) } : {}),
          ...(practiceStartYear !== undefined ? { practiceStartYear } : {}),
          ...(cvEntries !== undefined ? { cvEntries: (await resolveCvEntryMedia(app.prisma, cvEntries)) as Prisma.InputJsonValue } : {}),
          ...(publications !== undefined ? { publications: publications as Prisma.InputJsonValue } : {}),
          ...(socialLinks !== undefined ? { socialLinks: socialLinks as Prisma.InputJsonValue } : {}),
        },
      }).catch(rethrowFounderConflict);
      if (rest.isFounder === true) await enforceSingleFounderAfterWrite(app, request.params.doctorId);

      // Birincil (`specialtyId`) DIŞINDAKİ EK uzmanlıklar — `additionalSpecialtyIds`
      // gövdede YOKSA (`undefined`) mevcut ilişkilere DOKUNULMAZ. Gönderildiyse dizinin
      // TAMAMI hedef durumu temsil eder: önce mevcut tüm satırlar silinir, SONRA yeni liste
      // yazılır (`cvEntries`/`socialLinks` İLE AYNI "tam değiştirme" sözleşmesi).
      if (additionalSpecialtyIds !== undefined) {
        await app.prisma.$transaction([
          app.prisma.doctorAdditionalSpecialty.deleteMany({ where: { doctorId: request.params.doctorId } }),
          ...(additionalSpecialtyIds.length > 0
            ? [
                app.prisma.doctorAdditionalSpecialty.createMany({
                  data: additionalSpecialtyIds.map((specialtyId) => ({ doctorId: request.params.doctorId, specialtyId })),
                  skipDuplicates: true,
                }),
              ]
            : []),
        ]);
      }

      const doctor = await app.prisma.doctorProfile.findUniqueOrThrow({
        where: { id: request.params.doctorId },
        include: WITH_DOCTOR_RELATIONS,
      });

      // 2026-10-18 (Paket A4) — admin güncellemesi denetimi; yalnızca değişen alan ADLARI yazılır
      // (CV/biyografi içeriği audit'e kopyalanmaz).
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.doctor.updated",
        targetType: "DoctorProfile",
        targetId: doctor.id,
        metadata: { fields: Object.keys(request.body).sort() },
        ipAddress: request.ip,
      });

      // K8 — bağlama/çözme denetimi.
      if ("userId" in request.body) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "telehealth.doctor.user_link",
          targetType: "DoctorProfile",
          targetId: doctor.id,
          metadata: { userId: request.body.userId ?? null, previousUserId: existing.userId },
          ipAddress: request.ip,
        });
      }

      return reply.send(ok(toDoctorProfileDto(doctor)));
    }
  );

  /**
   * 2026-10-18 (Paket B2) — "Sil" penceresinin ön kontrolü: randevu/booking geçmişi varsa arayüz
   * kalıcı silme yerine "Arşivle" sunar. Karar `DELETE` içinde yeniden verilir (P2003 → 409).
   */
  server.get(
    "/:doctorId/deletion-check",
    { schema: { params: DoctorIdParamSchema, response: { 200: ApiSuccessSchema(DoctorDeletionCheckSchema) } } },
    async (request, reply) => {
      const doctor = await app.prisma.doctorProfile.findUnique({ where: { id: request.params.doctorId }, select: { id: true } });
      if (!doctor) throw new NotFoundError("Doktor bulunamadı.");
      const [appointmentCount, bookingCount, upcomingAppointmentCount] = await Promise.all([
        app.prisma.appointment.count({ where: { doctorId: doctor.id } }),
        app.prisma.appointmentBooking.count({ where: { doctorId: doctor.id } }),
        app.prisma.appointment.count({ where: upcomingDoctorAppointmentsWhere(doctor.id, new Date()) }),
      ]);
      return reply.send(
        ok({ deletable: appointmentCount === 0 && bookingCount === 0, appointmentCount, bookingCount, upcomingAppointmentCount })
      );
    }
  );

  // §3.7/§9 — kalıcı silme. `Appointment.doctor` ve `AppointmentBooking.doctor` `onDelete: Restrict`
  // olduğu için geçmişi olan doktorda Prisma `P2003` fırlatır → `409 DOCTOR_HAS_HISTORY` (arayüz
  // bu kodda "Arşivle" teklif eder).
  server.delete(
    "/:doctorId",
    { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER), schema: { params: DoctorIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      await app.prisma.doctorProfile.delete({ where: { id: request.params.doctorId } }).catch((err) => {
        if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2025") {
          throw new NotFoundError("Doktor bulunamadı.");
        }
        if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2003") {
          throw new DoctorHasHistoryError();
        }
        throw err;
      });
      return reply.code(204).send();
    }
  );

  /**
   * 2026-10-18 (Paket B2) — arşivleme: `archivedAt=now` + `isActive=false` (kırmızı çizgideki
   * `lib/booking.ts` `isActive: true` kontrolüyle yeni booking'i dokunmadan engeller). `id`/`slug`/
   * `userId` DEĞİŞMEZ; bağlı kullanıcı hesabına dokunulmaz (geçmiş kayıtlara portal erişimi sürer,
   * gerekirse admin kullanıcıyı ayrıca askıya alır). Gelecekte aktif randevusu varsa 409.
   */
  server.post(
    "/:doctorId/archive",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: DoctorIdParamSchema, response: { 200: ApiSuccessSchema(DoctorProfileSchema) } },
    },
    async (request, reply) => {
      const now = new Date();
      const doctor = await runSerializable(app, async (tx) => {
        const existing = await tx.doctorProfile.findUnique({ where: { id: request.params.doctorId } });
        if (!existing) throw new NotFoundError("Doktor bulunamadı.");
        if (existing.archivedAt) throw new ConflictError("Bu doktor zaten arşivlenmiş.");
        const upcoming = await tx.appointment.count({ where: upcomingDoctorAppointmentsWhere(existing.id, now) });
        if (upcoming > 0) throw new DoctorHasUpcomingAppointmentsError();
        return tx.doctorProfile.update({
          where: { id: existing.id },
          data: { archivedAt: now, isActive: false },
          include: WITH_DOCTOR_RELATIONS,
        });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.doctor.archived",
        targetType: "DoctorProfile",
        targetId: doctor.id,
        metadata: { slug: doctor.slug },
        ipAddress: request.ip,
      });

      return reply.send(ok(toDoctorProfileDto(doctor)));
    }
  );

  /** Arşivden çıkarma yalnızca `archivedAt=null` yapar; `isActive` false kalır, admin elle açar. */
  server.post(
    "/:doctorId/unarchive",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: DoctorIdParamSchema, response: { 200: ApiSuccessSchema(DoctorProfileSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.doctorProfile.findUnique({ where: { id: request.params.doctorId } });
      if (!existing) throw new NotFoundError("Doktor bulunamadı.");
      if (!existing.archivedAt) throw new ConflictError("Bu doktor arşivde değil.");
      const doctor = await app.prisma.doctorProfile.update({
        where: { id: existing.id },
        data: { archivedAt: null },
        include: WITH_DOCTOR_RELATIONS,
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.doctor.unarchived",
        targetType: "DoctorProfile",
        targetId: doctor.id,
        metadata: { slug: doctor.slug },
        ipAddress: request.ip,
      });

      return reply.send(ok(toDoctorProfileDto(doctor)));
    }
  );

  server.get(
    "/:doctorId/availability",
    { schema: { params: DoctorIdParamSchema, response: { 200: ApiSuccessSchema(z.array(DoctorAvailabilityRuleSchema)) } } },
    async (request, reply) => {
      const doctor = await app.prisma.doctorProfile.findUnique({ where: { id: request.params.doctorId } });
      if (!doctor) throw new NotFoundError("Doktor bulunamadı.");

      const rules = await app.prisma.doctorAvailability.findMany({
        where: { doctorId: doctor.id },
        orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
      });
      return reply.send(ok(rules.map((rule) => ({ id: rule.id, dayOfWeek: rule.dayOfWeek, startMinute: rule.startMinute, endMinute: rule.endMinute, isActive: rule.isActive }))));
    }
  );

  // Haftalık ızgaranın TAMAMINI değiştirir (bkz. telehealth.schemas.ts::SetDoctorAvailabilityRequestSchema
  // yorumu) — eski kurallar SİLİNİR, yenileri tek transaction'da yazılır.
  server.put(
    "/:doctorId/availability",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        params: DoctorIdParamSchema,
        body: SetDoctorAvailabilityRequestSchema,
        response: { 200: ApiSuccessSchema(z.array(DoctorAvailabilityRuleSchema)) },
      },
    },
    async (request, reply) => {
      const doctor = await app.prisma.doctorProfile.findUnique({ where: { id: request.params.doctorId } });
      if (!doctor) throw new NotFoundError("Doktor bulunamadı.");

      const rules = await app.prisma.$transaction((tx) => replaceWeeklyAvailability(tx, doctor.id, request.body.rules));
      // Paket Q — doktor kartlarındaki "en erken randevu" önbelleği haftalık saat değişince de yenilenir.
      invalidateEarliestAvailability(doctor.id);

      return reply.send(
        ok(rules.map((rule) => ({ id: rule.id, dayOfWeek: rule.dayOfWeek, startMinute: rule.startMinute, endMinute: rule.endMinute, isActive: rule.isActive })))
      );
    }
  );
}

/**
 * `/admin/telehealth/appointments` prefix'i altında bağlanır — SALT-OKUNUR, hasta PII'si
 * içerdiği için `requirePanelAccess()` (ADMIN|MANAGER|EDITOR) DEĞİL, doğrudan
 * `requireSiteRole(...ROLES_ADMIN_MANAGER)` (§8.4 bağlayıcı — EDITOR DIŞLANIR).
 */
export async function adminTelehealthAppointmentsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  // §8.6/DoD (bağlayıcı, security-agent düzeltmesi) — bkz. adminTelehealthSpecialtiesRoutes yorumu.
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN_MANAGER));

  server.get(
    "/",
    {
      schema: {
        querystring: ListAdminAppointmentsQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(AppointmentSchema), z.object({ nextCursor: z.string().nullable() })) },
      },
    },
    async (request, reply) => {
      const { doctorId, status, search, includeArchived, cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.appointment.findMany({
        where: {
          ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
          // Paket B4 — test olarak arşivlenmiş booking'lerin randevuları varsayılan listede görünmez.
          ...(includeArchived ? {} : NOT_ARCHIVED_APPOINTMENT_WHERE),
          ...(doctorId ? { doctorId } : {}),
          ...(status ? { status } : {}),
          ...(search
            ? {
                OR: [
                  { patientName: { contains: search, mode: "insensitive" } },
                  { patientEmail: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { seq: "asc" },
        take: limit,
        include: WITH_APPOINTMENT_RELATIONS,
      });

      return reply.send(ok(rows.map(toAppointmentDto), buildPageMeta(rows, limit)));
    }
  );

  /**
   * NOT — 2026-09-15 (backend-agent görev notu, "Admin randevu yeniden planlama") —
   * `PATCH /admin/telehealth/appointments/{id}/reschedule`. `id` bir **Appointment ID'sidir**
   * (booking ID DEĞİL) — bu uç YALNIZCA belirtilen TEK appointment satırını yeniden planlar,
   * booking'in DİĞER appointment'larına (çoklu-slot rezervasyonlarda) DOKUNMAZ (bilinçli/dar
   * kapsam, bkz. `telehealth.schemas.ts::RescheduleAppointmentRequestSchema` yorumu — backlog:
   * "booking-geneli reschedule"). Grup hook'u `ROLES_ADMIN_MANAGER`dir (§8.4) — bu route KENDİ
   * `requireSiteRole(...ROLES_ADMIN)` preHandler'ıyla MANAGER'ı EK OLARAK dışlar (para/randevu
   * hareketi beyanı, `mark-paid` İLE AYNI eşik disiplini).
   */
  server.patch(
    "/:id/reschedule",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: {
        params: AppointmentIdParamSchema,
        body: RescheduleAppointmentRequestSchema,
        response: { 200: ApiSuccessSchema(AppointmentSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.appointment.findUnique({
        where: { id: request.params.id },
        include: { doctor: { select: { id: true, timeZone: true, fullName: true, userId: true } } },
      });
      if (!existing) throw new NotFoundError("Randevu bulunamadı.");

      const [year, month, day] = request.body.newDate.split("-").map(Number) as [number, number, number];
      const [hour, minute] = request.body.newStartTime.split(":").map(Number) as [number, number];
      const newStartsAt = wallTimeToUtc({ year, month, day, hour, minute }, existing.doctor.timeZone);
      if (!newStartsAt) {
        throw new ValidationError(
          "Belirtilen tarih/saat, doktorun saat diliminde geçerli bir an değil (DST geçişi nedeniyle bu duvar saati mevcut değil).",
          { newStartTime: ["Bu saat mevcut değil, farklı bir saat seçin."] }
        );
      }

      // Süre KORUNUR — yalnızca BAŞLANGIÇ kayar (görev talimatı, bağlayıcı).
      const durationMs = existing.endsAt.getTime() - existing.startsAt.getTime();
      const newEndsAt = new Date(newStartsAt.getTime() + durationMs);
      const oldStartsAt = existing.startsAt;
      const oldEndsAt = existing.endsAt;

      const updated = await runSerializable(app, async (tx) => {
        // Aynı doktorun AYNI yeni zaman aralığıyla ÇAKIŞAN başka bir AKTİF randevusu olmamalı
        // (kendisi HARİÇ). `lib/booking.ts::createBooking`teki `@@unique([doctorId, startsAt])`
        // ikinci savunma hattı burada GEÇERLİ DEĞİLDİR (yalnızca TAM aynı başlangıç anını
        // yakalar, kısmi örtüşmeyi DEĞİL) — bu yüzden açık bir aralık-örtüşme sorgusu gerekir.
        const conflict = await tx.appointment.findFirst({
          where: {
            doctorId: existing.doctorId,
            id: { not: existing.id },
            status: { in: ["SCHEDULED", "IN_PROGRESS"] },
            startsAt: { lt: newEndsAt },
            endsAt: { gt: newStartsAt },
          },
        });
        if (conflict) throw new AppointmentRescheduleConflictError();

        // Paket P ek (1) — yeni aralık doktorun izin/istisna aralığına düşüyorsa AYNI 409 ailesiyle red.
        const timeOff = await tx.doctorTimeOff.findFirst({
          where: { doctorId: existing.doctorId, startsAt: { lt: newEndsAt }, endsAt: { gt: newStartsAt } },
          select: { id: true },
        });
        if (timeOff) throw new AppointmentRescheduleConflictError("Doktor bu zaman aralığında izinli/müsait değil; başka bir saat seçin.");

        // [ASD] §2.6 (bağlayıcı) — hatırlatma süpürücüsü damgaları AYNI transaction'da null'lanır;
        // aksi hâlde saati ileri alınan bir randevu bir daha ASLA hatırlatma e-postası almaz
        // (bkz. lib/appointment-reminders.ts).
        return tx.appointment.update({
          where: { id: existing.id },
          data: { startsAt: newStartsAt, endsAt: newEndsAt, reminded60mAt: null, reminded30mAt: null },
          include: WITH_APPOINTMENT_RELATIONS,
        });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.appointment.rescheduled",
        targetType: "Appointment",
        targetId: existing.id,
        metadata: {
          oldStartsAt: oldStartsAt.toISOString(),
          oldEndsAt: oldEndsAt.toISOString(),
          newStartsAt: newStartsAt.toISOString(),
          newEndsAt: newEndsAt.toISOString(),
          reason: request.body.reason ?? null,
        },
        ipAddress: request.ip,
      });

      // §9.7.8 desenİYLE AYNI — best-effort, e-posta gönderimi BAŞARISIZ olsa da bu uç ASLA
      // 500 dönmez (bkz. notifications.ts::triggerAppointmentRescheduledEmail).
      await triggerAppointmentRescheduledEmail(app, {
        appointment: existing,
        doctorTimeZone: existing.doctor.timeZone,
        doctorFullName: existing.doctor.fullName,
        doctorUserId: existing.doctor.userId,
        oldStartsAt,
        newStartsAt,
        oldEndsAt,
        newEndsAt,
        reason: request.body.reason ?? null,
      });

      return reply.send(ok(toAppointmentDto(updated)));
    }
  );

  /**
   * 2026-10-18 (Paket A1) — kalıcı silme uygunluğu. Arayüz "Sil" penceresinde engellerin
   * nedenini bu uçtan gösterir; kararın kendisi `DELETE` içinde YENİDEN verilir.
   */
  server.get(
    "/:id/deletion-check",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: { params: AppointmentIdParamSchema, response: { 200: ApiSuccessSchema(AppointmentDeletionCheckSchema) } },
    },
    async (request, reply) => {
      const appointment = await app.prisma.appointment.findUnique({
        where: { id: request.params.id },
        include: APPOINTMENT_DELETION_INCLUDE,
      });
      if (!appointment) throw new NotFoundError("Randevu bulunamadı.");
      const blockers = getAppointmentDeletionBlockers(toDeletionInput(appointment));
      return reply.send(ok({ deletable: blockers.length === 0, blockers }));
    }
  );

  /**
   * 2026-10-18 (Paket A1) — YALNIZCA ADMIN, iki adımlı onayın ikincisi gövdede (`confirm: true`).
   * Yalnızca ödeme/not/kayıt/sağlık verisi OLMAYAN iptal/tamamlanmış test randevuları silinir
   * (`lib/appointment-deletion.ts`). Booking'in son randevusuysa booking da silinir.
   */
  server.delete(
    "/:id",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: { params: AppointmentIdParamSchema, body: DeleteAppointmentRequestSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const result = await runSerializable(app, async (tx) => {
        const appointment = await tx.appointment.findUnique({
          where: { id: request.params.id },
          include: APPOINTMENT_DELETION_INCLUDE,
        });
        if (!appointment) throw new NotFoundError("Randevu bulunamadı.");

        const blockers = getAppointmentDeletionBlockers(toDeletionInput(appointment));
        if (blockers.length > 0) throw new AppointmentNotDeletableError(blockers.map((b) => b.code));

        await tx.appointment.delete({ where: { id: appointment.id } });
        const bookingDeleted = appointment.booking !== null && appointment.booking._count.appointments <= 1;
        if (bookingDeleted && appointment.booking) {
          await tx.appointmentBooking.delete({ where: { id: appointment.booking.id } });
        }
        return { appointment, bookingDeleted };
      });

      // Hasta adı/e-postası audit'e YAZILMAZ — silinen PII'nin kopyası kalmasın.
      const { appointment, bookingDeleted } = result;
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.appointment.deleted",
        targetType: "Appointment",
        targetId: appointment.id,
        metadata: {
          seq: appointment.seq,
          status: appointment.status,
          doctorId: appointment.doctorId,
          startsAt: appointment.startsAt.toISOString(),
          bookingId: appointment.booking?.id ?? null,
          bookingNumber: appointment.booking?.bookingNumber ?? null,
          bookingDeleted,
        },
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );
}

/**
 * `/admin/telehealth/bookings` prefix'i altında bağlanır — §9.7.10: `GET /` ADMIN+MANAGER
 * (EDITOR dışlanır, `/admin/telehealth/appointments` İLE AYNI eşik — hasta PII'si), `POST
 * .../mark-paid` YALNIZCA ADMIN (§9.7.1 madde 7 — para hareketi beyanı, MANAGER'a VERİLMEZ).
 */
export async function adminTelehealthBookingsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        querystring: ListAdminBookingsQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(AppointmentBookingSchema), z.object({ nextCursor: z.string().nullable() })) },
      },
    },
    async (request, reply) => {
      const { doctorId, paymentStatus, search, includeArchived, cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.appointmentBooking.findMany({
        where: {
          ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
          ...(includeArchived ? {} : NOT_ARCHIVED_BOOKING_WHERE),
          ...(doctorId ? { doctorId } : {}),
          ...(paymentStatus ? { paymentStatus } : {}),
          ...(search
            ? {
                OR: [
                  { patientName: { contains: search, mode: "insensitive" } },
                  { patientEmail: { contains: search, mode: "insensitive" } },
                  { bookingNumber: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { seq: "asc" },
        take: limit,
        include: WITH_BOOKING_RELATIONS,
      });

      // [DPI] §2.7 — `identity` yalnızca `canAccessBookingHealthData` eşiğini geçen aktörler
      // için doldurulur: `ADMIN` ✓, `MANAGER` ✗ (booking'in kendisi görünür, kimliği GÖREMEZ).
      return reply.send(
        ok(
          rows.map((row) => toAppointmentBookingDto(row, canAccessBookingHealthData(row, { user: request.user }))),
          buildPageMeta(rows, limit)
        )
      );
    }
  );

  server.post(
    "/:bookingId/mark-paid",
    {
      // §9.7.1 madde 7 (bağlayıcı) — YALNIZCA ADMIN, `ROLES_ADMIN_MANAGER` DEĞİL.
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: {
        params: BookingIdParamSchema,
        body: MarkBookingPaidRequestSchema,
        response: { 200: ApiSuccessSchema(AppointmentBookingSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.appointmentBooking.findUnique({ where: { id: request.params.bookingId } });
      if (!existing) throw new NotFoundError("Rezervasyon bulunamadı.");
      if (existing.paymentStatus !== "PENDING") {
        throw new ConflictError("Bu rezervasyon zaten ödenmiş/iptal edilmiş/süresi dolmuş.");
      }

      const { booking, appointments, rawAccessToken } = await confirmBookingPayment(app, {
        bookingId: existing.id,
        paidBy: "manual",
        paidNote: request.body.reason,
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.booking.marked_paid",
        targetType: "AppointmentBooking",
        targetId: booking.id,
        metadata: { reason: request.body.reason },
        ipAddress: request.ip,
      });

      // §9.7.8 — mevcut `ORDER_CONFIRMATION` deseniyle AYNI: best-effort, e-posta gönderimi
      // BAŞARISIZ olsa da bu uç ASLA 500 dönmez (bkz. notifications.ts::triggerAppointmentConfirmationEmail).
      await triggerAppointmentConfirmationEmail(app, { booking, appointments, rawAccessToken });

      // `.claude/architect-scope-guest-account-otp.md` §5.1 (bağlayıcı) — best-effort, ödeme
      // onayını (yukarıdaki `mark-paid`) ASLA bozmaz.
      await provisionPatientAccountForBooking(app, booking);

      const withRelations = await app.prisma.appointmentBooking.findUniqueOrThrow({
        where: { id: booking.id },
        include: WITH_BOOKING_RELATIONS,
      });
      // Bu uç yalnızca `ROLES_ADMIN` içindir (mark-paid preHandler) — `canAccessBookingHealthData`
      // ADMIN için her zaman `true` döner, ama tek kaynak disiplini için yine de çağrılır.
      return reply.send(ok(toAppointmentBookingDto(withRelations, canAccessBookingHealthData(withRelations, { user: request.user }))));
    }
  );


  /**
   * 2026-10-18 (Paket B4) — "Test olarak arşivle". YALNIZCA ADMIN, gerekçe zorunlu, audit'li.
   * Hiçbir şey SİLİNMEZ; ödeme/fatura/kayıt alanlarına dokunulmaz — yalnızca `archivedAt` +
   * `archivedReason` yazılır. Açık/gelecek randevusu olan booking arşivlenemez (409).
   */
  server.post(
    "/:bookingId/archive",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: {
        params: BookingIdParamSchema,
        body: ArchiveBookingRequestSchema,
        response: { 200: ApiSuccessSchema(AppointmentBookingSchema) },
      },
    },
    async (request, reply) => {
      const now = new Date();
      const booking = await runSerializable(app, async (tx) => {
        const existing = await tx.appointmentBooking.findUnique({
          where: { id: request.params.bookingId },
          include: { appointments: { select: { status: true, startsAt: true } } },
        });
        if (!existing) throw new NotFoundError("Rezervasyon bulunamadı.");
        if (existing.archivedAt) throw new ConflictError("Bu rezervasyon zaten arşivlenmiş.");
        if (!isBookingArchivable(existing.appointments, now)) throw new BookingNotArchivableError();
        return tx.appointmentBooking.update({
          where: { id: existing.id },
          data: { archivedAt: now, archivedReason: request.body.reason },
          include: WITH_BOOKING_RELATIONS,
        });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.booking.archived",
        targetType: "AppointmentBooking",
        targetId: booking.id,
        metadata: {
          bookingNumber: booking.bookingNumber,
          reason: request.body.reason,
          paymentStatus: booking.paymentStatus,
          totalCents: booking.totalCents,
          currency: booking.currency,
          source: "admin_panel",
        },
        ipAddress: request.ip,
      });

      return reply.send(ok(toAppointmentBookingDto(booking, canAccessBookingHealthData(booking, { user: request.user }))));
    }
  );

  server.post(
    "/:bookingId/unarchive",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: { params: BookingIdParamSchema, response: { 200: ApiSuccessSchema(AppointmentBookingSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.appointmentBooking.findUnique({ where: { id: request.params.bookingId } });
      if (!existing) throw new NotFoundError("Rezervasyon bulunamadı.");
      if (!existing.archivedAt) throw new ConflictError("Bu rezervasyon arşivde değil.");
      const booking = await app.prisma.appointmentBooking.update({
        where: { id: existing.id },
        data: { archivedAt: null, archivedReason: null },
        include: WITH_BOOKING_RELATIONS,
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.booking.unarchived",
        targetType: "AppointmentBooking",
        targetId: booking.id,
        metadata: { bookingNumber: booking.bookingNumber, previousReason: existing.archivedReason },
        ipAddress: request.ip,
      });

      return reply.send(ok(toAppointmentBookingDto(booking, canAccessBookingHealthData(booking, { user: request.user }))));
    }
  );
}

/**
 * `/admin/telehealth/settings` prefix'i altında bağlanır — randevu sihirbazının
 * (`/doctors/[slug]`, frontend) tema renkleri. Migration/yeni Prisma modeli YOK; `SiteModule`
 * satırının (`key="telehealth"`) genel amaçlı `settings Json` alanı KULLANILIR (bkz.
 * `lib/theme-settings.ts::parseTelehealthTheme`). `GET` → panel kapısı (`ROLES_PANEL`,
 * `specialties` GET İLE AYNI), `PATCH` → `ROLES_ADMIN_MANAGER` (`specialties` PATCH İLE AYNI).
 * DİKKAT: bu route `SiteModule.enabled`'a HİÇ DOKUNMAZ — modülün açık/kapalı durumu
 * `adminSiteModulesRoutes`'un işidir (`site-modules.routes.ts`), `enabled` `create` dalında
 * BİLİNÇLİ OLARAK belirtilmez (Prisma `@default(true)` devreye girer).
 */
export async function adminTelehealthSettingsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  server.get(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_PANEL),
      schema: { response: { 200: ApiSuccessSchema(TelehealthSettingsResponseSchema) } },
    },
    async (_request, reply) => {
      const row = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" } });
      return reply.send(ok(toTelehealthSettingsDto(row?.settings, await resolveDoctorHero(app.prisma, row?.settings))));
    }
  );

  server.patch(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        body: UpdateTelehealthThemeSettingsRequestSchema,
        response: { 200: ApiSuccessSchema(TelehealthSettingsResponseSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" } });
      const currentTheme = parseTelehealthTheme(existing?.settings);
      const themeMerged = { ...currentTheme, ...request.body };
      // HATA DÜZELTMESİ: önceden JSON yalnızca tema alanlarına indirgenip yazılıyordu — aynı JSON'daki
      // diğer alanlar (ör. `emergencyNotice`) her tema kaydında SESSİZCE siliniyordu. Artık ham
      // mevcut nesnenin üzerine birleştirilir.
      const merged = mergeTelehealthSettings(existing?.settings, themeMerged);

      const row = await app.prisma.siteModule.upsert({
        where: { key: "telehealth" },
        create: { key: "telehealth", settings: merged, updatedById: request.user!.id },
        update: { settings: merged, updatedById: request.user!.id },
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.settings.update",
        targetType: "SiteModule",
        targetId: "telehealth",
        metadata: themeMerged,
        ipAddress: request.ip,
      });

      // qa-agent bulgusu (2026-09-14) — tema rengi `/doctors/[slug]`'ın `revalidate: 60`
      // önbelleğine tabi (`fetchTelehealthThemeServer`); bu satır OLMADAN admin'deki bir renk
      // değişikliği ~60sn'ye kadar yansımıyordu (görev talimatının "ANINDA" beklentisiyle
      // ÇELİŞİYORDU). Yalnızca `telehealth-theme` etiketi yenilenir (tüm site DEĞİL).
      await triggerTagRevalidation(app, [CACHE_TAGS.telehealthTheme]);

      return reply.send(ok(toTelehealthSettingsDto(row.settings, await resolveDoctorHero(app.prisma, row.settings))));
    }
  );

  /**
   * Acil durum uyarısı — göster/gizle anahtarı (yalnızca header altındaki şerit; doktor detay kartı
   * her zaman görünür) ve dil başına özet/tam metin. Tema renklerinden (ADMIN+MANAGER) FARKLI olarak
   * YALNIZCA `ADMIN` değiştirebilir (uyumluluk metni). Her değişiklik eski/yeni değerlerle denetim
   * kaydına düşer (kim = actor, ne zaman = kayıt zamanı).
   */
  server.patch(
    "/emergency-notice",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: {
        body: UpdateEmergencyNoticeRequestSchema,
        response: { 200: ApiSuccessSchema(TelehealthSettingsResponseSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" } });
      const before = parseEmergencyNotice(existing?.settings);
      const after = applyEmergencyNoticeUpdate(before, request.body);
      const merged = mergeTelehealthSettings(existing?.settings, { emergencyNotice: after });

      const row = await app.prisma.siteModule.upsert({
        where: { key: "telehealth" },
        create: { key: "telehealth", settings: merged, updatedById: request.user!.id },
        update: { settings: merged, updatedById: request.user!.id },
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.emergency_notice.update",
        targetType: "SiteModule",
        targetId: "telehealth",
        metadata: {
          before,
          after,
          ...(before.enabled !== after.enabled ? { enabledChanged: { from: before.enabled, to: after.enabled } } : {}),
        },
        ipAddress: request.ip,
      });

      await triggerTagRevalidation(app, [CACHE_TAGS.telehealthTheme]);

      return reply.send(ok(toTelehealthSettingsDto(row.settings, await resolveDoctorHero(app.prisma, row.settings))));
    }
  );

  /**
   * Paket M (2026-10-23) — doktor profil başlığı arka plan görseli ve koyu katman opaklığı. Tema
   * renkleriyle aynı yetki (ADMIN/MANAGER). Görsel yalnızca medya kütüphanesinden (`imageMediaId`);
   * dış URL alanı yoktur. `imageMediaId: null` varsayılan görsele döner.
   */
  server.patch(
    "/doctor-hero",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        body: UpdateDoctorHeroRequestSchema,
        response: { 200: ApiSuccessSchema(TelehealthSettingsResponseSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" } });
      const before = parseDoctorHero(existing?.settings);
      const after = await applyDoctorHeroUpdate(app.prisma, existing?.settings, request.body);
      const merged = mergeTelehealthSettings(existing?.settings, { doctorHero: after });

      const row = await app.prisma.siteModule.upsert({
        where: { key: "telehealth" },
        create: { key: "telehealth", settings: merged, updatedById: request.user!.id },
        update: { settings: merged, updatedById: request.user!.id },
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.doctor_hero.update",
        targetType: "SiteModule",
        targetId: "telehealth",
        metadata: { before, after },
        ipAddress: request.ip,
      });

      await triggerTagRevalidation(app, [CACHE_TAGS.telehealthTheme]);

      return reply.send(ok(toTelehealthSettingsDto(row.settings, await resolveDoctorHero(app.prisma, row.settings))));
    }
  );
}
