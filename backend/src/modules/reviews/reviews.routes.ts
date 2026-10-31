import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { ok } from "../../lib/envelope";
import { ConflictError, NotFoundError } from "../../lib/errors";
import { hashToken } from "../../lib/tokens";
import { LOCALE_CODE_PATTERN } from "../../lib/localization";
import { doctorDisplayName } from "../../lib/doctor-display-name";
import { PUBLIC_DOCTOR_WHERE } from "../telehealth/lib/archive-filters";
import { assertSameSiteOrigin } from "../crm/crm.public.routes";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { patientEmailLocale } from "../telehealth/lib/notifications";
import {
  APPROVED_WHERE,
  REVIEW_LIST_PAGE_SIZE,
  isUniqueViolation,
  optOutEmailHash,
  ReviewSubmissionSchema,
  authorDisplayFor,
  ratingSummary,
  toPublicTestimonialDto,
} from "./reviews.service";

/**
 * Paket Y — herkese açık yorum uçları. Yalnızca ONAYLI ve anonimleştirilmemiş yorumlar görünür.
 * Yorum formu YALNIZCA hastaya açıktır: e-postadaki tek kullanımlık davet token'ı ya da hasta portalı
 * (oturum + kendi booking'i). Tercüman/doktor/admin bu uçlardan yorum yazamaz.
 */
const localeCode = z.string().regex(LOCALE_CODE_PATTERN);
const TOKEN = z.string().min(20).max(200);

