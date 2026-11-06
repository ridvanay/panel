import type { FastifyRequest } from "fastify";

/**
 * Paket AP — gizli erişim token'larının TAŞINMA biçimi. Token'lar artık sunucuya giden URL'de (sorgu ya da
 * yol) taşınmaz: bağlantı `#` parçasında gelir (sunucuya gitmez), sayfa token'ı okuyup API'ye
 * `X-Access-Token` başlığında ya da POST gövdesinde gönderir. Böylece token Nginx/proxy log'larına, tarayıcı
 * geçmişine ve `Referer` başlığına düşmez.
 *
 * Token üretimi, ömrü, tek kullanımlık olması ve özet (hash) karşılaştırması DEĞİŞMEZ; burası yalnızca
 * token'ın istekten NEREDEN okunacağını belirler.
 *
 * Geriye dönük uyumluluk: gönderilmiş e-postalardaki eski bağlantılar (`?t=`, `?token=`, yol parçası)
 * `LEGACY_TOKEN_IN_URL_UNTIL` tarihine kadar kabul edilir. Booking token'ının en uzun ömrü 30 gün; süre
 * 2026-11-06 + 45 gün. Süre dolunca eski biçim "token yok" sayılır → çağıran uç kendi tek tip 401/404'ünü verir.
 * Eski biçim kullanıldığında log'a token DEĞİL, yalnızca `legacy_token_transport` sayacı ve yol adı yazılır.
 */
export const ACCESS_TOKEN_HEADER = "x-access-token";
export const LEGACY_TOKEN_IN_URL_UNTIL = new Date("2026-12-21T00:00:00.000Z");

/** Başlık değeri için üst sınır — token'lar en çok birkaç yüz karakter; aşırı uzun değer hiç okunmaz. */
const MAX_TOKEN_LENGTH = 512;

let legacyTransportCount = 0;
const resolvedTokens = new WeakMap<FastifyRequest, string | undefined>();

export function isLegacyTokenTransportAllowed(now: Date = new Date()): boolean {
  return now.getTime() < LEGACY_TOKEN_IN_URL_UNTIL.getTime();
}

/** Test ve izleme için: süreç açıldığından beri kabul edilen eski biçim sayısı. */
export function legacyTokenTransportCount(): number {
  return legacyTransportCount;
}

function routeName(request: FastifyRequest): string {
  return request.routeOptions?.url ?? request.url.split("?")[0] ?? "";
}

/**
 * Eski biçimde (sorgu ya da yol) gelen token'ı geçiş süresi içindeyse kabul eder, değilse `undefined` döner.
 * Kabul edildiğinde yalnızca sayaç ve yol adı loglanır (token değeri ASLA).
 */
export function acceptLegacyToken(request: FastifyRequest, value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  if (!isLegacyTokenTransportAllowed()) return undefined;
  legacyTransportCount += 1;
  request.log.info({ legacy_token_transport: legacyTransportCount, route: routeName(request) }, "legacy_token_transport");
  return value;
}

/**
 * İstekteki erişim token'ı: önce `X-Access-Token` başlığı; yoksa (geçiş süresi içinde) eski sorgu parametresi.
 * `legacyQueryValue` çağıranın şemasından gelen eski `?t=` değeridir (yoksa `undefined`).
 */
export function readAccessToken(request: FastifyRequest, legacyQueryValue?: string | null): string | undefined {
  // Aynı istekte birden çok okuma (erişim + sağlık verisi kontrolü) sayacı bir kez artırır.
  if (resolvedTokens.has(request)) return resolvedTokens.get(request);
  const raw = request.headers[ACCESS_TOKEN_HEADER];
  const header = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  const token = header && header.length <= MAX_TOKEN_LENGTH ? header : acceptLegacyToken(request, legacyQueryValue);
  resolvedTokens.set(request, token);
  return token;
}
