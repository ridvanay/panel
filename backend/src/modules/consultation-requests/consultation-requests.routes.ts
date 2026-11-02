import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ok } from "../../lib/envelope";
import { ValidationError } from "../../lib/errors";
import { encryptSecret } from "../../lib/crypto";
import { COUNTRY_CODES } from "../../lib/country-codes";
import { LOCALE_CODE_PATTERN } from "../../lib/localization";
import { CONTACT_SUBMIT_RATE_LIMIT } from "../../lib/rate-limit";
import { sendBrandedMail } from "../../lib/branded-mail";
import { normalizeEmail, normalizePhone } from "../crm/crm.leads";
import { sanitizeText } from "../crm/crm.privacy";
import { pickLocale, type PackageText } from "../packages/packages.shared";
import { notifyAdminsOfBookingEvent, trackAdminBackgroundTask } from "../telehealth/lib/admin-booking-notifications";
import { buildConsultationConfirmationEmail, formatRequestNumber } from "./consultation-request-email";

/**
 * Paket AH - `POST /consultation-requests`: bolum/paket bazli danisma talebi (randevu/odeme yerine). PUBLIC, oturumsuz.
 * Desen: iletisim formu (IP basina oran siniri + honeypot) ve paket talebi (CRM lead + rıza kaydi + onay e-postasi).
 * Kayit: `ConsultationRequest` + ayni transaction'da `CrmLead` (kanal CONSULTATION_REQUEST) -> admin CRM "Talepler".
 */
export const CONTACT_LANGUAGES = ["en", "de", "ar", "ru", "fr", "es", "ro", "sr-latn"] as const;
export const CONSULTATION_MESSAGE_MAX = 1000;
/** Rıza kutularindaki metnin surumu (on yuz metni degisince artirilir; ispat icin talepte saklanir). */
export const CONSULTATION_CONSENT_TEXT_VERSION = "consultation-v1";
/** Sunucu tarafi izin listesi: istemcinin gonderdigi surum bunlardan biri degilse varsayilana dusurulur (422 DEGIL). */
export const CONSULTATION_CONSENT_TEXT_VERSIONS: readonly string[] = [CONSULTATION_CONSENT_TEXT_VERSION];
/** Ayni kisi + ayni hizmet icin bu sure icindeki tekrar gonderim yeni talep acmaz. */
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
/** Posta bombasina karsi: adres basina saatte 3, site genelinde saatte en cok 50 onay e-postasi. */
const CONFIRMATIONS_PER_ADDRESS_PER_HOUR = 3;
const CONFIRMATIONS_PER_HOUR_GLOBAL = 50;
/** Yoneticiye saatte en cok 30 tekil bildirim (fazlasi panelde gorunur; e-posta gitmez). */
const ADMIN_NOTICES_PER_HOUR = 30;

const SLUG = z.string().trim().min(1).max(120);
const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD biçiminde olmalı.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value, "Geçerli bir tarih girin.");

export const ConsultationRequestBodySchema = z
  .object({
    serviceSlug: SLUG.nullable().optional(),
    packageSlug: SLUG.nullable().optional(),
    preferredFrom: dateOnly.nullable().optional(),
    preferredTo: dateOnly.nullable().optional(),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .refine((value) => COUNTRY_CODES.has(value), "Geçerli bir ülke kodu (ISO 3166-1 alpha-2) girin."),
    contactLanguage: z.enum(CONTACT_LANGUAGES),
    needsInterpreter: z.boolean(),
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(200),
    phone: z.string().trim().max(40).nullable().optional(),
    message: z.string().max(CONSULTATION_MESSAGE_MAX * 2).nullable().optional(),
    contactConsent: z.boolean(),
    healthDataConsent: z.boolean().optional().default(false),
    locale: z.string().trim().toLowerCase().regex(LOCALE_CODE_PATTERN),
    /** Honeypot - doluysa bot; basari gibi gorunur, hicbir sey yazilmaz. */
    website: z.string().max(200).optional(),
    consentTextVersion: z.string().max(200).optional().catch(undefined),
  })
  .superRefine((body, ctx) => {
    const message = cleanMessage(body.message);
    if (!body.serviceSlug && !body.packageSlug) {
      ctx.addIssue({ code: "custom", path: ["serviceSlug"], message: "Bir hizmet/bölüm ya da paket seçin." });
    }
    if (body.preferredFrom && body.preferredTo && body.preferredTo < body.preferredFrom) {
      ctx.addIssue({ code: "custom", path: ["preferredTo"], message: "Bitiş tarihi başlangıç tarihinden önce olamaz." });
    }
    if (!body.contactConsent) {
      ctx.addIssue({ code: "custom", path: ["contactConsent"], message: "İletişim için açık rıza gerekli." });
    }
    if (message.length > CONSULTATION_MESSAGE_MAX) {
      ctx.addIssue({ code: "custom", path: ["message"], message: `Mesaj en fazla ${CONSULTATION_MESSAGE_MAX} karakter olabilir.` });
    }
    if (message && !body.healthDataConsent) {
      ctx.addIssue({ code: "custom", path: ["healthDataConsent"], message: "Mesaj alanını kullanmak için sağlık bilgisi onayı gerekli." });
    }
    if (body.phone && body.phone.trim() && !normalizePhone(body.phone)) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Geçerli bir telefon numarası girin (ülke kodu ile)." });
    }
  });
