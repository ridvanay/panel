import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { EmailSettingsSchema } from "../../schemas/entities";
import { toEmailSettingsDto } from "../../mappers";
import { logAudit } from "../../lib/audit";
import { EmailDeliveryError, ValidationError } from "../../lib/errors";
import { encryptSecret } from "../../lib/crypto";
import { maskEmail } from "../../lib/pii-mask";
import { EMAIL_SMTP_TEST_RATE_LIMIT } from "../../lib/rate-limit";
import {
  buildTransporterFromEmailSettingsRow,
  classifyEmailTestError,
  computeEffectiveEmailSource,
  getEmailTestErrorMessage,
  resetMailTransporter,
  resolveFromHeader,
  type EmailTestErrorCategory,
} from "../../lib/mail";
import { SmtpHostValidationError, validateSmtpHost } from "../../lib/smtp-host-guard";
import { EmailSettingsTestResponseSchema, UpdateEmailSettingsRequestSchema } from "./settings.schemas";

/**
 * `EmailSettings` singleton satırının id'si — `lib/mail.ts`'teki YEREL sabitle AYNI literal
 * ("singleton"), `APPEARANCE_ID`/`CUSTOM_CODE_ID` İLE AYNI desen (her modül kendi yerel sabitini
 * taşır, `.claude/architect-scope-smtp-settings.md` §1.4).
 */
export const EMAIL_SETTINGS_ID = "singleton";

const WITH_UPDATER = { include: { updatedBy: true } } as const;

async function readEmailSettingsRow(app: FastifyInstance) {
  return app.prisma.emailSettings.findUnique({ where: { id: EMAIL_SETTINGS_ID }, ...WITH_UPDATER });
}

/**
 * §3.3 (bağlayıcı) — `enabled: true` iken final `smtpHost` (istekte gönderilen VEYA mevcut
 * satırdaki) boş olamaz. "Açık ama yapılandırmasız" durumu e-postanın sessizce kaybolduğu bir
 * tuzaktır. `settings.routes.ts::assertShippingEstimateRange` İLE AYNI "çapraz alan, mevcut
 * satıra karşı doğrulama" deseni.
 */
function assertEmailEnabledHasHost(finalEnabled: boolean, finalHost: string | null): void {
  if (finalEnabled && !finalHost) {
    throw new ValidationError("`enabled: true` iken `smtpHost` boş olamaz.", {
      smtpHost: ["`enabled: true` iken `smtpHost` boş olamaz."],
    });
  }
}

const TEST_EMAIL_SUBJECT = "SMTP Yapılandırma Testi";
const TEST_EMAIL_HTML =
  "<p>Bu e-posta, admin panelinden kaydettiğiniz SMTP yapılandırmasının çalıştığını doğrulamak için gönderilmiştir.</p>";

/**
 * `/admin/settings/email` prefix'i altında bağlanır (bkz. app.ts).
 * `.claude/architect-scope-smtp-settings.md` §5 (bağlayıcı) — ÜÇ UCUN ÜÇÜ DE yalnızca
 * `SiteRole=ADMIN` (MANAGER/EDITOR → `403`, panel kapısı TEK BAŞINA YETMEZ — SMTP host/kullanıcı
 * altyapı kimlik bilgisidir, `GET /admin/settings/permissions` ile AYNI eşik).
 * `outbound-webhooks.routes.ts` İLE AYNI desen: `requirePanelAccess()` + `requireSiteRole(...ROLES_ADMIN)`
 * ikisi birden, router seviyesinde (derinlemesine savunma).
 */
