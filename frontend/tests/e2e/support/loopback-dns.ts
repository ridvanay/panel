/**
 * Node tarafı `*.localhost` çözümleme yaması (Paket AL, İş 2).
 *
 * Tarayıcı (Chromium) `*.localhost`'u otomatik 127.0.0.1'e çözer, ancak Node'un `getaddrinfo`'su
 * Windows'ta çözemez (`ENOTFOUND siteadi.localhost`). Spec'lerin Node tarafındaki `fetch(...)`
 * çağrıları (ör. ISR yansıma yoklaması) ve `localhost:3100`'ün `siteadi.localhost:3100`'e
 * yönlendirmesi (proxy.ts §6 eski host migrasyonu) bu yüzden kırılıyordu. Bu yama YALNIZCA test
 * sürecinde, YALNIZCA `*.localhost` adları için `dns.lookup`'u loopback'e bağlar; uygulama koduna
 * ve tarayıcıya dokunmaz. Birden çok kez import edilmesi güvenlidir (idempotent).
 */
import dns from "node:dns";

const PATCHED = Symbol.for("qa.loopbackDnsPatched");
const holder = dns as unknown as Record<symbol, boolean>;

if (!holder[PATCHED]) {
  holder[PATCHED] = true;
  const original = dns.lookup.bind(dns) as (...args: unknown[]) => unknown;
  (dns as unknown as { lookup: unknown }).lookup = (host: unknown, options: unknown, callback?: unknown) => {
    const cb = (typeof options === "function" ? options : callback) as (...a: unknown[]) => void;
    const opts = (typeof options === "function" ? {} : options) as { all?: boolean } | number | undefined;
    if (typeof host === "string" && /\.localhost$/i.test(host)) {
      const all = typeof opts === "object" && opts !== null && opts.all === true;
      process.nextTick(() => (all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4)));
      return undefined;
    }
    return typeof options === "function" ? original(host, options) : original(host, options, callback);
  };
}