export type ConsultationRequestBody = z.infer<typeof ConsultationRequestBodySchema>;

/** Mesaj: kontrol karakterleri atilir, satir sonlari korunur (en cok 2 ardisik), kirpilir. */
export function cleanMessage(value: string | null | undefined): string {
  if (!value) return "";
  return (
    value
      .replace(/\r\n?/g, "\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

export async function consultationRequestsPublicRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    "/consultation-requests",
    { config: { rateLimit: CONTACT_SUBMIT_RATE_LIMIT }, schema: { body: ConsultationRequestBodySchema } },
    async (request, reply) => {
      const body = request.body;
      // Honeypot: bota "basarisiz oldum" sinyali verilmez; hicbir sey yazilmaz, e-posta gitmez.
      if (body.website && body.website.trim().length > 0) {
        return reply.status(201).send(ok({ requestNumber: formatRequestNumber(10_000 + crypto.randomInt(90_000)) }));
      }

      const errors: Record<string, string[]> = {};
      const specialty = body.serviceSlug ? await app.prisma.specialty.findFirst({ where: { slug: body.serviceSlug, isActive: true }, select: { id: true, name: true } }) : null;
      if (body.serviceSlug && !specialty) errors.serviceSlug = ["Seçilen hizmet/bölüm bulunamadı ya da aktif değil."];
      const pkg = body.packageSlug ? await app.prisma.healthPackage.findFirst({ where: { slug: body.packageSlug, isActive: true }, select: { id: true, slug: true, translations: true } }) : null;
      if (body.packageSlug && !pkg) errors.packageSlug = ["Seçilen paket bulunamadı ya da aktif değil."];
      const email = normalizeEmail(body.email);
      if (!email) errors.email = ["Geçerli bir e-posta adresi girin."];
      if (Object.keys(errors).length > 0 || !email) throw new ValidationError("Girdi doğrulama hatası.", errors);

      // Hizmet/paket adi anlik goruntusu (EN; bolum/paket silinse de talepte gorunur).
      const packageTitle = pkg ? sanitizeText(pickLocale<PackageText>(pkg.translations, "en")?.value.title ?? pkg.slug, 160) : null;
      const serviceName = sanitizeText(packageTitle && specialty ? `${packageTitle} (${specialty.name})` : (packageTitle ?? specialty?.name ?? ""), 200);
      const phone = body.phone && body.phone.trim() ? normalizePhone(body.phone) : null;
      const message = cleanMessage(body.message);
      const fullName = sanitizeText(body.fullName, 120);
      const now = new Date();

      // Ayni kisi + ayni hizmet kisa surede yeniden gonderirse yeni talep acilmaz, e-posta tekrar gitmez.
      const duplicate = await app.prisma.consultationRequest.findFirst({
        where: {
          createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
          email,
          specialtyId: specialty?.id ?? null,
          packageId: pkg?.id ?? null,
        },
        select: { seq: true },
      });
      if (duplicate) return reply.status(201).send(ok({ requestNumber: formatRequestNumber(duplicate.seq) }));

      const requestId = crypto.randomUUID();
      const created = await app.prisma.$transaction(async (tx) => {
        const lead = await tx.crmLead.create({
          data: {
            channel: "CONSULTATION_REQUEST",
            status: "NEW",
            name: fullName,
            email,
            phone,
            country: body.country,
            language: body.contactLanguage,
            specialtyId: specialty?.id ?? null,
            specialtyName: serviceName,
            landingPath: "/request",
            sourceRefId: requestId,
            nextActionAt: now,
          },
        });
        const created = await tx.consultationRequest.create({
          data: {
            id: requestId,
            leadId: lead.id,
            specialtyId: specialty?.id ?? null,
            packageId: pkg?.id ?? null,
            serviceName,
            preferredFrom: toDate(body.preferredFrom),
            preferredTo: toDate(body.preferredTo),
            country: body.country,
            contactLanguage: body.contactLanguage,
            needsInterpreter: body.needsInterpreter,
            fullName,
            email,
            phone,
            // Mesaj saglik verisi icerebilir: yalniz saglik rizasiyla, AES-256-GCM sifreli saklanir.
            messageEncrypted: message && body.healthDataConsent ? encryptSecret(message) : null,
            contactConsentAt: now,
            // Veri minimizasyonu: saglik rizasi yalnizca mesaj yazildiysa kayda gecer.
            healthDataConsentAt: message && body.healthDataConsent ? now : null,
            consentTextVersion: body.consentTextVersion && CONSULTATION_CONSENT_TEXT_VERSIONS.includes(body.consentTextVersion) ? body.consentTextVersion : CONSULTATION_CONSENT_TEXT_VERSION,
            locale: body.locale,
            ipAddress: request.ip ?? null,
            userAgent: sanitizeText(request.headers["user-agent"], 300) || null,
          },
          select: { id: true, seq: true },
        });
        return created;
      });
      const requestNumber = formatRequestNumber(created.seq);

      // Bildirimler istegin DISINDA (arka planda) calisir; hata yutulur, yanit SMTP'yi/sayaclari beklemez.
      // Sayaclar yalniz KAYITLI talepleri sayar (honeypot hicbir sey yazmadigi icin sayaca girmez).
      const hourAgo = new Date(now.getTime() - 3_600_000);
      trackAdminBackgroundTask(
        (async () => {
          // Yonetici bildirimi (PII'siz; idempotent, yeniden denemeli). Saatlik tavan asilirsa tekil e-posta gitmez, talep panelde gorunur;
          // alicilara saatte EN FAZLA 1 "tavan asildi" uyarisi gider (eventKey saat kovasina baglidir).
          const lastHour = await app.prisma.consultationRequest.count({ where: { createdAt: { gte: hourAgo } } });
          if (lastHour <= ADMIN_NOTICES_PER_HOUR) {
            await notifyAdminsOfBookingEvent(app, { kind: "consultation_request", requestId: created.id });
          } else {
            app.log.warn({ lastHour }, "consultation_request: saatlik bildirim sınırı aşıldı; talep panelde, tekil yönetici e-postası gönderilmedi.");
            await notifyAdminsOfBookingEvent(app, { kind: "consultation_cap_reached", hourBucket: now.toISOString().slice(0, 13) });
          }

          // Ziyaretciye onay (kendi dilinde; tr -> en). Posta bombasina karsi adres ve site basina saatlik tavan.
          const [perAddress, global] = await Promise.all([
            app.prisma.consultationRequest.count({ where: { email, createdAt: { gte: hourAgo } } }),
            app.prisma.consultationRequest.count({ where: { createdAt: { gte: hourAgo } } }),
          ]);
          if (perAddress <= CONFIRMATIONS_PER_ADDRESS_PER_HOUR && global <= CONFIRMATIONS_PER_HOUR_GLOBAL) {
            // Hizmet adi onay e-postasinda YOK (yalniz talep no).
            const mail = buildConsultationConfirmationEmail({ locale: body.locale, requestNumber });
            await sendBrandedMail(app, { to: email, subject: mail.subject, preheader: mail.subject, bodyHtml: mail.html, locale: mail.locale, audience: "patient" });
          }
        })().catch((err) => app.log.warn({ err: (err as Error).message }, "Danışma talebi bildirimi/onay e-postası gönderilemedi (best-effort).")),
      );

      return reply.status(201).send(ok({ requestNumber }));
    }
  );
}
