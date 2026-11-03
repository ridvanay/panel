/**
 * Log güvenliği: hata iletilerindeki e-posta adresi kalıplarını maskeler (SMTP hataları alıcı adresini içerebilir).
 * Hassas veri (alıcı adresi) loglara yazılmaz; yalnızca maskelenmiş ileti kalır.
 */
const EMAIL_PATTERN = /[^\s@<>"',;:()[\]]+@[^\s@<>"',;:()[\]]+/g;

export function maskEmails(text: string): string {
  return text.replace(EMAIL_PATTERN, "***@***");
}

export function safeErrorMessage(err: unknown): string {
  return maskEmails(err instanceof Error ? err.message : String(err));
}
