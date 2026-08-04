/**
 * §10.3 E-posta & Bildirim Şablonu Yöneticisi — DB'deki `EmailTemplate` kayıtlarını gerçekten
 * göndermek için kullanılan servis katmanı. Şablonun kendisi email-templates.routes.ts üzerinden
 * admin panelde CRUD + preview edilir; BU dosya ise şablonu tüketen taraf (auth.service.ts vb.).
 */
import type { FastifyInstance } from "fastify";
import { sendMail, type SendMailResult } from "../../lib/mail";
import { renderTemplate } from "../../lib/template-render";
import { NotFoundError } from "../../lib/errors";
import { env } from "../../config/env";

/**
 * DB'deki bir `EmailTemplate` kaydını (key ile) `values` içindeki değişkenlerle render edip
 * gerçekten gönderir. Değişken allow-list'i şablonun kendi `availableVariables` alanından gelir
 * (bkz. lib/template-render.ts — enjeksiyon riskine karşı yalnızca izin verilen anahtarlar basılır).
 */
export async function sendTemplateEmail(
  app: FastifyInstance,
  key: string,
  to: string,
  values: Record<string, string>
): Promise<SendMailResult> {
  const template = await app.prisma.emailTemplate.findUnique({ where: { key } });
  if (!template) {
    // prisma/seed.ts WELCOME/PASSWORD_RESET/SYSTEM_ANNOUNCEMENT'i her zaman garanti eder;
    // buraya düşülmesi ortamın seed edilmediğine işaret eder — sessizce yutmuyoruz.
    throw new NotFoundError(`E-posta şablonu bulunamadı: ${key}`);
  }

  const allowedKeys = (template.availableVariables as string[]) ?? [];
  const subject = renderTemplate(template.subject, values, allowedKeys);
  const html = renderTemplate(template.bodyHtml, values, allowedKeys);

  return sendMail(app, { to, subject, html });
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
 * Sistem duyurusu — bir grup kullanıcıya SYSTEM_ANNOUNCEMENT şablonuyla toplu e-posta gönderir.
 * Şu an hiçbir route/cron bu fonksiyonu TETİKLEMİYOR — bu tur kapsamında admin panelde "duyuru
 * gönder" butonu istenmedi, yalnızca gönderim altyapısının çalıştığı kanıtlanması istendi.
 * Gelecekte örn. `POST /admin/notifications/announcements` gibi bir uç (architect + frontend-agent
 * ile birlikte tasarlanmalı) bu fonksiyonu hedef `userIds` ile çağırabilir.
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
