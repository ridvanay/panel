/**
 * Sağlayıcı-agnostik SMTP gönderim katmanı. Sağlayıcı (Mailtrap/SendGrid SMTP/Resend SMTP/
 * kurumsal SMTP/Ethereal) koda GÖMÜLMEZ.
 *
 * `.claude/architect-scope-smtp-settings.md` §3.1 (bağlayıcı) — ÖNCELİK ZİNCİRİ:
 *   1. `EmailSettings.enabled === true && smtpHost` dolu → DB yapılandırması (effectiveSource: "database")
 *   2. `env.SMTP_HOST` dolu                              → env yapılandırması  (effectiveSource: "env")
 *   3. `NODE_ENV=development`                             → Ethereal test kutusu (effectiveSource: "ethereal")
 *   4. `NODE_ENV=test`                                     → EmailDeliveryError (mevcut davranış, DEĞİŞMEDİ)
 *   5. production                                          → EmailDeliveryError (mevcut davranış, DEĞİŞMEDİ)
 *
 * 2-5. adımlar bugünkü davranışın BİREBİR AYNISIDIR — tek yenilik en üste eklenen 1. adımdır.
 *
 * Transporter, yapılandırmadan türetilen bir PARMAK İZİNE göre önbelleğe alınır (§3.4, bağlayıcı):
 * `"db:" + updatedAt.toISOString()` / `"env"` / `"ethereal"` / `"none"`. `sendMail()` HER çağrıda
 * `EmailSettings` satırını okur (tek satır, birincil anahtar — SMTP gidiş-dönüşünün yanında
 * ölçülemez bir maliyet); parmak izi değişmişse transporter yeniden kurulur. `resetMailTransporter()`
 * dışa açılır, başarılı `PATCH /admin/settings/email` sonrası çağrılır (aynı süreçte anında etki için —
 * birden fazla pod/örnek çalışıyorsa parmak izi karşılaştırması asıl doğruluk garantisidir).
 */
import nodemailer, { type Transporter } from "nodemailer";
import type { FastifyInstance } from "fastify";
import { env, isProd } from "../config/env";
import { EmailDeliveryError } from "./errors";
import { decryptSecret } from "./crypto";
import { validateSmtpHost, SmtpHostValidationError } from "./smtp-host-guard";

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

export type EmailEffectiveSource = "database" | "env" | "ethereal" | "none";

/** `EmailSettings` singleton satırının id'si — `settings.email.routes.ts` ile AYNI literal (diğer singleton modüllerdeki `APPEARANCE_ID`/`CUSTOM_CODE_ID` deseniyle tutarlı, her modül kendi yerel sabitini taşır). */
const EMAIL_SETTINGS_ROW_ID = "singleton";

/** `GET/PATCH /admin/settings/email` DTO'sunun `effectiveSource`'u ile `lib/mail.ts`'in gerçekte seçtiği kaynak AYNI fonksiyondan türetilir — iki yerde ayrı ayrı yazılmış, birbirinden sapabilecek bir mantık YOKTUR. */
export function computeEffectiveEmailSource(row: { enabled: boolean; smtpHost: string | null } | null): EmailEffectiveSource {
  if (row?.enabled && row.smtpHost) return "database";
  if (env.SMTP_HOST) return "env";
  if (env.NODE_ENV === "development") return "ethereal";
  return "none";
}

/**
 * DB aktifken `fromName`/`fromAddress` doluysa `env.SMTP_FROM`'u ezer (§3.1) — `fromAddress`
 * yoksa taşınacak bir header yoktur, env'e düşülür. `POST /admin/settings/email/test` de AYNI
 * fonksiyonu kullanır (`settings.email.routes.ts`) — "from" çözümlemesi TEK yerde yazılır.
 */
export function resolveFromHeader(row: { fromName: string | null; fromAddress: string | null } | null): string {
  if (!row?.fromAddress) return env.SMTP_FROM;
  return row.fromName ? `${row.fromName} <${row.fromAddress}>` : row.fromAddress;
}

interface EmailSettingsRowLike {
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPasswordCiphertext: string | null;
}

/**
 * `ENCRYPTION_KEY` rotasyon senaryosu (KARAR 4, bağlayıcı) — `smtpPasswordCiphertext` çözülemezse
 * bu ÖZEL alt-sınıf fırlatılır (test ucundaki `classifyEmailTestError`'ın `"config"` kovasına
 * güvenilir biçimde eşlemesi için `instanceof` ile ayırt edilir, kırılgan mesaj-string eşleştirmesi
 * YAPILMAZ). Gerçek gönderim yolunda (§3.1 adım 1) decrypt hatası env'e SESSİZCE DÜŞÜLMEZ —
 * `enabled: true` admin'in DB yapılandırmasını BİLİNÇLİ olarak öncelikli kıldığı bir karardır;
 * bu sınıf yakalanmadan yukarı fırlar (fail closed, `LiveKitNotConfiguredError`/
 * `PaymentsNotConfiguredError` ile AYNI "dürüst yapılandırılmamışlık" felsefesi).
 */
