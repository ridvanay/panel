import net from "node:net";
import type { DeviceType } from "@prisma/client";

/**
 * Paket N — CRM gizlilik yardımcıları (saf fonksiyonlar). Kurallar `docs/prompts/2026-10-23-N-crm.md`
 * "Gizlilik ve güvenlik" bölümünden; değiştirirken rapordaki kontrol listesini de güncelleyin.
 */

/**
 * ASLA takip edilmeyen yollar (dil öneki çıkarıldıktan sonra, segment bazlı önek). `/doctors` (public
 * doktor listesi) ile `/doctor` (doktor portalı) karışmasın diye eşleşme `p` ya da `p/...` biçimindedir.
 */
export const CRM_ALWAYS_EXCLUDED_PATHS = [
  "/admin",
  "/portal",
  "/hesabim",
  "/siparislerim",
  "/doctor",
  "/patient",
  // Paket AA — tercüman paneli/görüşme ekranı takip edilmez.
  "/interpreter",
  "/consultation",
  "/checkout",
  "/cart",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/activate-account",
  "/2fa",
  "/invitations",
  "/dashboard",
] as const;

// Paket T — dil öneki iki harfli ya da yazı sistemli (`/sr-latn`) olabilir.
const LOCALE_PREFIX = /^\/[a-z]{2}(?:-[a-z]{4})?(?=\/|$)/;

/**
 * Paket V — hekim sayfaları `/doctors` → `/physicians` taşındı. Eski olaylar silinmez; raporlarda iki
 * yol aynı sayfa sayılır (`/en/doctors/x` → `/en/physicians/x`). SQL karşılığı `canonicalPathSql`.
 */
const LEGACY_DOCTORS_PATH = /^((?:\/[a-z]{2}(?:-[a-z]{4})?)?)\/doctors(?=\/|$)/;

export function canonicalCrmPath(path: string): string {
  return path.replace(LEGACY_DOCTORS_PATH, "$1/physicians");
}

/** Aynı sayfanın yeni ve eski yolu (ısı haritası gibi ham olay sorguları için). */
export function crmPathVariants(path: string): string[] {
  const canonical = canonicalCrmPath(path);
  const legacy = canonical.replace(/^((?:\/[a-z]{2}(?:-[a-z]{4})?)?)\/physicians(?=\/|$)/, "$1/doctors");
  return legacy === canonical ? [canonical] : [canonical, legacy];
}

/** `canonicalCrmPath`'in Postgres ifadesi (`col` güvenilir bir sütun adı olmalı). */
export function canonicalPathSql(col: string): string {
  return `regexp_replace(${col}, '^((?:/[a-z]{2}(?:-[a-z]{4})?)?)/doctors(?=/|$)', '\\1/physicians')`;
}

