/**
 * §10.3 / §10.16 E-posta & Bildirim Şablonu Yöneticisi — DB'deki `EmailTemplate` kayıtlarını
 * gerçekten göndermek için kullanılan servis katmanı. Şablonun kendisi email-templates.routes.ts
 * üzerinden admin panelde CRUD + preview edilir; BU dosya şablonu TÜKETEN taraftır
 * (auth.service.ts, stripe.routes.ts, invitations.routes.ts, contact modülü).
 *
 * §10.16.3 BREAKING (bilinçli): `sendTemplateEmail`'in ikinci parametresi ARTIK `key` DEĞİL,
 * `purpose`'tur — çözümleme `findFirst({ where: { purpose, isActive: true } })` ile yapılır.
 * Beş sistem amacının (`WELCOME`/`PASSWORD_RESET`/`SYSTEM_ANNOUNCEMENT`/`ORDER_CONFIRMATION`/
 * `ORG_INVITATION`) değerleri eski `key` string'leriyle BİREBİR aynı olduğundan mevcut çağrı
 * yerleri (stripe.routes.ts, invitations.routes.ts) KOD DEĞİŞİKLİĞİ GEREKTİRMEZ.
 */
import type { FastifyInstance } from "fastify";
import type { EmailTemplateEditorMode, EmailTemplatePurpose, SiteSettings } from "@prisma/client";
import { sendMail, type SendMailResult } from "../../lib/mail";
import { renderTemplate } from "../../lib/template-render";
import { renderComplianceFooterFragment, renderEmailBlocksToHtml, type EmailRenderContext } from "../../lib/email-renderer";
import { resolveTemplateVariables, type EmailCustomVariable } from "../../lib/email-variables";
import { NotFoundError } from "../../lib/errors";
import { env } from "../../config/env";
import { getLocaleSet } from "../../lib/localization";
import { DEFAULTS, SETTINGS_ID } from "../settings/settings.routes";

/**
 * DB'den bağımsız (site adı/logo/hukuki sayfa linkleri) render bağlamını kurar — hem
 * `sendTemplateEmail` (BLOCKS modu) hem önizleme/test-gönderimi (`renderTemplatePreviewOrTest`)
 * TARAFINDAN paylaşılır. `prefetchedSettings` verilirse (çağıran taraf zaten okuduysa) ekstra
 * bir `siteSettings` sorgusu YAPILMAZ.
 */
export async function buildEmailRenderContext(
  app: FastifyInstance,
  prefetchedSettings?: SiteSettings | null
): Promise<EmailRenderContext> {
  const [settings, legalPages, localeSet] = await Promise.all([
    prefetchedSettings !== undefined ? Promise.resolve(prefetchedSettings) : app.prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } }),
    // §10.16.4 KVKK footer — YAYINLANMIŞ, ÇÖPTE OLMAYAN hukuki belgeler.
    app.prisma.page.findMany({
      where: { isLegalDocument: true, status: "PUBLISHED", deletedAt: null },
      select: { title: true, slug: true },
      orderBy: { seq: "asc" },
    }),
    getLocaleSet(app),
  ]);

  if (legalPages.length === 0) {
    app.log.warn(
      "E-posta KVKK footer'ı için yayınlanmış hiçbir hukuki belge (Page.isLegalDocument) bulunamadı — footer yalnızca site adını basacak (§10.16.4)."
    );
  }

  const defaultLocaleCode = localeSet.default.code;

  return {
    siteName: settings?.siteName ?? DEFAULTS.siteName,
    siteUrl: env.FRONTEND_URL,
    logoUrl: settings?.logoUrl ?? null,
    legalPages: legalPages.map((page) => ({
      title: page.title,
      url: `${env.FRONTEND_URL}/${defaultLocaleCode}/${page.slug}`,
    })),
  };
}

