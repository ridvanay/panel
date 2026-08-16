import dns from "node:dns";
import net from "node:net";

/**
 * §10.13.7 SSRF önleme — webhook URL'i kaydedilirken VE her teslimat denemesinde uygulanır
 * (ARCHITECTURE.md §10.13.7, bağlayıcı). İki aşama:
 *
 *   A. Sözdizimsel kontroller (`validateWebhookUrlSyntax`) — yalnızca URL parse, ağ çağrısı YOK.
 *      Oluşturma/güncelleme anında kullanılır.
 *   B. Ağ katmanı kontrolleri (`resolveAndValidateHost`) — DNS çözümlemesi + döndürülen TÜM
 *      adreslerin public unicast olduğu doğrulaması. HEM oluşturma/güncellemede HEM DE her
 *      teslimat denemesinde (rebinding/TOCTOU koruması için pinlenmiş IP seçimiyle) çağrılır.
 */

export const WEBHOOK_URL_MAX_LENGTH = 2048;

export type SsrfRejectionReason =
  | "invalid_url"
  | "non_https_scheme"
  | "credentials_in_url"
  | "invalid_port"
  | "literal_ip_host"
  | "internal_hostname"
  | "url_too_long"
  | "dns_failure"
  | "non_public_address";

export class SsrfValidationError extends Error {
  reason: SsrfRejectionReason;
  constructor(reason: SsrfRejectionReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

// RED listesi — tek etiketli adlar ayrıca aşağıda `hostname.includes(".")` ile elenir.
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".cluster.local"];
const BLOCKED_HOST_EXACT = new Set(["localhost"]);

/** A. Sözdizimsel kontroller — DNS/ağ çağrısı YAPMAZ. `new URL()` parse edilebilir olmalıdır. */
export function validateWebhookUrlSyntax(rawUrl: string): { hostname: string } {
  if (rawUrl.length > WEBHOOK_URL_MAX_LENGTH) {
    throw new SsrfValidationError("url_too_long", `URL en fazla ${WEBHOOK_URL_MAX_LENGTH} karakter olabilir.`);
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfValidationError("invalid_url", "Geçersiz URL.");
  }

  if (url.protocol !== "https:") {
    throw new SsrfValidationError("non_https_scheme", "Yalnızca https:// URL'leri kabul edilir.");
  }

  if (url.username || url.password) {
    throw new SsrfValidationError("credentials_in_url", "URL kimlik bilgisi (kullanıcı adı/şifre) içeremez.");
  }

  const port = url.port ? Number(url.port) : 443;
  if (port !== 443) {
    throw new SsrfValidationError("invalid_port", "Yalnızca 443 portu kabul edilir.");
  }

  const hostname = url.hostname.toLowerCase();
  // `new URL()` IPv6 host'u köşeli parantezle döner (`[::1]`) — `net.isIP` için parantezleri soy.
  const bareHost = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

  if (net.isIP(bareHost) !== 0) {
    throw new SsrfValidationError("literal_ip_host", "Host adı literal bir IP adresi olamaz, DNS adı kullanın.");
  }

  if (BLOCKED_HOST_EXACT.has(hostname) || !hostname.includes(".")) {
    throw new SsrfValidationError("internal_hostname", "Host adı geçerli, çok etiketli bir public DNS adı olmalıdır.");
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new SsrfValidationError("internal_hostname", "Bu host adı iç/özel bir isim uzayına ait olduğu için kabul edilemez.");
  }

  return { hostname };
}

// ---------------------------------------------------------------------------
// B. Ağ katmanı — DNS çözümlemesi + public-unicast doğrulaması.
// ---------------------------------------------------------------------------

interface Ipv4Range {
  base: number;
  maskBits: number;
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function parseIpv4Cidr(cidr: string): Ipv4Range {
  const [ip, bits] = cidr.split("/");
  return { base: ipv4ToInt(ip!), maskBits: Number(bits) };
}

const BLOCKED_IPV4_RANGES: Ipv4Range[] = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "255.255.255.255/32",
].map(parseIpv4Cidr);

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return BLOCKED_IPV4_RANGES.some(({ base, maskBits }) => {
    if (maskBits === 0) return true;
    const mask = maskBits === 32 ? 0xffffffff : (0xffffffff << (32 - maskBits)) >>> 0;
    return (value & mask) === (base & mask);
  });
}

/**
 * `a:b:c:d:e:f:g:h` biçimindeki (tam açılmış) bir IPv6 adresini 8 adet 16-bit gruba çevirir.
 * `::ffff:127.0.0.1` gibi KARIŞIK (son grup noktalı-ondalık IPv4) gösterimi de destekler —
 * bu, IPv4-mapped adresler için Node/işletim sistemi çözümleyicilerinin ÇOK YAYGIN kullandığı
 * biçimdir; yalnızca saf hex grup biçimini (`::ffff:7f00:1`) desteklemek `::ffff:127.0.0.1` gibi
 * bir kaydın (loopback) kontrolü delip geçmesine yol açardı.
 */
