import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ok } from "../../lib/envelope";
import { NotFoundError, ValidationError } from "../../lib/errors";
import { LOCALE_CODE_PATTERN } from "../../lib/localization";
import { CONTACT_SUBMIT_RATE_LIMIT } from "../../lib/rate-limit";
import { absolutizeMediaUrl } from "../../mappers";
import { doctorDisplayName } from "../../lib/doctor-display-name";
import { localizedDoctorTitle } from "../../lib/doctor-email-name";
import { sanitizeText } from "../crm/crm.privacy";
import { assertSameSiteOrigin } from "../crm/crm.public.routes";
import { toE164 } from "../matcher/matcher.routes";
import { PUBLIC_DOCTOR_WHERE } from "../telehealth/lib/archive-filters";
import { localizeSpecialty } from "../telehealth/lib/doctor-localization";
import { PACKAGE_CATEGORIES, parseContactChannels, pickLocale, publicWhatsapp, toPublicDestination, toPublicPackageCard, toPublicPackageDetail, type PackageText } from "./packages.shared";
import { notifyPackageInquiry, sendPackageConfirmation } from "./packages.notifications";

const localeCode = z.string().regex(LOCALE_CODE_PATTERN);
export const PACKAGE_NOTE_MAX = 500;
/** Onay kutularındaki metnin sürümü (ön yüz metni değişince artırılır; ispat için talepte saklanır). */
export const PACKAGE_CONSENT_TEXT_VERSION = "package-v1";
/** Posta bombasına karşı: adres başına saatte 3, bütün sitede saatte en çok 50 onay e-postası. */
const CONFIRMATIONS_PER_ADDRESS_PER_HOUR = 3;
const CONFIRMATIONS_PER_HOUR_GLOBAL = 50;
/** Koordinatöre saatte en çok 30 tekil bildirim (fazlası panelde görünür; e-posta gitmez). */
const COORDINATOR_NOTICES_PER_HOUR = 30;
/** Aynı kişi + aynı paket için bu süre içindeki tekrar gönderim yeni talep açmaz. */
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
/** Tarih tercihi serbest metin DEĞİL (sağlık bilgisi yazılmasın diye): tek tarih ya da "YYYY-MM-DD – YYYY-MM-DD". */
const DATE_RANGE = /^\d{4}-\d{2}-\d{2}(?: [–-] \d{4}-\d{2}-\d{2})?$/;

const InquiryBodySchema = z
  .object({
    /** Honeypot — doluysa bot; başarı gibi görünür, hiçbir şey yazılmaz. */
    website: z.string().max(200).optional(),
    locale: localeCode,
    name: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().toLowerCase().email().max(200).optional(),
    phoneCountry: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
    phoneNumber: z.string().trim().max(30).optional(),
    country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
    preferredDates: z.string().trim().max(23).regex(DATE_RANGE, "Tarih aralığı YYYY-MM-DD – YYYY-MM-DD biçiminde olmalı.").optional(),
    travellers: z.number().int().min(1).max(20).optional(),
    note: z.string().trim().max(PACKAGE_NOTE_MAX).optional(),
    /** "Koordinatör benimle iletişime geçsin" — yoksa HİÇBİR ŞEY kaydedilmez. */
    consentContact: z.boolean(),
    /** Not sağlık bilgisi içerebilir: not yalnızca bu onayla saklanır. */
    consentHealth: z.boolean(),
  })
  .strict();

/**
 * Paket X — herkese açık uçlar (telehealth modülü açıkken). Paketler satın alınmaz: yalnızca planlama talebi.
 */
