import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/errors";
import { LOCALE_CODE_PATTERN } from "../../lib/localization";
import { CONTACT_SUBMIT_RATE_LIMIT } from "../../lib/rate-limit";
import { dialCodeFor } from "../../lib/country-codes";
import { generateOpaqueToken, hashToken } from "../../lib/tokens";
import { timingSafeEqualHex } from "../../lib/api-key";
import { sanitizeText } from "../crm/crm.privacy";
import { assertSameSiteOrigin } from "../crm/crm.public.routes";
import {
  MATCHER_FREE_TEXT_MAX,
  MATCHER_MAX_TOPICS,
  detectRedFlagsInText,
  incrementMatcherStat,
  incrementUnmatchedTerm,
  loadActiveTopics,
  parseMatcherSettings,
  readTelehealthSettingsRaw,
  recommend,
  recommendCached,
  topicTextFor,
  unmatchedTerms,
} from "./matcher.service";
import { notifyMatcherLead, sendMatcherConfirmation } from "./matcher-notifications";

/**
 * Paket W — herkese açık eşleştirme uçları (`/matcher`). Kişisel veri YALNIZCA `POST /submit` ile
 * gelir; `recommend` yalnızca konu kimlikleri ve tercihleri alır, hiçbir şey kaydetmez (yalnızca
 * anonim konu sayacı). Sağlık alanları ancak sağlık verisi açık rızası varsa yazılır.
 */

const localeCode = z.string().trim().toLowerCase().regex(LOCALE_CODE_PATTERN, "Geçersiz dil kodu.");
const timeZoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Geçersiz saat dilimi.");

export const MATCHER_DURATIONS = ["lt1w", "1to4w", "1to6m", "gt6m"] as const;
export const MATCHER_PRIOR_DIAGNOSIS = ["yes", "no", "unknown"] as const;
export const MATCHER_PREFERENCES = ["online", "in_person", "either"] as const;
export const MATCHER_STEPS = ["1", "2", "3", "4", "5", "red_flag", "red_flag_continue", "no_match"] as const;

const uniqueIds = (ids: string[]) => new Set(ids).size === ids.length;
const TopicIdsSchema = z.array(z.string().uuid()).max(MATCHER_MAX_TOPICS).refine(uniqueIds, "Aynı konu iki kez seçilemez.");
const RequiredTopicIdsSchema = z.array(z.string().uuid()).min(1).max(MATCHER_MAX_TOPICS).refine(uniqueIds, "Aynı konu iki kez seçilemez.");

const RecommendBodySchema = z
  .object({
    topicIds: RequiredTopicIdsSchema,
    preferredLanguage: localeCode,
    locale: localeCode,
    preference: z.enum(MATCHER_PREFERENCES).optional(),
  })
  .strict();

const SubmitBodySchema = z
  .object({
    /** Honeypot — insanlar görmez; doluysa sahte başarı döner, hiçbir şey yazılmaz. */
    website: z.string().max(200).optional(),
    locale: localeCode,
    name: z.string().trim().min(2).max(120),
    age: z.number().int().min(0).max(120).optional(),
    birthYear: z.number().int().min(1900).max(2100).optional(),
    guardianName: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().toLowerCase().email().max(200).optional(),
    phoneCountry: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
    phoneNumber: z.string().trim().max(30).optional(),
    country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
    timeZone: timeZoneSchema.optional(),
    forWhom: z.enum(["self", "relative"]),
    duration: z.enum(MATCHER_DURATIONS).optional(),
    priorDiagnosis: z.enum(MATCHER_PRIOR_DIAGNOSIS).optional(),
    preference: z.enum(MATCHER_PREFERENCES),
    preferredLanguage: localeCode,
    topicIds: TopicIdsSchema.default([]),
    freeText: z.string().max(MATCHER_FREE_TEXT_MAX * 2).optional(),
    redFlagAcknowledged: z.boolean().default(false),
    consentHealth: z.boolean(),
    consentContact: z.boolean(),
    callback: z.boolean().default(false),
  })
  .strict();

const SubmitResultSchema = z.object({ id: z.string(), number: z.number().int(), token: z.string() });

const CallbackBodySchema = z.object({ token: z.string().min(16).max(200), consentContact: z.literal(true) }).strict();

