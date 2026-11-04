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

/**
 * Paket AL (İş 5) — istek log'unda URL sorgusundaki gizli değerleri maskeler. Token'lar bazı bağlantılarda
 * sorgu parametresi olarak taşınır (ör. `?t=`, `?token=`); Fastify'ın varsayılan `req` serializer'ı `req.url`'i
 * ham yazdığından bunlar log'a düşerdi. Anahtar adı büyük/küçük harf duyarsız eşleşir; değer `***` olur.
 */
const SENSITIVE_QUERY_PARAMS = new Set(["token", "t", "key", "code", "signature"]);

export function maskUrlQuery(url: string): string {
  const qIndex = url.indexOf("?");
  if (qIndex === -1) return url;
  const hashIndex = url.indexOf("#", qIndex);
  const queryEnd = hashIndex === -1 ? url.length : hashIndex;
  const masked = url
    .slice(qIndex + 1, queryEnd)
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return pair;
      let name = pair.slice(0, eq);
      try {
        name = decodeURIComponent(name.replace(/\+/g, " "));
      } catch {
        /* geçersiz kodlama: ham ad ile karşılaştır */
      }
      return SENSITIVE_QUERY_PARAMS.has(name.toLowerCase()) ? `${pair.slice(0, eq)}=***` : pair;
    })
    .join("&");
  return url.slice(0, qIndex + 1) + masked + url.slice(queryEnd);
}

/** Fastify varsayılan `req` serializer'ı ile AYNI alanlar; yalnızca `url` sorgusu maskelenir. */
export function serializeRequestForLog(req: {
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number };
}) {
  return {
    method: req.method,
    url: typeof req.url === "string" ? maskUrlQuery(req.url) : req.url,
    version: req.headers && req.headers["accept-version"],
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket ? req.socket.remotePort : undefined,
  };
}
