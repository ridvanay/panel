import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middleware/authenticate";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta, CursorQuerySchema } from "../../schemas/common";
import {
  AppointmentBookingSchema,
  DoctorConsoleOverviewSchema,
  DoctorEarningsResponseSchema,
  DoctorPortalFeedSchema,
  DoctorPortalProfileSchema,
  type DoctorPortalNotification,
} from "../../schemas/entities";
import { toAppointmentBookingDto, toDoctorPortalProfileDto } from "../../mappers";
import { NotADoctorError, TwoFactorRequiredError, ValidationError } from "../../lib/errors";
import { buildPageMeta, parseCursor } from "../../lib/pagination";
import { env } from "../../config/env";
import { logAudit } from "../../lib/audit";
import { sanitizeRichHtml } from "../../lib/html-sanitize";
import { canAccessBookingHealthData } from "../../lib/telehealth-access";
import { triggerDoctorProfileRevalidation } from "../../lib/revalidate";
import { DoctorBookingsQuerySchema, UpdateDoctorSelfProfileRequestSchema } from "./telehealth.schemas";
import { splitCommission } from "./lib/commission";
import { JOIN_WINDOW_BEFORE_START_MS } from "./lib/booking";
import { addCalendarDays, formatCalendarDateKey, getStartOfCalendarDayInTimeZone, getWallClockParts } from "./lib/timezone";
import { BOOKINGS_WITH_APPOINTMENTS_FILTER, buildDoctorBookingScopeFilter } from "./lib/doctor-booking-scope";
import { DOCTOR_PORTAL_ANNOUNCEMENTS } from "./lib/portal-announcements";

/** `GET /doctor/portal-feed` — bildirim besleme penceresi (son 14 gün). */
const PORTAL_FEED_NOTIFICATION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** `GET /doctor/portal-feed` — nihai birleşik liste üst sınırı. */
const PORTAL_FEED_NOTIFICATION_MAX_ITEMS = 10;
/** `GET /doctor/portal-feed` — her kaynak sorgusunun kendi `take` sınırı. */
const PORTAL_FEED_NOTIFICATION_PER_SOURCE_LIMIT = 5;

const WITH_DOCTOR_RELATIONS = { specialty: true, avatarMedia: true, availability: true } as const;
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
 * [TCT] §9.7.7 KARAR K madde 1/2 (bağlayıcı) — `SiteRole.DOCTOR` EKLENMEZ: doktorluk
 * `DoctorProfile.userId === user.id` İLİŞKİSİDİR. 2FA ZORUNLULUĞU yeni bir DB kolonu/2FA ucu
 * İLE DEĞİL, route seviyesinde bir KAPI ile uygulanır (`user.twoFactorEnabled !== true` →
 * `403 TWO_FACTOR_REQUIRED`). Sıra bilinçlidir: önce ilişki (`NOT_A_DOCTOR`), sonra 2FA kapısı —
 * doktor OLMAYAN birine "2FA açman lazım" demek yanıltıcı olurdu.
 */
async function requireDoctorPortalAccess(
  app: FastifyInstance,
  userId: string
): Promise<{ user: { id: string; email: string; name: string; twoFactorEnabled: boolean }; doctorProfileId: string }> {
  const user = await app.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, twoFactorEnabled: true },
  });
  if (!user) throw new NotADoctorError();

  const doctorProfile = await app.prisma.doctorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!doctorProfile) throw new NotADoctorError();

  if (user.twoFactorEnabled !== true) throw new TwoFactorRequiredError();

  return { user, doctorProfileId: doctorProfile.id };
}

/**
 * [DPI] §1.1 — `practiceStartYear` üst sınırı (içinde bulunulan yıl) dinamik olarak burada
 * zorlanır (`telehealth.admin.routes.ts::assertPracticeStartYearNotFuture` İLE AYNI kural, admin
 * CRUD'undan AYRI bir dosyada TEKRARLANIR — bu modülün kendi route dosyası kendi doğrulamasını
 * taşır, `UpdateDoctorSelfProfileRequestSchema` `UpdateDoctorRequestSchema`'dan TÜREMEDİĞİ gibi
 * bu kontrol de ondan TÜREMEZ).
 */
function assertPracticeStartYearNotFuture(practiceStartYear: number | null | undefined) {
  if (practiceStartYear == null) return;
  const currentYear = new Date().getUTCFullYear();
  if (practiceStartYear > currentYear) {
    throw new ValidationError("Geçersiz mesleğe başlama yılı.", { practiceStartYear: ["Gelecekte bir yıl olamaz."] });
  }
}