export class EmailConfigDecryptError extends EmailDeliveryError {
  constructor() {
    super("Kayıtlı SMTP parolası çözülemedi (şifreleme anahtarı değişmiş olabilir). Parolayı panelden yeniden girin.");
  }
}

/**
 * `EmailSettings` satırından doğrudan bir transporter kurar — `enabled` bayrağına BAKMAZ (çağıranın
 * sorumluluğu). `POST /admin/settings/email/test` bunu KAYDEDİLMİŞ satır üzerinde kullanır
 * (§4.3.2/§4.3.3 — `enabled: false` iken de çalışır); §3.1 öncelik zincirinin "database" dalı da
 * AYNI fonksiyonu kullanır. SSRF Katman B doğrulaması (KARAR 2.5) HER çağrıda tekrar çalıştırılır.
 */
export async function buildTransporterFromEmailSettingsRow(row: EmailSettingsRowLike): Promise<Transporter> {
  if (!row.smtpHost) {
    throw new EmailDeliveryError("SMTP host yapılandırılmamış.");
  }

  await validateSmtpHost(row.smtpHost);

  let pass: string | undefined;
  if (row.smtpPasswordCiphertext) {
    try {
      pass = decryptSecret(row.smtpPasswordCiphertext);
    } catch {
      throw new EmailConfigDecryptError();
    }
  }

  return nodemailer.createTransport({
    host: row.smtpHost,
    port: row.smtpPort,
    secure: row.smtpSecure,
    auth: row.smtpUser ? { user: row.smtpUser, pass } : undefined,
  });
}

interface ResolvedEmailConfig {
  source: EmailEffectiveSource;
  fingerprint: string;
  from: string;
  row: EmailSettingsRowLike | null;
}

async function resolveEmailConfig(app: FastifyInstance): Promise<ResolvedEmailConfig> {
  const row = await app.prisma.emailSettings.findUnique({ where: { id: EMAIL_SETTINGS_ROW_ID } });
  const source = computeEffectiveEmailSource(row);

  if (source === "database" && row) {
    return { source, fingerprint: `db:${row.updatedAt.toISOString()}`, from: resolveFromHeader(row), row };
  }

  return { source, fingerprint: source, from: env.SMTP_FROM, row: null };
}

let transporterPromise: Promise<Transporter> | null = null;
let cachedFingerprint: string | null = null;
let usingEtherealAccount = false;

/** Yapılandırma değiştiğinde (başarılı `PATCH /admin/settings/email` sonrası) çağrılır — §3.4. */
export function resetMailTransporter(): void {
  transporterPromise = null;
  cachedFingerprint = null;
  usingEtherealAccount = false;
}

async function buildTransporterForSource(app: FastifyInstance, config: ResolvedEmailConfig): Promise<Transporter> {
  if (config.source === "database" && config.row) {
    try {
      return await buildTransporterFromEmailSettingsRow(config.row);
    } catch (err) {
      if (err instanceof EmailDeliveryError) throw err;
      const message = err instanceof SmtpHostValidationError ? err.message : "SMTP yapılandırması geçersiz.";
      throw new EmailDeliveryError(message);
    }
  }

  if (config.source === "env") {
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }

  if (config.source === "ethereal") {
    const testAccount = await nodemailer.createTestAccount();
    usingEtherealAccount = true;
    // testAccount.pass BİLEREK loglanmıyor (hassas veri loglama yasağı) — zaten gönderilen her
    // e-postanın previewUrl'i (bkz. sendMail) mesajı doğrudan tarayıcıda açar, ayrıca login gerekmez.
    app.log.info(
      { etherealUser: testAccount.user },
      "SMTP yapılandırılmamış — geliştirme için otomatik Ethereal test hesabı oluşturuldu. Gönderilen postaları görmek için sendMail() sonrası loglanan previewUrl bağlantısını kullanın."
    );
    return nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
  }

  // source === "none" — §3.1 adım 4/5, mevcut davranış BİREBİR (isProd'a göre ayrım devam ediyor).
  const message = isProd
    ? "SMTP yapılandırılmamış (SMTP_HOST eksik) — production ortamında e-posta gönderilemez."
    : "SMTP yapılandırılmamış (SMTP_HOST eksik).";
  throw new EmailDeliveryError(message);
}