export async function packagesPublicRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("onRequest", async (request) => {
    if (request.method === "POST") assertSameSiteOrigin(request);
  });

  const LIST_LIMIT = { max: 120, timeWindow: "1 minute" };

  server.get(
    "/packages",
    { config: { rateLimit: LIST_LIMIT }, schema: { querystring: z.object({ locale: localeCode.optional(), category: z.enum(PACKAGE_CATEGORIES).optional(), featured: z.coerce.boolean().optional() }) } },
    async (request, reply) => {
      const { locale, category, featured } = request.query;
      const rows = await app.prisma.healthPackage.findMany({
        where: { isActive: true, ...(category ? { category } : {}), ...(featured ? { isFeatured: true } : {}) },
        include: { coverMedia: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        take: 200,
      });
      const items = rows.map((r) => toPublicPackageCard(r, locale)).filter((x) => x !== null);
      const categories = [...new Set(items.map((i) => i.category))];
      return reply.header("cache-control", "public, max-age=60").send(ok({ items, categories }));
    }
  );

  server.get(
    "/packages/:slug",
    { config: { rateLimit: LIST_LIMIT }, schema: { params: z.object({ slug: z.string().min(1).max(80) }), querystring: z.object({ locale: localeCode.optional() }) } },
    async (request, reply) => {
      const { locale } = request.query;
      const row = await app.prisma.healthPackage.findFirst({ where: { slug: request.params.slug, isActive: true }, include: { coverMedia: true } });
      const detail = row ? toPublicPackageDetail(row, locale) : null;
      if (!row || !detail) throw new NotFoundError("Paket bulunamadı.");
      const [doctors, specialties] = await Promise.all([
        row.relatedDoctorIds.length
          ? app.prisma.doctorProfile.findMany({
              where: { id: { in: row.relatedDoctorIds }, ...PUBLIC_DOCTOR_WHERE },
              select: { id: true, slug: true, title: true, translations: true, fullName: true, publicName: true, isFounder: true, avatarMedia: true, specialty: { select: { name: true, description: true, translations: true } } },
            })
          : Promise.resolve([]),
        row.relatedSpecialtyIds.length ? app.prisma.specialty.findMany({ where: { id: { in: row.relatedSpecialtyIds } }, select: { id: true, slug: true, name: true, description: true, translations: true } }) : Promise.resolve([]),
      ]);
      // Yönetici sırası korunur.
      const order = new Map(row.relatedDoctorIds.map((id, i) => [id, i]));
      return reply.header("cache-control", "public, max-age=60").send(
        ok({
          ...detail,
          // Görünen ad kuralı (kurucu dışında kısaltılmış ad) ve alıcının dilinde unvan; profil yolu /physicians.
          relatedDoctors: doctors
            .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
            .map((d) => ({
              slug: d.slug,
              name: `${localizedDoctorTitle(d, locale)} ${doctorDisplayName(d)}`.trim(),
              specialty: d.specialty ? localizeSpecialty(d.specialty, locale).name : null,
              avatarUrl: d.avatarMedia?.url ? absolutizeMediaUrl(d.avatarMedia.url) : null,
            })),
          relatedSpecialties: specialties.map((s) => ({ slug: s.slug, name: localizeSpecialty(s, locale).name })),
        })
      );
    }
  );

  server.get("/destinations", { config: { rateLimit: LIST_LIMIT }, schema: { querystring: z.object({ locale: localeCode.optional() }) } }, async (request, reply) => {
    const rows = await app.prisma.destinationHighlight.findMany({ where: { isActive: true }, include: { coverMedia: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 24 });
    const items = rows.map((r) => toPublicDestination(r, request.query.locale)).filter((x) => x !== null);
    return reply.header("cache-control", "public, max-age=60").send(ok({ items }));
  });

  /** İletişim kanalları: WhatsApp yalnızca açık ve numara girilmişse (aksi halde null → düğme hiç çizilmez). */
  server.get("/contact-channels", { config: { rateLimit: LIST_LIMIT }, schema: { querystring: z.object({ locale: localeCode.optional() }) } }, async (request, reply) => {
    const row = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" }, select: { settings: true } });
    return reply.header("cache-control", "public, max-age=60").send(ok({ whatsapp: publicWhatsapp(parseContactChannels(row?.settings), request.query.locale) }));
  });

  server.post(
    "/packages/:slug/inquiries",
    { config: { rateLimit: CONTACT_SUBMIT_RATE_LIMIT }, schema: { params: z.object({ slug: z.string().min(1).max(80) }), body: InquiryBodySchema } },
    async (request, reply) => {
      const body = request.body;
      if (body.website && body.website.trim().length > 0) {
        return reply.status(201).send(ok({ number: 1000 + crypto.randomInt(9000), stored: true }));
      }
      const pkg = await app.prisma.healthPackage.findFirst({ where: { slug: request.params.slug, isActive: true } });
      if (!pkg) throw new NotFoundError("Paket bulunamadı.");

      // İletişim izni yoksa ad/telefon/e-posta/not KAYDEDİLMEZ, talep oluşmaz, e-posta gitmez (W ile aynı kural).
      if (!body.consentContact) return reply.status(201).send(ok({ number: 0, stored: false }));

      const errors: Record<string, string[]> = {};
      if (!body.name) errors.name = ["Ad soyad gerekli."];
      const phone = body.phoneNumber && body.phoneNumber.trim() ? (body.phoneCountry ? toE164(body.phoneCountry, body.phoneNumber) : null) : undefined;
      if (phone === null) errors.phoneNumber = ["Geçerli bir telefon numarası girin (ülke kodu ile)."];
      if (!body.email && !phone) errors.email = ["E-posta ya da telefon numarasından en az birini girin."];
      const note = body.note ? sanitizeText(body.note, PACKAGE_NOTE_MAX) : "";
      // Not sağlık bilgisi içerebilir: onaysız not sessizce atılmaz, açıkça reddedilir.
      if (note && !body.consentHealth) errors.consentHealth = ["Not alanını kullanmak için sağlık bilgisi onayı gerekli."];
      if (Object.keys(errors).length > 0) throw new ValidationError("Girdi doğrulama hatası.", errors);

      const title = pickLocale<PackageText>(pkg.translations, body.locale)?.value.title ?? pkg.slug;
      const now = new Date();
      // Aynı kişi + aynı paket kısa sürede yeniden gönderirse yeni talep açılmaz, e-posta tekrar gitmez.
      const duplicate = await app.prisma.packageInquiry.findFirst({
        where: {
          packageId: pkg.id,
          createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
          lead: { OR: [...(body.email ? [{ email: body.email }] : []), ...(phone ? [{ phone }] : [])] },
        },
        select: { seq: true },
      });
      if (duplicate) return reply.status(201).send(ok({ number: duplicate.seq, stored: true }));
      const inquiryId = crypto.randomUUID();
      const { lead, inquiry } = await app.prisma.$transaction(async (tx) => {
        const lead = await tx.crmLead.create({
          data: {
            channel: "PACKAGE",
            status: "NEW",
            name: sanitizeText(body.name ?? "", 120),
            email: body.email ?? null,
            phone: phone ?? null,
            country: body.country ?? null,
            language: body.locale,
            landingPath: `/packages/${pkg.slug}`,
            sourceRefId: inquiryId,
            nextActionAt: now,
          },
        });
        const inquiry = await tx.packageInquiry.create({
          data: {
            id: inquiryId,
            leadId: lead.id,
            packageId: pkg.id,
            packageSlug: pkg.slug,
            packageTitle: sanitizeText(title, 160),
            preferredDates: body.preferredDates ? sanitizeText(body.preferredDates, 100) : null,
            travellers: body.travellers ?? null,
            note: body.consentHealth && note ? note : null,
            consentContactAt: now,
            // Veri minimizasyonu: sağlık onayı yalnızca not yazıldıysa kayda geçer.
            consentHealthAt: body.consentHealth && note ? now : null,
            consentTextVersion: PACKAGE_CONSENT_TEXT_VERSION,
          },
        });
        return { lead, inquiry };
      });

      const hourAgo = new Date(now.getTime() - 3600_000);
      const lastHour = await app.prisma.crmLead.count({ where: { channel: "PACKAGE", createdAt: { gte: hourAgo } } });
      if (lastHour <= COORDINATOR_NOTICES_PER_HOUR) {
        await notifyPackageInquiry(app, { number: inquiry.seq, leadId: lead.id, packageTitle: inquiry.packageTitle });
      } else {
        app.log.warn({ lastHour }, "package.new_inquiry: saatlik bildirim sınırı aşıldı; talep panelde, e-posta gönderilmedi.");
      }
      // Posta bombasına karşı: adres başına ve site genelinde saatlik onay e-postası sınırı (talep yine kaydedilir).
      if (body.email) {
        const [perAddress, global] = await Promise.all([
          app.prisma.crmLead.count({ where: { channel: "PACKAGE", email: body.email, createdAt: { gte: hourAgo } } }),
          app.prisma.crmLead.count({ where: { channel: "PACKAGE", email: { not: null }, createdAt: { gte: hourAgo } } }),
        ]);
        if (perAddress <= CONFIRMATIONS_PER_ADDRESS_PER_HOUR && global <= CONFIRMATIONS_PER_HOUR_GLOBAL) {
          await sendPackageConfirmation(app, { to: body.email, locale: body.locale, number: inquiry.seq, packageTitle: inquiry.packageTitle });
        }
      }
      return reply.status(201).send(ok({ number: inquiry.seq, stored: true }));
    }
  );
}