export async function adminEmailSettingsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN));

  // Satır yoksa (hiç yapılandırılmamış) `422` DEĞİL, `DEFAULTS` ile doldurulmuş bir DTO döner
  // (`enabled: false`, `smtpPasswordSet: false`) — `GET /admin/settings` ile AYNI lazy-upsert deseni.
  server.get("/", { schema: { response: { 200: ApiSuccessSchema(EmailSettingsSchema) } } }, async (_request, reply) => {
    const row = await readEmailSettingsRow(app);
    const effectiveSource = computeEffectiveEmailSource(row);
    return reply.send(ok(toEmailSettingsDto(row, effectiveSource)));
  });

  server.patch(
    "/",
    { schema: { body: UpdateEmailSettingsRequestSchema, response: { 200: ApiSuccessSchema(EmailSettingsSchema) } } },
    async (request, reply) => {
      const body = request.body;
      const existing = await readEmailSettingsRow(app);

      // KARAR 2 (security-review-smtp-settings.md, bağlayıcı) — Katman A (sözdizimi) + Katman B
      // (SSRF ağ katmanı) doğrulaması, yalnızca YENİ bir host değeri gönderildiğinde çalışır
      // (mevcut, daha önce doğrulanmış bir değeri KORUMAK yeniden ağ çağrısı GEREKTİRMEZ).
      if (body.smtpHost) {
        try {
          await validateSmtpHost(body.smtpHost);
        } catch (err) {
          if (err instanceof SmtpHostValidationError) {
            throw new ValidationError(err.message, { smtpHost: [err.message] });
          }
          throw err;
        }
      }

      const finalEnabled = body.enabled !== undefined ? body.enabled : (existing?.enabled ?? false);
      const finalHost = body.smtpHost !== undefined ? body.smtpHost : (existing?.smtpHost ?? null);
      assertEmailEnabledHasHost(finalEnabled, finalHost);

      // Üç durumlu parola semantiği (KARAR 1 madde 3, bağlayıcı): alan YOK → korunur (aşağıda hiç
      // dokunulmaz); `null` → temizlenir; dolu string → `lib/crypto.ts::encryptSecret` ile
      // yeniden şifrelenir. Yer-tutucu sentinel YOKTUR.
      const data: {
        enabled?: boolean;
        smtpHost?: string | null;
        smtpPort?: number;
        smtpSecure?: boolean;
        smtpUser?: string | null;
        smtpPasswordCiphertext?: string | null;
        fromAddress?: string | null;
        fromName?: string | null;
        updatedById: string;
        lastTestedAt?: null;
        lastTestSucceeded?: null;
        lastTestError?: null;
      } = { updatedById: request.user!.id };

      if (body.enabled !== undefined) data.enabled = body.enabled;
      if (body.smtpHost !== undefined) data.smtpHost = body.smtpHost;
      if (body.smtpPort !== undefined) data.smtpPort = body.smtpPort;
      if (body.smtpSecure !== undefined) data.smtpSecure = body.smtpSecure;
      if (body.smtpUser !== undefined) data.smtpUser = body.smtpUser;
      if (body.smtpPassword !== undefined) {
        data.smtpPasswordCiphertext = body.smtpPassword === null ? null : encryptSecret(body.smtpPassword);
      }
      if (body.fromAddress !== undefined) data.fromAddress = body.fromAddress;
      if (body.fromName !== undefined) data.fromName = body.fromName;

      // qa-agent bulgusu: bir önceki `POST .../test` sonucu (`lastTestedAt`/`lastTestSucceeded`/
      // `lastTestError`), artık test EDİLMEMİŞ bir konfigürasyona ait kaldığında panelde yanıltıcı
      // "son test: ... başarısız" mesajı olarak asılı kalıyordu. `smtpHost` DEĞİŞİYORSA (eski
      // değerden farklı — `null`'a çekilmek DAHİL) VEYA bu PATCH `enabled: false` yapıyorsa, eski
      // sonuç artık geçerli konfigürasyonu YANSITMAZ → üç kolon da `null`'a sıfırlanır. Mevcut
      // değeri KORUYAN (`body.smtpHost === undefined`) veya AYNI değere set eden PATCH'ler ile
      // yalnızca `enabled: true` yapan PATCH'ler bu sıfırlamayı TETİKLEMEZ.
      const hostChanged = body.smtpHost !== undefined && body.smtpHost !== (existing?.smtpHost ?? null);
      const disablingNow = body.enabled === false;
      if (hostChanged || disablingNow) {
        data.lastTestedAt = null;
        data.lastTestSucceeded = null;
        data.lastTestError = null;
      }

      const row = await app.prisma.emailSettings.upsert({
        where: { id: EMAIL_SETTINGS_ID },
        create: { id: EMAIL_SETTINGS_ID, ...data },
        update: data,
        ...WITH_UPDATER,
      });

      // KARAR 5 (bağlayıcı) — yalnızca değişen alan ADLARI (dış API adı `smtpPassword`, iç şema
      // adı `smtpPasswordCiphertext` DEĞİL — `Object.keys(body)` zaten dış API adlarını taşır).
      // `enabled` İSTİSNASI dışında (boolean, `demoPaymentsEnabled` presedanıyla AYNI sınıf)
      // hiçbir DEĞER (ciphertext DAHİL) yazılmaz.
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "settings.email_update",
        targetType: "EmailSettings",
        targetId: EMAIL_SETTINGS_ID,
        metadata: {
          changed: Object.keys(body),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        },
        ipAddress: request.ip,
      });

      // §3.4 (bağlayıcı) — başarılı PATCH sonrası transporter önbelleği geçersizleştirilir (aynı
      // süreçte anında etki için; parmak izi karşılaştırması diğer pod'lar için asıl garantidir).
      resetMailTransporter();

      const effectiveSource = computeEffectiveEmailSource(row);
      return reply.send(ok(toEmailSettingsDto(row, effectiveSource)));
    }
  );

  server.post(
    "/test",
    { config: { rateLimit: EMAIL_SMTP_TEST_RATE_LIMIT }, schema: { response: { 200: ApiSuccessSchema(EmailSettingsTestResponseSchema) } } },
    async (request, reply) => {
      // §4.3.2/§4.3.3 (bağlayıcı) — KAYDEDİLMİŞ satır test edilir, istek gövdesi `to` KABUL ETMEZ.
      // `enabled: false` iken de çalışır; yalnızca `smtpHost` boşsa `422`.
      const existing = await app.prisma.emailSettings.findUnique({ where: { id: EMAIL_SETTINGS_ID } });
      if (!existing?.smtpHost) {
        throw new ValidationError("Test edilecek bir SMTP yapılandırması yok. Önce `smtpHost` alanını kaydedin.", {
          smtpHost: ["`smtpHost` boş."],
        });
      }

      const testedAt = new Date();
      let category: EmailTestErrorCategory | null = null;
      let messageId: string | null = null;

      try {
        // Katman B (SSRF) HER transporter kurulumunda tekrar çalıştırılır (KARAR 2.5) — bu
        // fonksiyonun İÇİNDE. `transporter.verify()` TEK BAŞINA yeterli değildir (bazı
        // sağlayıcılar yalnızca `MAIL FROM` aşamasında reddeder), bu yüzden gerçek bir gönderim
        // de ardışık çalıştırılır (§4.2/§4.3).
        const transporter = await buildTransporterFromEmailSettingsRow(existing);
        await transporter.verify();
        const info = await transporter.sendMail({
          from: resolveFromHeader(existing),
          to: request.user!.email,
          subject: TEST_EMAIL_SUBJECT,
          html: TEST_EMAIL_HTML,
        });
        messageId = String(info.messageId);
      } catch (err) {
        // KARAR 3 (bağlayıcı) — ham hata (`err.message`/`err.code`/SMTP sunucu yanıtı/stack)
        // istemciye ASLA sızmaz; yalnızca 6 kaba, sabit-mesajlı kovadan biri kullanılır.
        category = classifyEmailTestError(err);
      }

      const succeeded = category === null;
      const errorMessage = category ? getEmailTestErrorMessage(category) : null;

      await app.prisma.emailSettings.update({
        where: { id: EMAIL_SETTINGS_ID },
        data: { lastTestedAt: testedAt, lastTestSucceeded: succeeded, lastTestError: errorMessage },
      });

      // KARAR 5 — alıcı adresi ve ham hata YAZILMAZ, yalnızca sonuç + (varsa) kova adı.
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "settings.email_test",
        targetType: "EmailSettings",
        targetId: EMAIL_SETTINGS_ID,
        metadata: { succeeded, ...(category ? { errorCategory: category } : {}) },
        ipAddress: request.ip,
      });

      if (!succeeded) {
        throw new EmailDeliveryError(errorMessage ?? "E-posta gönderimi başarısız oldu.");
      }

      // `sentTo` maskelidir (`lib/pii-mask.ts::maskEmail`, §5 sözleşme tablosu). `previewUrl` bu
      // uçta HER ZAMAN `null`dır — KAYDEDİLMİŞ satır testi asla Ethereal kullanmaz (Ethereal
      // yalnızca `lib/mail.ts`'in §3.1 öncelik zincirinin env/dev-fallback dalına aittir).
      return reply.send(
        ok({
          sentTo: maskEmail(request.user!.email),
          messageId,
          previewUrl: null,
          testedAt: testedAt.toISOString(),
        })
      );
    }
  );
}
