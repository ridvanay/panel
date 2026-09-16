import net from "node:net";
import { env } from "../config/env";
import { isPublicUnicastIp, resolveAndValidateHost, SsrfValidationError } from "./ssrf-guard";

/**
 * `EmailSettings.smtpHost` SSRF/sözdizimi doğrulaması — `.claude/security-review-smtp-settings.md`
 * KARAR 2 (bağlayıcı, mimarın önerisini SIKILAŞTIRDI). `lib/ssrf-guard.ts::validateWebhookUrlSyntax`
 * İLE AYNI DOSYADA DEĞİL: webhook URL'i (şema + tam URL) ile SMTP host'u (çıplak hostname/IP, port
 * AYRI bir alan) sözdizimsel olarak FARKLI şeylerdir ve webhook'un "literal IP yasak" kuralı burada
 * KASITLI OLARAK TERS ÇEVRİLİR (SMTP relay'leri sabit iç IP ile yapılandırılmak YAYGINDIR — KARAR 2.2).
 * Ağ katmanı (`isPublicUnicastIp`/`resolveAndValidateHost`) `lib/ssrf-guard.ts`'ten AYNEN yeniden
 * kullanılır — yeni bir CIDR/blok listesi İCAT EDİLMEZ.
 */

const RFC1123_HOSTNAME_PATTERN =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export type SmtpHostRejectionReason =
  | "empty"
  | "contains_credentials"
  | "contains_scheme"
  | "contains_port"
  | "contains_whitespace"
  | "contains_control_char"
  | "too_long"
  | "invalid_format"
  | "private_address"
  | "dns_failure";

// Ham girdi hata gövdesine YANSITILMAZ (KARAR 2.2) — yalnızca sabit/jenerik mesajlar.
const GENERIC_SYNTAX_MESSAGE = "Geçersiz SMTP host adresi.";
const PRIVATE_ADDRESS_MESSAGE =
  "Bu SMTP host adresi bu ortamda kullanılamaz (özel/dahili ağ adresi). Kurumsal/iç ağ relay'i " +
  "kullanan bir kurulumdaysanız `SMTP_ALLOW_PRIVATE_HOST` ortam değişkenini devops ile birlikte " +
  "değerlendirin.";

export class SmtpHostValidationError extends Error {
  reason: SmtpHostRejectionReason;
  constructor(reason: SmtpHostRejectionReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** Katman A (KARAR 2.2) — sözdizimsel kontroller, ağ çağrısı YOK. `PATCH` anında kullanılır. */
export function validateSmtpHostSyntax(rawHost: string): { host: string; isIpLiteral: boolean } {
  if (rawHost.length === 0) throw new SmtpHostValidationError("empty", GENERIC_SYNTAX_MESSAGE);
  if (rawHost.length > 253) throw new SmtpHostValidationError("too_long", GENERIC_SYNTAX_MESSAGE);
  if (rawHost.includes("@")) throw new SmtpHostValidationError("contains_credentials", GENERIC_SYNTAX_MESSAGE);
  if (rawHost.includes("://")) throw new SmtpHostValidationError("contains_scheme", GENERIC_SYNTAX_MESSAGE);
  if (rawHost.includes(":")) throw new SmtpHostValidationError("contains_port", GENERIC_SYNTAX_MESSAGE);
  if (/\s/.test(rawHost)) throw new SmtpHostValidationError("contains_whitespace", GENERIC_SYNTAX_MESSAGE);
  // eslint-disable-next-line no-control-regex -- kontrol karakteri (header/log injection) reddi kasıtlı.
  if (/[\x00-\x1f\x7f]/.test(rawHost)) throw new SmtpHostValidationError("contains_control_char", GENERIC_SYNTAX_MESSAGE);

  const isIpLiteral = net.isIP(rawHost) !== 0;
  if (!isIpLiteral && !RFC1123_HOSTNAME_PATTERN.test(rawHost)) {
    throw new SmtpHostValidationError("invalid_format", GENERIC_SYNTAX_MESSAGE);
  }

  return { host: rawHost, isIpLiteral };
}

/**
 * Katman B (KARAR 2.4) — TÜM ortamlarda varsayılan AÇIK. `SMTP_ALLOW_PRIVATE_HOST=true` iken
 * TAMAMEN atlanır (kısmi gevşetme YOK, KARAR 2.4 son paragraf). IP literal verildiğinde DNS
 * çözümlemesi ATLANIR, `isPublicUnicastIp()` doğrudan literal üzerinde çalışır.
 */
export async function validateSmtpHostNetwork(host: string, isIpLiteral: boolean): Promise<void> {
  if (env.SMTP_ALLOW_PRIVATE_HOST) return;

  if (isIpLiteral) {
    if (!isPublicUnicastIp(host)) {
      throw new SmtpHostValidationError("private_address", PRIVATE_ADDRESS_MESSAGE);
    }
    return;
  }

  try {
    await resolveAndValidateHost(host);
  } catch (err) {
    if (err instanceof SsrfValidationError && err.reason === "dns_failure") {
      throw new SmtpHostValidationError("dns_failure", GENERIC_SYNTAX_MESSAGE);
    }
    throw new SmtpHostValidationError("private_address", PRIVATE_ADDRESS_MESSAGE);
  }
}

/**
 * A + B birlikte. `PATCH /admin/settings/email` anında VE her transporter (yeniden) kurulumunda
 * (KARAR 2.5 — rebinding/TOCTOU penceresini "config değişmediği sürece süreç ömrü" ile sınırlar)
 * çağrılır.
 */
export async function validateSmtpHost(rawHost: string): Promise<void> {
  const { host, isIpLiteral } = validateSmtpHostSyntax(rawHost);
  await validateSmtpHostNetwork(host, isIpLiteral);
}