function expandIpv6(ip: string): number[] | null {
  let normalized = ip;
  const lastColon = normalized.lastIndexOf(":");
  if (lastColon !== -1) {
    const tail = normalized.slice(lastColon + 1);
    if (net.isIP(tail) === 4) {
      const octets = tail.split(".").map(Number);
      if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return null;
      const hi = ((octets[0]! << 8) | octets[1]!).toString(16);
      const lo = ((octets[2]! << 8) | octets[3]!).toString(16);
      normalized = `${normalized.slice(0, lastColon)}:${hi}:${lo}`;
    }
  }

  const parts = normalized.split("::");
  if (parts.length > 2) return null;

  const head = parts[0] ? parts[0].split(":").filter(Boolean) : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":").filter(Boolean) : [];
  const missing = 8 - head.length - tail.length;
  if (parts.length === 1 && head.length !== 8) return null;
  if (missing < 0) return null;

  const groups = [...head, ...(parts.length === 2 ? Array(missing).fill("0") : []), ...tail];
  if (groups.length !== 8) return null;

  const parsed = groups.map((g) => parseInt(g, 16));
  if (parsed.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  return parsed;
}

/**
 * IPv4-mapped (`::ffff:0:0/96`), NAT64 (`64:ff9b::/96`) ve 6to4 (`2002::/16`) sarmalamalarını
 * açar; gömülü IPv4'ü döner. `null` = sarmalanmamış saf IPv6.
 */
function unwrapEmbeddedIpv4(groups: number[]): string | null {
  // IPv4-mapped: ::ffff:a.b.c.d → grup[0..4]=0, grup[5]=0xffff
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const a = (groups[6]! >> 8) & 0xff;
    const b = groups[6]! & 0xff;
    const c = (groups[7]! >> 8) & 0xff;
    const d = groups[7]! & 0xff;
    return `${a}.${b}.${c}.${d}`;
  }
  // NAT64: 64:ff9b::a.b.c.d → grup[0]=0x0064, grup[1]=0xff9b, grup[2..5]=0
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    const a = (groups[6]! >> 8) & 0xff;
    const b = groups[6]! & 0xff;
    const c = (groups[7]! >> 8) & 0xff;
    const d = groups[7]! & 0xff;
    return `${a}.${b}.${c}.${d}`;
  }
  // 6to4: 2002:aabb:ccdd:: → grup[0]=0x2002, IPv4 grup[1] içinde kodlanır.
  if (groups[0] === 0x2002) {
    const a = (groups[1]! >> 8) & 0xff;
    const b = groups[1]! & 0xff;
    const c = (groups[2]! >> 8) & 0xff;
    const d = groups[2]! & 0xff;
    return `${a}.${b}.${c}.${d}`;
  }
  return null;
}

function isBlockedIpv6(groups: number[]): boolean {
  const isZero = (from: number, to: number) => groups.slice(from, to).every((g) => g === 0);

  // ::/128
  if (isZero(0, 8)) return true;
  // ::1/128
  if (isZero(0, 7) && groups[7] === 1) return true;
  // fc00::/7 (ULA) — ilk 7 bit 1111 110x → üst byte 0xfc-0xfd.
  const topByte0 = (groups[0]! >> 8) & 0xff;
  if (topByte0 >= 0xfc && topByte0 <= 0xfd) return true;
  // fe80::/10 (link-local) — grup[0] & 0xffc0 === 0xfe80.
  if ((groups[0]! & 0xffc0) === 0xfe80) return true;
  // ff00::/8 (multicast)
  if (topByte0 === 0xff) return true;

  return false;
}

/** Tek bir IP adresinin (v4 veya v6, sarmalamalar açılmış hâlde) public unicast olup olmadığını doğrular. */
export function isPublicUnicastIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return !isBlockedIpv4(ip);
  if (family === 6) {
    const groups = expandIpv6(ip);
    if (!groups) return false;
    const embedded = unwrapEmbeddedIpv4(groups);
    if (embedded) return !isBlockedIpv4(embedded);
    return !isBlockedIpv6(groups);
  }
  return false;
}

export interface ResolvedHost {
  addresses: string[];
}

/**
 * B + C — host'u `dns.lookup(..., { all: true, verbatim: true })` ile çözer; dönen TÜM adresler
 * public unicast olmalıdır (bir tanesi bile düşerse tüm istek reddedilir — "kısmen geçerli" YOK).
 * Çözümleme başarısızsa `dns_failure`. Bu fonksiyon HEM create/update doğrulamasında HEM DE her
 * teslimat denemesinde (rebinding koruması için) çağrılır — pinlenecek IP `addresses[0]`'dır.
 */
export async function resolveAndValidateHost(hostname: string): Promise<ResolvedHost> {
  let records: dns.LookupAddress[];
  try {
    records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfValidationError("dns_failure", "Host adı çözümlenemedi.");
  }

  if (records.length === 0) {
    throw new SsrfValidationError("dns_failure", "Host adı çözümlenemedi.");
  }

  for (const record of records) {
    if (!isPublicUnicastIp(record.address)) {
      throw new SsrfValidationError("non_public_address", "Host adı özel/dahili bir IP adresine çözümleniyor.");
    }
  }

  return { addresses: records.map((r) => r.address) };
}

/**
 * Tek çağrıda A+B: hem sözdizimsel kontrolleri hem DNS/ağ katmanı kontrollerini uygular.
 * `create`/`update` route handler'ları bunu kullanır. Teslimat anında (`outbound-webhooks.
 * dispatcher.ts`) `validateWebhookUrlSyntax` + `resolveAndValidateHost` AYRI AYRI çağrılır çünkü
 * pinlenecek IP seçimi teslimat katmanının kendi sorumluluğudur.
 */
export async function validateWebhookUrl(rawUrl: string): Promise<{ hostname: string; addresses: string[] }> {
  const { hostname } = validateWebhookUrlSyntax(rawUrl);
  const { addresses } = await resolveAndValidateHost(hostname);
  return { hostname, addresses };
}