/**
 * Kaydedilmiş bir `EmailTemplate` SATIRINI (amaç/aktiflik çözümlemesi ÇAĞIRANIN işidir) `values`
 * içindeki değişkenlerle render edip GERÇEKTEN gönderir. `sendTemplateEmail` (amaca göre çözümler)
 * VE `modules/contact/contact.service.ts` (formda AÇIKÇA seçilmiş belirli bir şablon satırını
 * kullanabilir — amacın o an aktif şablonu OLMAYABİLİR, bkz. ARCHITECTURE.md §10.16.7
 * `ContactForm.notificationTemplateId`) TARAFINDAN PAYLAŞILIR.
 *
 * Değişken allow-list'i `lib/email-variables.ts` registry'sinden gelir (enjeksiyon riskine karşı
 * yalnızca izin verilen anahtarlar basılır, bkz. `lib/template-render.ts`). `site_name`/`site_url`
 * HER ÇAĞRIDA otomatik enjekte edilir (çağıranın göndermesine gerek yok, §10.16.5).
 *
 * ÖNİZLEME/TEST GÖNDERİMİNDEN FARKI (bilinçli): burada eksik bir değişken için ÖRNEK DEĞERE
 * (`sampleValue`) DÜŞÜLMEZ — sağlanmayan bir değişken `renderTemplate` tarafından OLDUĞU GİBİ
 * (`{{key}}`) bırakılır. Gerçek bir kullanıcıya/ziyaretçiye sahte bir örnek değerle e-posta
 * gitmesi KABUL EDİLEMEZ.
 */
export async function sendEmailUsingTemplateRow(
  app: FastifyInstance,
  template: { purpose: EmailTemplatePurpose; editorMode: EmailTemplateEditorMode; subject: string; bodyHtml: string; blocks: unknown; customVariables: unknown },
  to: string,
  values: Record<string, string>
): Promise<SendMailResult> {
  const definitions = await resolveTemplateVariables(app, template.purpose, (template.customVariables as unknown as EmailCustomVariable[]) ?? []);
  const allowedKeys = definitions.map((v) => v.key);

  const settings = await app.prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } });
  const mergedValues: Record<string, string> = {
    ...values,
    site_name: settings?.siteName ?? DEFAULTS.siteName,
    site_url: env.FRONTEND_URL,
  };

  const subject = renderTemplate(template.subject, mergedValues, allowedKeys);
  // Uyum footer'ı (§10.16.4) editorMode'dan BAĞIMSIZ olarak zorunludur — RAW modu (5 sistem
  // şablonu: WELCOME/PASSWORD_RESET/SYSTEM_ANNOUNCEMENT/ORDER_CONFIRMATION/ORG_INVITATION)
  // `renderEmailBlocksToHtml`'i hiç çağırmadığı için footer'ı AYRICA eklemek gerekir — aksi halde
  // en sık gönderilen sistem e-postaları hiçbir zaman hukuki sayfa/site adı linki taşımazdı.
  const context = await buildEmailRenderContext(app, settings);
  const html =
    template.editorMode === "RAW"
      ? renderTemplate(template.bodyHtml, mergedValues, allowedKeys) + renderComplianceFooterFragment(context)
      : renderTemplate(renderEmailBlocksToHtml((template.blocks as unknown[]) ?? [], context), mergedValues, allowedKeys);

  return sendMail(app, { to, subject, html });
}

/**
 * §10.16.3 — `purpose`'a göre AKTİF şablonu çözümleyip gönderir (`findFirst({ where: { purpose,
 * isActive: true } })`). Sistem tetikleyicilerinin (auth.service.ts, stripe.routes.ts,
 * invitations.routes.ts) TÜMÜ bunu kullanır.
 */
export async function sendTemplateEmail(
  app: FastifyInstance,
  purpose: EmailTemplatePurpose,
  to: string,
  values: Record<string, string>
): Promise<SendMailResult> {
  const template = await app.prisma.emailTemplate.findFirst({ where: { purpose, isActive: true } });
  if (!template) {
    // prisma/seed.ts WELCOME/PASSWORD_RESET/SYSTEM_ANNOUNCEMENT/ORDER_CONFIRMATION/ORG_INVITATION'ı
    // her zaman garanti eder; buraya düşülmesi ortamın seed edilmediğine işaret eder — sessizce
    // yutmuyoruz.
    throw new NotFoundError(`Aktif e-posta şablonu bulunamadı (amaç: ${purpose}).`);
  }

  return sendEmailUsingTemplateRow(app, template, to, values);
}

export interface RenderTemplatePreviewInput {
  purpose: EmailTemplatePurpose;
  editorMode: EmailTemplateEditorMode;
  subject: string;
  bodyHtml?: string;
  blocks?: unknown[];
  customVariables?: EmailCustomVariable[];
}

export interface RenderedEmailTemplate {
  renderedSubject: string;
  renderedHtml: string;
}

