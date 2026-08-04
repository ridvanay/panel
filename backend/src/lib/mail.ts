/**
 * Sağlayıcı-agnostik SMTP gönderim katmanı. Sağlayıcı (Mailtrap/SendGrid SMTP/Resend SMTP/
 * kurumsal SMTP/Ethereal) koda GÖMÜLMEZ — yalnızca env'deki SMTP_HOST/PORT/USER/PASS/FROM
 * üzerinden standart SMTP protokolü konuşulur (bkz. config/env.ts).
 *
 * Dev fallback: NODE_ENV=development'ta SMTP_HOST tanımsızsa nodemailer'ın built-in
 * `createTestAccount()` (Ethereal) ile otomatik, geçici bir test SMTP kutusu oluşturulur —
 * geliştirici hiçbir şey kurmadan gönderilen postayı `sendMail()`'in döndürdüğü `previewUrl`
 * ile tarayıcıda görebilir. NOT: docker-compose.yml'a maildev/mailhog gibi bir servis EKLENMEDİ
 * (devops-agent aynı dosyaya yakın zamanda dokunacağı için gereksiz çakışmayı önlemek amacıyla) —
 * Ethereal yaklaşımı sıfır ek altyapı gerektirir. İleride kalıcı bir dev inbox istenirse
 * devops-agent'a maildev/mailhog servisi eklemesi talep edilebilir.
 */
import nodemailer, { type Transporter } from "nodemailer";
import type { FastifyInstance } from "fastify";
import { env, isProd } from "../config/env";
import { EmailDeliveryError } from "./errors";

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
}

export interface SendMailResult {
  messageId: string;
  /** Yalnızca dev Ethereal hesabı kullanılıyorsa dolu — gönderilen postayı tarayıcıda açar. */
  previewUrl?: string;
}

let transporterPromise: Promise<Transporter> | null = null;
let usingEtherealAccount = false;

function buildTransporter(app: FastifyInstance): Promise<Transporter> {
  if (env.SMTP_HOST) {
    return Promise.resolve(
      nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      })
    );
  }

  if (isProd) {
    throw new EmailDeliveryError("SMTP yapılandırılmamış (SMTP_HOST eksik) — production ortamında e-posta gönderilemez.");
  }

  if (env.NODE_ENV !== "development") {
    // Test ortamında (NODE_ENV=test) kasıtlı olarak Ethereal'a düşülmez: her test çalıştırmasında
    // gerçek bir ağ çağrısı (ethereal.email API'sine hesap oluşturma isteği) yapmak testleri
    // yavaşlatır/kararsızlaştırır. Testler mail gönderimini mock'lamalı (bkz. tests/unit/mail.test.ts).
    throw new EmailDeliveryError("SMTP yapılandırılmamış (SMTP_HOST eksik).");
  }

  return (async () => {
    const testAccount = await nodemailer.createTestAccount();
    usingEtherealAccount = true;
    // testAccount.pass BİLEREK loglanmıyor (hassas veri loglama yasağı) — zaten gönderilen her
    // e-postanın previewUrl'i (bkz. sendMail) mesajı doğrudan tarayıcıda açar, ayrıca login gerekmez.
    app.log.info(
      { etherealUser: testAccount.user },
      "SMTP_HOST tanımsız — geliştirme için otomatik Ethereal test hesabı oluşturuldu. Gönderilen postaları görmek için sendMail() sonrası loglanan previewUrl bağlantısını kullanın."
    );
    return nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
  })();
}

function getTransporter(app: FastifyInstance): Promise<Transporter> {
  if (!transporterPromise) {
    transporterPromise = buildTransporter(app).catch((err) => {
      // Kurulum başarısız oldu — bir sonraki sendMail() çağrısı yeniden denesin diye
      // singleton'ı sıfırlıyoruz (aksi halde geçici bir hata süreç ömrü boyunca kalıcı hataya döner).
      transporterPromise = null;
      throw err;
    });
  }
  return transporterPromise;
}

/** Ham SMTP gönderimi — şablon/render işini bilmez, sadece `to/subject/html` gönderir. */
export async function sendMail(app: FastifyInstance, input: SendMailInput): Promise<SendMailResult> {
  try {
    const transporter = await getTransporter(app);
    const info = await transporter.sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });

    const previewUrl = usingEtherealAccount ? nodemailer.getTestMessageUrl(info) || undefined : undefined;
    if (previewUrl) {
      app.log.info({ previewUrl }, "Ethereal test e-postası gönderildi — önizleme bağlantısı");
    }

    return { messageId: String(info.messageId), previewUrl };
  } catch (err) {
    if (err instanceof EmailDeliveryError) {
      app.log.error({ err, to: input.to }, "SMTP yapılandırılmadığı için e-posta gönderilemedi");
      throw err;
    }
    // Hassas veri LOGLANMAZ (şifre/token yok, sadece hedef adres + hata stack'i).
    app.log.error({ err, to: input.to }, "SMTP gönderimi başarısız oldu");
    throw new EmailDeliveryError("E-posta gönderilemedi, lütfen daha sonra tekrar deneyin.");
  }
}