/** Ülke kodu + numara → E.164 (`+905321234567`); geçersizse `null`. */
export function toE164(countryCode: string, number: string): string | null {
  const dial = dialCodeFor(countryCode);
  if (!dial) return null;
  let digits = number.replace(/[\s().-]/g, "");
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
    if (!digits.startsWith(dial)) return null;
    digits = digits.slice(dial.length);
  } else if (digits.startsWith("00" + dial)) {
    digits = digits.slice(2 + dial.length);
  }
  digits = digits.replace(/^0+/, "");
  if (!/^\d+$/.test(digits)) return null;
  const e164 = `+${dial}${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/**
 * Serbest metin: HTML etiketleri ve kontrol karakterleri atılır; e-posta, telefon ve 11 haneli kimlik
 * numarası benzeri diziler "[…]" ile maskelenir (veri minimizasyonu); 500 karakterle sınırlanır.
 */
export function cleanFreeText(value: string | undefined): string {
  if (!value) return "";
  const withoutTags = value.replace(/<[^>]*>/g, " ").replace(/[<>]/g, " ");
  const masked = withoutTags
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[…]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[…]");
  return sanitizeText(masked, MATCHER_FREE_TEXT_MAX);
}

export function ageBandFor(age: number): string {
  if (age < 18) return "0-17";
  if (age < 30) return "18-29";
  if (age < 45) return "30-44";
  if (age < 60) return "45-59";
  if (age < 75) return "60-74";
  return "75+";
}

export async function matcherPublicRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  // Güvenlik incelemesi — herkese açık POST'lar YALNIZCA kendi sitemizden (CRM toplama ucuyla aynı kural);
  // gövde doğrulamasından önce çalışır.
  server.addHook("onRequest", async (request) => {
    if (request.method === "POST") assertSameSiteOrigin(request);
  });

  /** Katalog (aktif dil + EN eş anlamlıları); kırmızı bayrakların TÜM dillerdeki terimleri (serbest metin denetimi). */
  server.get(
    "/topics",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } }, schema: { querystring: z.object({ lang: localeCode.default("en") }) } },
    async (request, reply) => {
      const lang = request.query.lang;
      const [topics, raw] = await Promise.all([loadActiveTopics(app), readTelehealthSettingsRaw(app)]);
      const settings = parseMatcherSettings(raw);
      const items = topics.map((topic) => {
        const text = topicTextFor(topic.translations, lang);
        const en = topic.translations.en;
        const synonyms = topic.isRedFlag
          ? [...new Set(Object.values(topic.translations).flatMap((tr) => [tr.label, ...tr.synonyms]))]
          : [...new Set([...text.synonyms, ...(en && lang !== "en" ? [en.label, ...en.synonyms] : [])])];
        return { id: topic.id, slug: topic.slug, bodyArea: topic.bodyArea, isRedFlag: topic.isRedFlag, label: text.label, description: text.description, synonyms };
      });
      return reply.header("cache-control", "public, max-age=60").send(ok({ contactRequired: settings.contactRequired, topics: items }));
    }
  );

  /** Öneri — kişisel veri ALMAZ, kaydetmez (yalnızca anonim konu sayacı). */
  server.post(
    "/recommend",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { body: RecommendBodySchema } },
    async (request, reply) => {
      const { result, cached } = await recommendCached(app, { topicIds: request.body.topicIds, preferredLanguage: request.body.preferredLanguage, locale: request.body.locale });
      // Sayaç şişirmeye karşı yalnızca önbellek ıskasında artar (60 sn içindeki tekrarlar sayılmaz).
      if (!cached) {
        for (const slug of result.topicSlugs) await incrementMatcherStat(app, "topic", slug);
        if (result.redFlag) await incrementMatcherStat(app, "red_flag", "selected");
      }
      return reply.send(ok(result));
    }
  );

  /** Adım sayacı (anonim; kişi/oturum kimliği yok) — "adım bazında terk oranı" raporu için. */
  server.post(
    "/progress",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } }, schema: { body: z.object({ step: z.enum(MATCHER_STEPS) }).strict(), response: { 204: z.undefined() } } },
    async (request, reply) => {
      const step = request.body.step;
      if (step === "red_flag" || step === "red_flag_continue") await incrementMatcherStat(app, "red_flag", step === "red_flag" ? "shown" : "continued");
      else await incrementMatcherStat(app, "step", step);
      return reply.code(204).send();
    }
  );

  server.post(
    "/submit",
    { config: { rateLimit: CONTACT_SUBMIT_RATE_LIMIT }, schema: { body: SubmitBodySchema, response: { 201: ApiSuccessSchema(SubmitResultSchema) } } },
    async (request, reply) => {
      const body = request.body;
      // Honeypot: bot'a başarı gibi görünür (gerçekçi sahte numara), hiçbir şey yazılmaz/gönderilmez.
      if (body.website && body.website.trim().length > 0) {
        return reply.status(201).send(ok({ id: crypto.randomUUID(), number: 1000 + crypto.randomInt(9000), token: generateOpaqueToken() }));
      }

      const errors: Record<string, string[]> = {};
      const phone = body.phoneNumber && body.phoneNumber.trim() ? (body.phoneCountry ? toE164(body.phoneCountry, body.phoneNumber) : null) : undefined;
      if (phone === null) errors.phoneNumber = ["Geçerli bir telefon numarası girin (ülke kodu ile)."];
      if (!body.email && !phone) errors.email = ["E-posta ya da telefon numarasından en az birini girin."];
      // Doğum yılı verilmişse yaş ondan türetilir; ikisi birden ve tutarsızsa reddedilir (18 yaş altı kuralı atlatılamaz).
      const yearAge = body.birthYear ? new Date().getUTCFullYear() - body.birthYear : undefined;
      if (body.age !== undefined && yearAge !== undefined && Math.abs(body.age - yearAge) > 1) errors.age = ["Yaş ile doğum yılı uyuşmuyor."];
      const age = yearAge ?? body.age;
      if (age === undefined) errors.age = ["Yaş ya da doğum yılı gerekli."];
      if (age !== undefined && (age < 0 || age > 120)) errors.age = ["Geçersiz yaş."];
      if (age !== undefined && age < 18 && !body.guardianName) errors.guardianName = ["18 yaş altı için veli/vasi adı gerekli."];
      const freeText = cleanFreeText(body.freeText);
      if (Object.keys(errors).length > 0) throw new ValidationError("Girdi doğrulama hatası.", errors);

      // Kırmızı bayrak: seçilen konu ya da serbest metin. "Acil değil, devam et" onayı olmadan kayıt yok.
      const topics = await loadActiveTopics(app);
      const known = new Set(topics.map((t) => t.id));
      const topicIds = body.topicIds.filter((id) => known.has(id));
      const selectedRedFlag = topics.some((t) => t.isRedFlag && topicIds.includes(t.id));
      const textRedFlags = freeText ? await detectRedFlagsInText(app, freeText) : [];
      if ((selectedRedFlag || textRedFlags.length > 0) && !body.redFlagAcknowledged) {
        throw new ValidationError("Acil durum uyarısı onaylanmadan devam edilemez.", { redFlag: ["ACK_REQUIRED"] });
      }

      const now = new Date();
      const healthAllowed = body.consentHealth;
      // Öneri sunucuda yeniden hesaplanır (istemciye güvenilmez); yalnızca sağlık rızası varsa saklanır.
      // Kırmızı bayrak (onaylanmış) konuları öneriye girmez; kalan konularla hesaplanır.
      const recTopicIds = topicIds.filter((id) => !topics.some((t) => t.id === id && t.isRedFlag));
      const rec =
        healthAllowed && recTopicIds.length > 0 ? await recommend(app, { topicIds: recTopicIds, preferredLanguage: body.preferredLanguage, locale: body.locale }, now) : null;
      const topSpecialty = rec?.specialties[0] ?? null;
      const topDoctor = rec?.doctors[0] ?? null;

      const submissionId = crypto.randomUUID();
      const rawToken = generateOpaqueToken();
      const { lead, submission } = await app.prisma.$transaction(async (tx) => {
        const lead = await tx.crmLead.create({
          data: {
            channel: "MATCHER",
            status: "NEW",
            name: sanitizeText(body.name, 120),
            email: body.email ?? null,
            phone: phone ?? null,
            country: body.country ?? null,
            language: body.locale,
            specialtyId: topSpecialty?.id ?? null,
            specialtyName: topSpecialty?.name ?? null,
            doctorId: topDoctor?.id ?? null,
            doctorName: topDoctor?.displayName ?? null,
            landingPath: "/find-a-physician",
            sourceRefId: submissionId,
            nextActionAt: body.callback ? now : null,
          },
        });
        const submission = await tx.matcherSubmission.create({
          data: {
            id: submissionId,
            leadId: lead.id,
            // Sağlık alanları yalnızca açık rızayla.
            topicIds: healthAllowed ? topicIds : [],
            freeText: healthAllowed && freeText ? freeText : null,
            ageBand: healthAllowed && age !== undefined ? ageBandFor(age) : null,
            // Veri minimizasyonu (uyumluluk incelemesi): doğum yılı saklanmaz, yalnızca yaş aralığı.
            birthYear: null,
            guardianName: age !== undefined && age < 18 && body.guardianName ? sanitizeText(body.guardianName, 120) : null,
            forWhom: body.forWhom,
            duration: healthAllowed ? (body.duration ?? null) : null,
            priorDiagnosis: healthAllowed ? (body.priorDiagnosis ?? null) : null,
            preference: body.preference,
            preferredLanguage: body.preferredLanguage,
            country: body.country ?? null,
            timeZone: body.timeZone ?? null,
            recommendedSpecialtyIds: rec ? rec.specialties.map((s) => s.id) : [],
            recommendedDoctorIds: rec ? rec.doctors.map((d) => d.id) : [],
            redFlagAcknowledgedAt: body.redFlagAcknowledged && (selectedRedFlag || textRedFlags.length > 0) ? now : null,
            consentHealthAt: healthAllowed ? now : null,
            consentContactAt: body.consentContact ? now : null,
            callbackRequestedAt: body.callback ? now : null,
            accessTokenHash: hashToken(rawToken),
          },
        });
        return { lead, submission };
      });

      if (healthAllowed && freeText) for (const term of await unmatchedTerms(app, freeText)) await incrementUnmatchedTerm(app, term);
      if (textRedFlags.length > 0) await incrementMatcherStat(app, "red_flag", "free_text");

      await notifyMatcherLead(app, { number: submission.seq, leadId: lead.id });
      // Posta bombasına karşı aynı adrese saatte en çok 3 onay e-postası (talep yine kaydedilir).
      if (body.email) {
        const recent = await app.prisma.crmLead.count({ where: { channel: "MATCHER", email: body.email, createdAt: { gte: new Date(now.getTime() - 3600_000) } } });
        if (recent <= 3) await sendMatcherConfirmation(app, { to: body.email, locale: body.locale, number: submission.seq, contactAllowed: body.consentContact });
      }

      return reply.status(201).send(ok({ id: submission.id, number: submission.seq, token: rawToken }));
    }
  );

  /** "Koordinatör beni arasın" — gönderimde verilen erişim anahtarıyla (IDOR yok); idempotent. */
  server.post(
    "/submissions/:id/callback",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { params: z.object({ id: z.string().uuid() }), body: CallbackBodySchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const submission = await app.prisma.matcherSubmission.findUnique({
        where: { id: request.params.id },
        select: { id: true, leadId: true, accessTokenHash: true, anonymizedAt: true, callbackRequestedAt: true },
      });
      if (!submission || !submission.accessTokenHash || !timingSafeEqualHex(hashToken(request.body.token), submission.accessTokenHash)) {
        throw new NotFoundError("Talep bulunamadı.");
      }
      if (submission.anonymizedAt) throw new ConflictError("Bu talep artık güncellenemez.");
      // İdempotent: zaten istenmişse yeniden yazılmaz.
      if (submission.callbackRequestedAt) return reply.code(204).send();
      const now = new Date();
      await app.prisma.$transaction([
        app.prisma.matcherSubmission.update({ where: { id: submission.id }, data: { callbackRequestedAt: now, consentContactAt: now } }),
        app.prisma.crmLead.update({ where: { id: submission.leadId }, data: { nextActionAt: now } }),
      ]);
      return reply.code(204).send();
    }
  );
}