/** [DPI] §1.2 — `aboutHtml` `lib/html-sanitize.ts`'ten geçer; temizlik SONRASI boşsa `null`. */
function sanitizeAboutHtml(aboutHtml: string | null | undefined): string | null | undefined {
  if (aboutHtml === undefined) return undefined;
  if (aboutHtml === null) return null;
  const sanitized = sanitizeRichHtml(aboutHtml);
  return sanitized.length > 0 ? sanitized : null;
}

/**
 * `/doctor` prefix'i altında bağlanır (bkz. app.ts) — panel DEĞİLDİR (doktor bir admin
 * kullanıcısı değildir), oturum GEREKTİRİR. `/admin/telehealth/*` bundan TAMAMEN AYRIDIR.
 */
export async function telehealthDoctorPortalRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);

  server.get(
    "/me",
    { schema: { response: { 200: ApiSuccessSchema(DoctorPortalProfileSchema) } } },
    async (request, reply) => {
      const { user, doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);

      const doctorProfile = await app.prisma.doctorProfile.findUniqueOrThrow({
        where: { id: doctorProfileId },
        include: WITH_DOCTOR_RELATIONS,
      });

      return reply.send(ok(toDoctorPortalProfileDto(user, doctorProfile)));
    }
  );

  /**
   * [DPI] §1.4 — doktorun KENDİ kurumsal profilini düzenlemesi (dar yazma yüzeyi).
   * `UpdateDoctorSelfProfileRequestSchema` `.strict()`'tir — kapsam dışı bir alan (`title`,
   * `sessionPriceCents`, `experienceYears` vb.) `422` ile REDDEDİLİR (sessiz yok sayma YOK,
   * Fastify/Zod bunu route handler'a ulaşmadan ZATEN yapar).
   */
  server.put(
    "/profile",
    {
      schema: { body: UpdateDoctorSelfProfileRequestSchema, response: { 200: ApiSuccessSchema(DoctorPortalProfileSchema) } },
    },
    async (request, reply) => {
      const { user, doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);
      const body = request.body;

      assertPracticeStartYearNotFuture(body.practiceStartYear);
      const sanitizedAboutHtml = sanitizeAboutHtml(body.aboutHtml);

      const updated = await app.prisma.doctorProfile.update({
        where: { id: doctorProfileId },
        data: {
          ...(body.subSpecialty !== undefined ? { subSpecialty: body.subSpecialty } : {}),
          ...(body.bio !== undefined ? { bio: body.bio } : {}),
          ...(sanitizedAboutHtml !== undefined ? { aboutHtml: sanitizedAboutHtml } : {}),
          ...(body.practiceStartYear !== undefined ? { practiceStartYear: body.practiceStartYear } : {}),
          ...(body.languages !== undefined ? { languages: body.languages } : {}),
          ...(body.cvEntries !== undefined ? { cvEntries: body.cvEntries as Prisma.InputJsonValue } : {}),
          ...(body.publications !== undefined ? { publications: body.publications as Prisma.InputJsonValue } : {}),
          // backend-agent görev notu (2026-09-15) — doktor kendi `timeZone`'unu (ör. Türkiye'deyse
          // "Europe/Istanbul") self-service değiştirebilsin diye eklendi. IANA-format doğrulaması
          // `UpdateDoctorSelfProfileRequestSchema::isValidIanaTimeZone`'da ZATEN yapıldı, burada
          // TEKRARLANMAZ.
          ...(body.timeZone !== undefined ? { timeZone: body.timeZone } : {}),
        },
        include: WITH_DOCTOR_RELATIONS,
      });

      // [DPI] §1.4 madde 3 — metadata'ya İÇERİK yazılmaz, yalnızca alan adları.
      await logAudit(app, {
        actorId: user.id,
        actorEmail: user.email,
        action: "telehealth.doctor.profile_updated",
        targetType: "DoctorProfile",
        targetId: doctorProfileId,
        metadata: { fields: Object.keys(body) },
        ipAddress: request.ip,
      });

      // [DPI] §1.4 madde 4 — public doktor sayfası ISR'dir, yazma SONRASI tetiklenir (best-effort).
      await triggerDoctorProfileRevalidation(app, updated.slug);

      return reply.send(ok(toDoctorPortalProfileDto(user, updated)));
    }
  );

  server.get(
    "/bookings",
    {
      schema: {
        querystring: DoctorBookingsQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(AppointmentBookingSchema), z.object({ nextCursor: z.string().nullable() })) },
      },
    },
    async (request, reply) => {
      const { doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);

      const { from, to, paymentStatus, scope, cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      // [DPI] §3.2 — `scope` (`from`/`to` ile ASLA BİRLİKTE gelmez, `DoctorBookingsQuerySchema`
      // zaten bunu `422` ile reddeder) doktorun KENDİ `timeZone`'unda sunucuda hesaplanır.
      // Where-clause üretimi paylaşılan `lib/doctor-booking-scope.ts`'e taşındı (`GET /overview`
      // İLE PAYLAŞILIR, kod tekrarı yasak) — DAVRANIŞ SIFIR DEĞİŞTİ, yalnızca kod taşındı.
      let scopeFilter: Prisma.AppointmentBookingWhereInput | undefined;
      if (scope === "today") {
        const doctorProfile = await app.prisma.doctorProfile.findUniqueOrThrow({
          where: { id: doctorProfileId },
          select: { timeZone: true },
        });
        scopeFilter = buildDoctorBookingScopeFilter("today", { timeZone: doctorProfile.timeZone, now: new Date() });
      } else if (scope === "upcoming" || scope === "completed") {
        scopeFilter = buildDoctorBookingScopeFilter(scope, { now: new Date() });
      }

      // Kök neden notu (2026-09-14 araştırması) — `PENDING` bir booking süresi dolduğunda
      // (`booking-expiry.ts::runBookingExpirySweep`) VEYA hasta hiç ödemeden iptal ettiğinde
      // (`telehealth.routes.ts` `/appointments/bookings/:bookingId/cancel`), o booking'in TÜM
      // `PENDING_PAYMENT` randevu satırları HARD DELETE edilir ve booking `paymentStatus =
      // "EXPIRED"` olarak KALICI şekilde DB'de yaşamaya devam eder — sıfır `appointments` ile.
      // `scope=today/upcoming/completed` bunu zaten `appointments: { some: ... }` ile doğal
      // olarak ELER; yalnızca varsayılan `scope=all` + filtresiz sorguda bu "hayalet" booking'ler
      // sızıyor ve doktor konsolunda `appointments[0]`'a dayanan kartlarda "Randevu saati bilgisi
      // eksik" durumuna yol açıyordu. `paymentStatus` AÇIKÇA istenmediği sürece (ör. ileride bir
      // denetim/analitik görünümü `paymentStatus=EXPIRED` isteyebilir) bu satırları varsayılan
      // listeden dışarıda bırakıyoruz — DTO şekli/alanları DEĞİŞMEDİ, yalnızca satır sayısı azaldı.
      const excludeAppointmentlessBookings = !paymentStatus && !scopeFilter;

      // `doctorId` sorgu parametresi BİLİNÇLİ OLARAK YOKTUR (IDOR yüzeyi) — yalnızca oturumun
      // KENDİ `DoctorProfile`'ı üzerinden filtrelenir.
      const rows = await app.prisma.appointmentBooking.findMany({
        where: {
          doctorId: doctorProfileId,
          ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
          ...(paymentStatus ? { paymentStatus } : {}),
          ...(excludeAppointmentlessBookings ? BOOKINGS_WITH_APPOINTMENTS_FILTER : {}),
          ...(scopeFilter ?? {}),
          ...(from || to
            ? {
                appointments: {
                  some: {
                    ...(from ? { startsAt: { gte: new Date(from) } } : {}),
                    ...(to ? { startsAt: { lte: new Date(to) } } : {}),
                  },
                },
              }
            : {}),
        },
        orderBy: { seq: "asc" },
        take: limit,
        include: WITH_BOOKING_RELATIONS,
      });

      return reply.send(
        ok(
          rows.map((row) => toAppointmentBookingDto(row, canAccessBookingHealthData(row, { user: request.user }))),
          buildPageMeta(rows, limit)
        )
      );
    }
  );

  /**
   * §9.7 TADİLAT — salt-okunur kazanç özeti. `/doctor/me`/`/doctor/bookings` İLE AYNI şekilde
   * rate limit/audit log GEREKMEZ (hassas bir yazma eylemi değil).
   */
  server.get(
    "/earnings",
    {
      schema: {
        querystring: CursorQuerySchema,
        response: { 200: ApiSuccessWithMeta(DoctorEarningsResponseSchema, z.object({ nextCursor: z.string().nullable() })) },
      },
    },
    async (request, reply) => {
      const { doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);

      // Tek para birimi varsayımı — `DoctorProfile.currency`/`sessionPriceCents` İLE AYNI desen.
      const doctorProfile = await app.prisma.doctorProfile.findUniqueOrThrow({
        where: { id: doctorProfileId },
        select: { currency: true },
      });
      const currency = doctorProfile.currency;
      const rate = env.PLATFORM_COMMISSION_RATE_PERCENT;

      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      // `summary` — SAYFALAMA UYGULANMADAN tüm tamamlanmış randevular üzerinden hesaplanır (satır
      // bazında YUVARLA, SONRA topla — `sessions.items` ile toplamda TUTARSIZLIK olmasın).
      const allCompleted = await app.prisma.appointment.findMany({
        where: { doctorId: doctorProfileId, status: "COMPLETED" },
        select: { priceCents: true },
      });
      let grossCents = 0;
      let commissionCents = 0;
      let netCents = 0;
      for (const row of allCompleted) {
        const split = splitCommission(row.priceCents, rate);
        grossCents += split.grossCents;
        commissionCents += split.commissionCents;
        netCents += split.netCents;
      }

      // `doctorId` sorgu parametresi BİLİNÇLİ OLARAK YOKTUR (IDOR yüzeyi, `/bookings` İLE AYNI
      // disiplin) — yalnızca oturumun KENDİ `DoctorProfile`'ı üzerinden filtrelenir.
      const rows = await app.prisma.appointment.findMany({
        where: {
          doctorId: doctorProfileId,
          status: "COMPLETED",
          ...(cursorSeq ? { seq: { lt: cursorSeq } } : {}),
        },
        orderBy: { seq: "desc" },
        take: limit,
        include: { booking: { select: { id: true } } },
      });

      const items = rows.map((appointment) => {
        const split = splitCommission(appointment.priceCents, rate);
        return {
          // `booking` YOKSA (bu tur ÖNCESİ deprecated tekil randevu) `appointmentId`'ye düşer.
          bookingId: appointment.booking?.id ?? appointment.id,
          appointmentId: appointment.id,
          patientName: appointment.patientName,
          startsAt: appointment.startsAt.toISOString(),
          grossCents: split.grossCents,
          commissionCents: split.commissionCents,
          netCents: split.netCents,
          currency: appointment.currency,
        };
      });

      return reply.send(
        ok(
          {
            summary: {
              grossCents,
              commissionCents,
              netCents,
              currency,
              commissionRatePercent: rate,
              completedSessionCount: allCompleted.length,
            },
            sessions: { items },
          },
          buildPageMeta(rows, limit)
        )
      );
    }
  );

  /**
   * [DPI] §3.1 — doktor konsolu metrik kartlarının TEK toplama ucu. `doctorId` parametresi
   * YOKTUR (IDOR). Salt-okunur ve hasta PII'si taşımadığı için (yalnızca sayılar) denetim kaydı
   * GEREKMEZ (`/doctor/earnings` İLE AYNI değerlendirme).
   */
  server.get(
    "/overview",
    { schema: { response: { 200: ApiSuccessSchema(DoctorConsoleOverviewSchema) } } },
    async (request, reply) => {
      const { doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);

      const doctorProfile = await app.prisma.doctorProfile.findUniqueOrThrow({
        where: { id: doctorProfileId },
        select: { timeZone: true },
      });
      const timeZone = doctorProfile.timeZone;

      const now = new Date();
      const wallToday = getWallClockParts(now, timeZone);
      const todayStart = getStartOfCalendarDayInTimeZone({ year: wallToday.year, month: wallToday.month, day: wallToday.day }, timeZone);
      const tomorrowCalendar = addCalendarDays({ year: wallToday.year, month: wallToday.month, day: wallToday.day }, 1);
      const tomorrowStart = getStartOfCalendarDayInTimeZone(tomorrowCalendar, timeZone);

      // İstek 2 §2.2 (bağlayıcı) — sekmeler BOOKING listeler → sayaçlar da BOOKING sayısıdır
      // (`appointmentBooking.count`), randevu sayısı DEĞİL (aksi hâlde rozet ile görünen satır
      // sayısı tutmaz). Aynı `lib/doctor-booking-scope.ts` kaynağı `GET /bookings` İLE PAYLAŞILIR.
      const upcomingScopeFilter = buildDoctorBookingScopeFilter("upcoming", { now });

      const [todayRows, completedConsultationTotal, paidBookings, pendingDocumentCount, nextAppointmentRow, upcomingBookingTotal, allBookingTotal] =
        await Promise.all([
          app.prisma.appointment.groupBy({
            by: ["status"],
            where: { doctorId: doctorProfileId, startsAt: { gte: todayStart, lt: tomorrowStart } },
            _count: { _all: true },
          }),
          app.prisma.appointment.count({ where: { doctorId: doctorProfileId, status: "COMPLETED" } }),
          // [DPI] §3.1 — "Toplam Hasta" TÜM `PAID` booking'ler üzerinde `DISTINCT` ister; imleç
          // tabanlı `/doctor/bookings` bunu doğru yapamaz (bu uçun var olma gerekçesi budur).
          app.prisma.appointmentBooking.findMany({
            where: { doctorId: doctorProfileId, paymentStatus: "PAID" },
            select: { identityNumberHash: true, patientUserId: true, patientEmail: true },
          }),
          app.prisma.appointmentDocument.count({
            where: {
              deletedAt: null,
              booking: {
                doctorId: doctorProfileId,
                paymentStatus: "PAID",
                appointments: { some: { status: { in: ["SCHEDULED", "IN_PROGRESS"] } } },
              },
            },
          }),
          app.prisma.appointment.findFirst({
            where: { doctorId: doctorProfileId, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, startsAt: { gt: now } },
            orderBy: { startsAt: "asc" },
            select: { id: true, bookingId: true, startsAt: true },
          }),
          // `upcomingBookingTotal` = `GET /bookings?scope=upcoming` İLE BİREBİR AYNI filtre, sayım hâli.
          app.prisma.appointmentBooking.count({ where: { doctorId: doctorProfileId, ...(upcomingScopeFilter ?? {}) } }),
          // `allBookingTotal` = `GET /bookings`'in varsayılan `scope=all` davranışıyla BİREBİR AYNI
          // ("hayalet" EXPIRED/appointmentsiz booking'ler HARİÇ).
          app.prisma.appointmentBooking.count({ where: { doctorId: doctorProfileId, ...BOOKINGS_WITH_APPOINTMENTS_FILTER } }),
        ]);

      // ---- today (`PENDING_PAYMENT` HARİÇ; `cancelled` = CANCELLED + NO_SHOW) ----
      const today = { date: formatCalendarDateKey(wallToday), total: 0, scheduled: 0, inProgress: 0, completed: 0, cancelled: 0 };
      for (const row of todayRows) {
        const count = row._count._all;
        if (row.status !== "PENDING_PAYMENT") today.total += count;
        switch (row.status) {
          case "SCHEDULED":
            today.scheduled += count;
            break;
          case "IN_PROGRESS":
            today.inProgress += count;
            break;
          case "COMPLETED":
            today.completed += count;
            break;
          case "CANCELLED":
          case "NO_SHOW":
            today.cancelled += count;
            break;
        }
      }

      // ---- distinctPatientTotal (anahtar sırası: identityNumberHash → patientUserId → lower(email)) ----
      const patientKeys = new Set<string>();
      for (const booking of paidBookings) {
        const key = booking.identityNumberHash
          ? `hash:${booking.identityNumberHash}`
          : booking.patientUserId
            ? `user:${booking.patientUserId}`
            : `email:${booking.patientEmail.toLowerCase()}`;
        patientKeys.add(key);
      }

      return reply.header("Cache-Control", "no-store").send(
        ok({
          timeZone,
          today,
          completedConsultationTotal,
          distinctPatientTotal: patientKeys.size,
          pendingDocumentCount,
          upcomingBookingTotal,
          allBookingTotal,
          nextAppointment: nextAppointmentRow
            ? {
                appointmentId: nextAppointmentRow.id,
                bookingId: nextAppointmentRow.bookingId,
                startsAt: nextAppointmentRow.startsAt.toISOString(),
                joinableFrom: new Date(nextAppointmentRow.startsAt.getTime() - JOIN_WINDOW_BEFORE_START_MS).toISOString(),
              }
            : null,
          generatedAt: now.toISOString(),
        })
      );
    }
  );

  /**
   * "Portal Akışı & Duyurular" besleme ucu. `announcements` kod-seviyeli statik bir listedir
   * (bkz. `lib/portal-announcements.ts`); `notifications` doktora özel GERÇEK olaylardan
   * türetilir (booking oluşturma/rıza onayı/tamamlanan randevu, son 14 gün, en fazla 10 kayıt).
   * `doctorId` sorgu parametresi BİLİNÇLİ OLARAK YOKTUR (IDOR yüzeyi) — `/bookings`/`/earnings`/
   * `/overview` İLE AYNI disiplin, yalnızca oturumun KENDİ `DoctorProfile`'ı üzerinden filtrelenir.
   * Şifreli/hassas alanlar (`consultationNoteCiphertext`, `identityNumberCiphertext` vb.)
   * SEÇİLMEZ — yalnızca aşağıda listelenen alanlar `select` edilir.
   */
  server.get(
    "/portal-feed",
    { schema: { response: { 200: ApiSuccessSchema(DoctorPortalFeedSchema) } } },
    async (request, reply) => {
      const { doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);

      const now = new Date();
      const windowStart = new Date(now.getTime() - PORTAL_FEED_NOTIFICATION_WINDOW_MS);

      const [recentBookings, recentCompletedAppointments] = await Promise.all([
        app.prisma.appointmentBooking.findMany({
          where: { doctorId: doctorProfileId, createdAt: { gte: windowStart } },
          orderBy: { createdAt: "desc" },
          take: PORTAL_FEED_NOTIFICATION_PER_SOURCE_LIMIT,
          select: { id: true, bookingNumber: true, patientName: true, createdAt: true, consentAt: true },
        }),
        app.prisma.appointment.findMany({
          where: { doctorId: doctorProfileId, status: "COMPLETED", endedAt: { gte: windowStart } },
          orderBy: { endedAt: "desc" },
          take: PORTAL_FEED_NOTIFICATION_PER_SOURCE_LIMIT,
          select: { id: true, patientName: true, endedAt: true },
        }),
      ]);

      const notifications: DoctorPortalNotification[] = [];

      for (const booking of recentBookings) {
        notifications.push({
          id: `booking-created:${booking.id}`,
          kind: "BOOKING_CREATED",
          message: `Yeni randevu talebi: ${booking.bookingNumber}`,
          occurredAt: booking.createdAt.toISOString(),
        });
      }

      for (const booking of recentBookings) {
        if (!booking.consentAt) continue;
        notifications.push({
          id: `consent-given:${booking.id}`,
          kind: "CONSENT_GIVEN",
          message: `${booking.patientName} rıza onayını verdi`,
          occurredAt: booking.consentAt.toISOString(),
        });
      }

      for (const appointment of recentCompletedAppointments) {
        // `endedAt` `null` OLABİLİR (COMPLETED ama bitiş zamanı kaydedilmemiş) — bu satır atlanır.
        if (!appointment.endedAt) continue;
        notifications.push({
          id: `appointment-completed:${appointment.id}`,
          kind: "APPOINTMENT_COMPLETED",
          message: `Randevu tamamlandı: ${appointment.patientName}`,
          occurredAt: appointment.endedAt.toISOString(),
        });
      }

      notifications.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));

      return reply.send(
        ok({
          announcements: DOCTOR_PORTAL_ANNOUNCEMENTS,
          notifications: notifications.slice(0, PORTAL_FEED_NOTIFICATION_MAX_ITEMS),
          generatedAt: now.toISOString(),
        })
      );
    }
  );
}

/**
 * `/patient` prefix'i altında bağlanır (bkz. app.ts) — oturum GEREKTİRİR, **2FA ZORUNLU
 * DEĞİLDİR** (hasta bir panel kullanıcısı değildir, §9.7.10). Oturumu olmayan misafir hasta
 * bunun yerine magic-link'li `GET /appointments/bookings/{bookingId}?t=` yolunu kullanır.
 */
export async function telehealthPatientPortalRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);

  server.get(
    "/bookings",
    {
      schema: {
        querystring: CursorQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(AppointmentBookingSchema), z.object({ nextCursor: z.string().nullable() })) },
      },
    },
    async (request, reply) => {
      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.appointmentBooking.findMany({
        where: { patientUserId: request.user!.id, ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}) },
        orderBy: { seq: "asc" },
        take: limit,
        include: WITH_BOOKING_RELATIONS,
      });

      return reply.send(
        ok(
          rows.map((row) => toAppointmentBookingDto(row, canAccessBookingHealthData(row, { user: request.user }))),
          buildPageMeta(rows, limit)
        )
      );
    }
  );
}
