import type { FastifyInstance } from "fastify";
import { sendMail } from "./mail";

/**
 * 2026-10-18 (Paket B1) — "2FA'nız yönetici tarafından sıfırlandı" bilgilendirmesi. Şablon
 * sistemine yeni bir `EmailTemplatePurpose` EKLENMEZ (geri alınamaz `ALTER TYPE` borcu ve canlıda
 * şablon satırı gerektirirdi); güvenlik bildirimi sabit TR+EN metinle doğrudan `sendMail` ile
 * gider. Metinde link, kod veya IP YOKTUR — oltalama taklidine malzeme olmasın.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildTwoFactorResetNoticeHtml(userName: string, resetAt: Date): string {
  const name = escapeHtml(userName);
  const when = resetAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;">`,
    `<p>Merhaba ${name},</p>`,
    `<p>Hesabınızdaki iki adımlı doğrulama (2FA) <strong>${when}</strong> tarihinde bir yönetici tarafından sıfırlandı ve tüm oturumlarınız kapatıldı. Bir sonraki girişinizde 2FA'yı kendi cihazınızda yeniden kurmanız gerekebilir.</p>`,
    `<p>Bu işlemi siz talep etmediyseniz lütfen hemen bizimle iletişime geçin.</p>`,
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />`,
    `<p>Hello ${name},</p>`,
    `<p>Two-factor authentication (2FA) on your account was reset by an administrator on <strong>${when}</strong> and all of your sessions were signed out. You may need to set up 2FA again on your own device the next time you sign in.</p>`,
    `<p>If you did not request this, please contact us immediately.</p>`,
    `</div>`,
  ].join("");
}

export async function sendTwoFactorResetNotice(
  app: FastifyInstance,
  user: { email: string; name: string },
  resetAt: Date
): Promise<void> {
  await sendMail(app, {
    to: user.email,
    subject: "2FA'nız sıfırlandı / Your 2FA was reset",
    html: buildTwoFactorResetNoticeHtml(user.name, resetAt),
  });
}