/** `/en/physicians/x?y#z` → `/physicians/x`. Dil öneki ve sorgu/parça atılır. */
export function stripLocale(path: string): string {
  const clean = path.split(/[?#]/)[0] || "/";
  const stripped = clean.replace(LOCALE_PREFIX, "");
  return stripped === "" ? "/" : stripped;
}

function matchesPrefix(path: string, prefix: string): boolean {
  const p = prefix.length > 1 ? prefix.replace(/\/+$/, "") : prefix;
  return path === p || path.startsWith(`${p}/`);
}

export function isExcludedPath(path: string, extra: readonly string[] = []): boolean {
  const bare = stripLocale(path);
  const full = path.split(/[?#]/)[0] || "/";
  return [...CRM_ALWAYS_EXCLUDED_PATHS, ...extra].some((prefix) => matchesPrefix(bare, prefix) || matchesPrefix(full, prefix));
}

/**
 * Olay yolu yalnızca site-içi mutlak bir pathname olabilir: `/` ile başlar, `//` ya da ters eğik çizgi
 * içermez (admin ısı haritası bu yolu iframe `src`'i olarak açar — `//evil.com`, `/\\evil.com`,
 * `javascript:` gibi değerler başka siteye gitmesin diye toplama ucunda reddedilir).
 */
export function isSafeSitePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") && !/[\s<>"']/.test(path);
}

/** Panelde gösterilecek / saklanacak yol: yalnızca pathname, en fazla 300 karakter. */
export function normalizePath(path: string): string {
  const clean = (path.split(/[?#]/)[0] || "/").replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  const trimmed = clean.length > 1 ? clean.replace(/\/+$/, "") : clean;
  return sanitizeText(trimmed, 300) || "/";
}

/**
 * Metin temizleme — kontrol karakterleri ve görünmez yön işaretleri atılır, boşluklar tek boşluğa
 * indirilir, uzunluk kesilir. HTML KAÇIŞI BURADA YAPILMAZ: panel React ile metin olarak basar (her
 * zaman kaçışlanır); `dangerouslySetInnerHTML` CRM ekranlarında YASAK.
 */
export function sanitizeText(value: string | null | undefined, max: number): string {
  if (!value) return "";
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

/** IPv4 → /24, IPv6 → /48. Maskeleme ülke/şehir çıkarıldıktan SONRA yapılır. */
export function maskIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (net.isIPv4(v4)) {
    const parts = v4.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  if (net.isIPv6(ip)) {
    const groups = expandIpv6(ip);
    return `${groups.slice(0, 3).join(":")}::`;
  }
  return null;
}

function expandIpv6(ip: string): string[] {
  const [head = "", tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = ip.includes("::") ? Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...fill, ...t].map((g) => (g || "0").toLowerCase().replace(/^0+(?=.)/, ""));
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function ipv6ToBigInt(ip: string): bigint {
  return expandIpv6(ip).reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g, 16) || 0), 0n);
}

/** IP, liste içindeki bir IP'ye ya da CIDR bloğuna düşüyor mu (IPv4 + IPv6). */
export function ipMatchesList(ip: string | undefined | null, list: readonly string[]): boolean {
  if (!ip || list.length === 0) return false;
  const addr = ip.startsWith("::ffff:") && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
  for (const entry of list) {
    const [base = "", bitsRaw] = entry.split("/");
    if (net.isIPv4(addr) && net.isIPv4(base)) {
      const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
      if (bits < 0 || bits > 32) continue;
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      if ((ipv4ToInt(addr) & mask) === (ipv4ToInt(base) & mask)) return true;
    } else if (net.isIPv6(addr) && net.isIPv6(base)) {
      const bits = bitsRaw === undefined ? 128 : Number(bitsRaw);
      if (bits < 0 || bits > 128) continue;
      const shift = BigInt(128 - bits);
      if (ipv6ToBigInt(addr) >> shift === ipv6ToBigInt(base) >> shift) return true;
    }
  }
  return false;
}

const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|mediapartners|adsbot|facebookexternalhit|embedly|quora link|whatsapp\/|telegrambot|preview|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|phantomjs|puppeteer|playwright|selenium|webdriver|curl\/|wget\/|python-|python\/|httpclient|okhttp|go-http|java\/|node-fetch|axios\/|postman|insomnia|scrapy/i;

/** Bilinen bot/headless/otomasyon istemcileri. Boş UA da bot sayılır. */
export function isBotUserAgent(userAgent: string | undefined | null): boolean {
  if (!userAgent || userAgent.length < 10) return true;
  return BOT_UA.test(userAgent);
}

/** Ham UA SAKLANMAZ — yalnızca aile adları (cihaz/tarayıcı/işletim sistemi). */
export function parseUserAgent(userAgent: string | undefined | null): { deviceType: DeviceType; browser: string | null; os: string | null } {
  const ua = userAgent ?? "";
  let deviceType: DeviceType = "UNKNOWN";
  if (ua) {
    if (/iPad|Tablet(?!.*Mobile)/i.test(ua)) deviceType = "TABLET";
    else if (/Mobi|Android|iPhone/i.test(ua)) deviceType = "MOBILE";
    else deviceType = "DESKTOP";
  }
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS/.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS/.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  return { deviceType, browser, os };
}