export async function reviewsPublicRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("onRequest", async (request) => {
    if (request.method === "POST") assertSameSiteOrigin(request);
  });

  async function loadInvite(token: string) {
    const invite = await app.prisma.testimonialInvite.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { booking: { select: { id: true, patientName: true, locale: true, doctorId: true, doctor: { select: { title: true, fullName: true, publicName: true, isFounder: true, specialtyId: true } } } } },
    });
    // Varlık sızdırılmaz: yok / kullanılmış / süresi dolmuş → aynı 404.
    if (!invite || invite.usedAt || invite.expiresAt <= new Date()) throw new NotFoundError("Bağlantı geçersiz ya da süresi dolmuş.");
    return invite;
  }

  /** Davet formu için: yalnızca hekimin görünen adı (hasta bilgisi dönmez). */
  server.get(
    "/reviews/invite/:token",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { params: z.object({ token: TOKEN }) } },
    async (request, reply) => {
      const invite = await loadInvite(request.params.token);
      const d = invite.booking.doctor;
      return reply.header("cache-control", "no-store").send(ok({ doctorName: `${d.title} ${doctorDisplayName(d)}`.trim() }));
    }
  );

  server.post(
    "/reviews/invite/:token",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { params: z.object({ token: TOKEN }), body: ReviewSubmissionSchema } },
    async (request, reply) => {
      const invite = await loadInvite(request.params.token);
      const body = request.body;
      const now = new Date();
      const created = await app.prisma
        .$transaction(async (tx) => {
        // Tek kullanımlık: yarış durumunda yalnızca biri kazanır.
        const claim = await tx.testimonialInvite.updateMany({ where: { id: invite.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
        if (claim.count === 0) throw new NotFoundError("Bağlantı geçersiz ya da süresi dolmuş.");
        if (await tx.testimonial.findFirst({ where: { bookingId: invite.bookingId }, select: { id: true } })) throw new ConflictError("Bu randevu için zaten yorum gönderilmiş.");
        return tx.testimonial.create({
          data: {
            doctorId: invite.booking.doctorId,
            specialtyId: invite.booking.doctor.specialtyId,
            bookingId: invite.bookingId,
            authorDisplay: authorDisplayFor(invite.booking.patientName, body.displayMode),
            displayMode: body.displayMode,
            country: body.country ?? null,
            consentTextVersion: body.consentTextVersion,
            language: patientEmailLocale(invite.booking),
            rating: body.rating,
            title: body.title,
            body: body.body,
            source: "verified_booking",
            consentAt: now,
            status: "pending",
          },
        });
      })
        .catch((err: unknown) => {
          if (isUniqueViolation(err)) throw new ConflictError("Bu randevu için zaten yorum gönderilmiş.");
          throw err;
        });
      return reply.status(201).send(ok({ id: created.id, status: created.status }));
    }
  );

  /**
   * "Bir daha yorum isteği gönderme" — davet kullanılmış/süresi dolmuş olsa da çalışır. Geçersiz token da
   * 204 döner (varlık sızdırılmaz). E-posta adresinin yalnızca SHA-256 özeti saklanır.
   */
  server.post(
    "/reviews/invite/:token/opt-out",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { params: z.object({ token: TOKEN }), response: { 204: z.undefined() } } },
    async (request, reply) => {
      const invite = await app.prisma.testimonialInvite.findUnique({ where: { tokenHash: hashToken(request.params.token) }, select: { booking: { select: { patientEmail: true } } } });
      if (invite) {
        const emailHash = optOutEmailHash(invite.booking.patientEmail);
        await app.prisma.reviewRequestOptOut.upsert({ where: { emailHash }, create: { emailHash }, update: {} });
      }
      return reply.code(204).send();
    }
  );

  /** Hekim profili "Patient Reviews": özet (3'ten az onaylıda ortalama yok) + sayfalı liste. */
  server.get(
    "/doctors/:slug/reviews",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        params: z.object({ slug: z.string().min(1).max(80) }),
        querystring: z.object({
          locale: localeCode.optional(),
          sort: z.enum(["newest", "highest"]).default("newest"),
          language: localeCode.optional(),
          page: z.coerce.number().int().min(1).max(500).default(1),
        }),
      },
    },
    async (request, reply) => {
      const doctor = await app.prisma.doctorProfile.findFirst({ where: { slug: request.params.slug, ...PUBLIC_DOCTOR_WHERE }, select: { id: true } });
      if (!doctor) throw new NotFoundError("Hekim bulunamadı.");
      const { sort, language, page, locale } = request.query;
      const where: Prisma.TestimonialWhereInput = { doctorId: doctor.id, ...APPROVED_WHERE, ...(language ? { language } : {}) };
      const [summary, total, rows, languages] = await Promise.all([
        ratingSummary(app, { doctorId: doctor.id }),
        app.prisma.testimonial.count({ where }),
        app.prisma.testimonial.findMany({
          where,
          orderBy: sort === "highest" ? [{ rating: "desc" }, { publishedAt: "desc" }] : [{ publishedAt: "desc" }, { createdAt: "desc" }],
          skip: (page - 1) * REVIEW_LIST_PAGE_SIZE,
          take: REVIEW_LIST_PAGE_SIZE,
        }),
        app.prisma.testimonial.groupBy({ by: ["language"], where: { doctorId: doctor.id, ...APPROVED_WHERE }, _count: { _all: true } }),
      ]);
      return reply.send(
        ok({
          summary,
          languages: languages.map((l) => ({ code: l.language, count: l._count._all })),
          page,
          pageSize: REVIEW_LIST_PAGE_SIZE,
          total,
          items: rows.map((r) => toPublicTestimonialDto(r, locale)),
        })
      );
    }
  );

  /** Anasayfa "What our patients say": öne çıkarılan onaylı yorumlar + genel özet (yalnızca onaylı). */
  server.get(
    "/reviews/featured",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } }, schema: { querystring: z.object({ locale: localeCode.optional() }) } },
    async (request, reply) => {
      const [summary, rows] = await Promise.all([
        ratingSummary(app, {}),
        app.prisma.testimonial.findMany({
          where: { ...APPROVED_WHERE, featuredOnHome: true },
          orderBy: { publishedAt: "desc" },
          take: 12,
          include: { doctor: { select: { title: true, fullName: true, publicName: true, isFounder: true, slug: true, isActive: true, archivedAt: true } } },
        }),
      ]);
      return reply.header("cache-control", "public, max-age=60").send(
        ok({
          summary,
          items: rows.map((r) => ({
            ...toPublicTestimonialDto(r, request.query.locale),
            doctor: r.doctor && r.doctor.isActive && !r.doctor.archivedAt ? { name: `${r.doctor.title} ${doctorDisplayName(r.doctor)}`.trim(), slug: r.doctor.slug } : null,
          })),
        })
      );
    }
  );
}