async function getTransporter(app: FastifyInstance): Promise<{ transporter: Transporter; from: string }> {
  const config = await resolveEmailConfig(app);

  if (cachedFingerprint !== config.fingerprint) {
    resetMailTransporter();
    cachedFingerprint = config.fingerprint;
    transporterPromise = buildTransporterForSource(app, config).catch((err) => {
      // Kurulum başarısız oldu — bir sonraki sendMail() çağrısı yeniden denesin diye
      // singleton'ı sıfırlıyoruz (aksi halde geçici bir hata süreç ömrü boyunca kalıcı hataya döner).
      transporterPromise = null;
      cachedFingerprint = null;
      throw err;
    });
  }

  const transporter = await transporterPromise!;
  return { transporter, from: config.from };
}

/** Ham SMTP gönderimi — şablon/render işini bilmez, sadece `to/subject/html` gönderir. */
export async function sendMail(app: FastifyInstance, input: SendMailInput): Promise<SendMailResult> {
  try {
    const { transporter, from } = await getTransporter(app);
    const info = await transporter.sendMail({
      from,
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

// ---------------------------------------------------------------------------
// `POST /admin/settings/email/test` hata sınıflandırması — security-review-smtp-settings.md
// KARAR 3 (bağlayıcı). Ham hata (`err.message`/`err.code`/SMTP sunucu yanıtı/stack) İSTEMCİYE
// HİÇBİR ZAMAN döndürülmez; yalnızca aşağıdaki 6 kaba, SABİT mesajlı kovadan biri döner.
// `connection` kovası içinde ALT AYRIM YAPILMAZ (ECONNREFUSED/ETIMEDOUT/ENOTFOUND birleştirilir) —
// bu ayrım tam olarak bir port tarayıcısının ihtiyaç duyduğu sinyaldir.
// ---------------------------------------------------------------------------

export type EmailTestErrorCategory = "connection" | "tls" | "auth" | "rejected" | "config" | "unknown";

const EMAIL_TEST_ERROR_MESSAGES: Record<EmailTestErrorCategory, string> = {
  connection: "SMTP sunucusuna bağlanılamadı. Host adresini ve portu kontrol edin.",
  tls: "TLS/SSL bağlantısı kurulamadı. `smtpSecure` ayarını ve sunucu sertifikasını kontrol edin.",
  auth: "Kimlik doğrulama başarısız. Kullanıcı adı/parolayı kontrol edin.",
  rejected: "Sunucu gönderimi reddetti. Gönderen adresini (fromAddress) kontrol edin.",
  config: "Kayıtlı SMTP parolası çözülemedi (şifreleme anahtarı değişmiş olabilir). Parolayı panelden yeniden girin.",
  unknown: "E-posta gönderimi başarısız oldu.",
};

const CONNECTION_ERROR_CODES = new Set(["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"]);
const AUTH_RESPONSE_CODES = new Set([535, 534, 530]);
const REJECTED_RESPONSE_CODES = new Set([550, 553, 521]);

export function classifyEmailTestError(err: unknown): EmailTestErrorCategory {
  if (err instanceof EmailConfigDecryptError) return "config";
  // Katman B (SSRF) reddi veya sözdizimi hatası — gerçek bir soket hiç açılmadı, admin'e göre
  // "bu host'a ulaşılamadı" ile aynı anlamı taşır; hangi kural ihlal edildiği (private/DNS/format)
  // İSTEMCİYE sızdırılmaz.
  if (err instanceof SmtpHostValidationError) return "connection";

  if (err && typeof err === "object") {
    const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
    const responseCode = "responseCode" in err ? Number((err as { responseCode?: unknown }).responseCode) : NaN;

    if (code === "EAUTH" || AUTH_RESPONSE_CODES.has(responseCode)) return "auth";
    if (code === "EENVELOPE" || REJECTED_RESPONSE_CODES.has(responseCode)) return "rejected";
    if (CONNECTION_ERROR_CODES.has(code)) return "connection";
    if (code === "ESOCKET") {
      const message = String("message" in err ? ((err as { message?: unknown }).message ?? "") : "").toLowerCase();
      if (message.includes("tls") || message.includes("ssl") || message.includes("certificate")) return "tls";
      return "connection";
    }
  }

  return "unknown";
}

export function getEmailTestErrorMessage(category: EmailTestErrorCategory): string {
  return EMAIL_TEST_ERROR_MESSAGES[category];
}