/**
 * §10.16.6 — hem `POST .../preview` (durumsuz taslak) hem `POST .../{templateId}/test-send`
 * (kaydedilmiş satır) TARAFINDAN paylaşılır. `sendTemplateEmail`'in AKSİNE, sağlanmayan HER
 * değişken için registry'deki `sampleValue`'ya (ya da `site_name`/`site_url` için GERÇEK site
 * bağlamına) düşülür — kullanıcı "örnek verilerle dolu" bir önizleme/test e-postası görür.
 */
export async function renderTemplatePreviewOrTest(
  app: FastifyInstance,
  input: RenderTemplatePreviewInput,
  overrideValues: Record<string, string> = {}
): Promise<RenderedEmailTemplate> {
  const definitions = await resolveTemplateVariables(app, input.purpose, input.customVariables ?? []);
  const context = await buildEmailRenderContext(app);

  const values: Record<string, string> = {};
  for (const definition of definitions) {
    if (definition.key === "site_name") {
      values[definition.key] = context.siteName;
    } else if (definition.key === "site_url") {
      values[definition.key] = context.siteUrl;
    } else {
      values[definition.key] = overrideValues[definition.key] ?? definition.sampleValue;
    }
  }

  const allowedKeys = definitions.map((d) => d.key);
  // RAW modu için de uyum footer'ı eklenir (bkz. `sendEmailUsingTemplateRow` üzerindeki not) —
  // aksi halde önizleme, gerçekte gönderilecek olandan (footer'sız) daha eksik gösterirdi.
  const html =
    input.editorMode === "RAW"
      ? (input.bodyHtml ?? "") + renderComplianceFooterFragment(context)
      : renderEmailBlocksToHtml(input.blocks ?? [], context);

  return {
    renderedSubject: renderTemplate(input.subject, values, allowedKeys),
    renderedHtml: renderTemplate(html, values, allowedKeys),
  };
}

/** Kayıt (register) akışı sonrasında gönderilen karşılama maili — bkz. auth.service.ts::register. */
export async function sendWelcomeEmail(
  app: FastifyInstance,
  user: { email: string; name: string }
): Promise<SendMailResult> {
  return sendTemplateEmail(app, "WELCOME", user.email, {
    user_name: user.name,
    login_url: `${env.FRONTEND_URL}/login`,
  });
}

/** Şifre sıfırlama maili — bkz. auth.service.ts::forgotPassword. */
export async function sendPasswordResetEmail(
  app: FastifyInstance,
  user: { email: string; name: string },
  resetUrl: string
): Promise<SendMailResult> {
  return sendTemplateEmail(app, "PASSWORD_RESET", user.email, {
    user_name: user.name,
    reset_link: resetUrl,
  });
}

export interface SystemAnnouncementResult {
  sent: string[];
  failed: { userId: string; error: string }[];
}

/**
 * Sistem duyurusu — bir grup kullanıcıya SYSTEM_ANNOUNCEMENT amaçlı aktif şablonla toplu
 * e-posta gönderir. Şu an hiçbir route/cron bu fonksiyonu TETİKLEMİYOR — bu tur kapsamında
 * admin panelde "duyuru gönder" butonu istenmedi, yalnızca gönderim altyapısının çalıştığı
 * kanıtlanması istendi.
 *
 * Kısmi başarısızlıkta tüm işlemi durdurmaz: her kullanıcı için ayrı ayrı dener, sonuçları toplu
 * döner ki çağıran taraf (gelecekteki route) hangi adreslerin başarısız olduğunu görüp
 * kullanıcıya/audit log'a yansıtabilsin.
 */
export async function sendSystemAnnouncement(
  app: FastifyInstance,
  userIds: string[],
  variables: { title: string; body: string }
): Promise<SystemAnnouncementResult> {
  const users = await app.prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, name: true },
  });

  const sent: string[] = [];
  const failed: { userId: string; error: string }[] = [];

  for (const user of users) {
    try {
      await sendTemplateEmail(app, "SYSTEM_ANNOUNCEMENT", user.email, {
        user_name: user.name,
        announcement_title: variables.title,
        announcement_body: variables.body,
      });
      sent.push(user.id);
    } catch (err) {
      // sendTemplateEmail -> sendMail zaten app.log.error ile stack'i loglar; burada sadece
      // hangi kullanıcı için başarısız olduğunu ayrıca işaretliyoruz (hassas veri yok).
      failed.push({ userId: user.id, error: err instanceof Error ? err.message : "Bilinmeyen hata." });
    }
  }

  return { sent, failed };
}
