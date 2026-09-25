import { promises as dns } from "node:dns";
import { isIP } from "node:net";

/**
 * "İç istemci" (frontend konteyneri) tanıma — rate limit'te ziyaretçi kovasından AYRI bir kovaya
 * alınır (bkz. plugins/security.ts, plugins/uploads.ts, lib/rate-limit.ts::INTERNAL_RATE_LIMIT_MAX).
 *
 * Frontend'in sunucu tarafı istekleri (SSR veri fetch'leri + `next/image` optimizasyonu) Nginx'i
 * atlayıp doğrudan `http://backend:4000`'e gelir; hepsi TEK bir IP'den (frontend konteyneri)
 * görünür ve tüm ziyaretçilerin SSR trafiği ziyaretçi limitini (300/dk) tek bir kovada paylaşırdı.
 *
 * GÜVEN MODELİ (security-agent onayı, INFRA.md "internal rate-limit sınıflandırması"):
 *  - Karar YALNIZCA ham soket adresine (`request.socket.remoteAddress`) dayanır — `request.ip`/
 *    `X-Forwarded-For` DEĞİL (TRUST_PROXY=true iken XFF istemci tarafından yazılabilir).
 *  - Soket adresi, mevcut `INTERNAL_FRONTEND_URL`'in host adının DNS çözümüyle (`resolve4/6`,
 *    `/etc/hosts`'a bakan `lookup` DEĞİL) eşleşmelidir. Nginx trafiği Docker gateway/proxy
 *    adresinden gelir, dış istemciler kendi adresleriyle — TCP el sıkışması nedeniyle frontend'in
 *    iç ağ adresi taklit edilemez.
 *  - FAIL-CLOSED: değişken yoksa, host `localhost`/çözümlenemezse küme BOŞTUR → kimse iç sayılmaz
 *    (değişiklik öncesi davranış). Konteyner yeniden oluşturulunca IP değişir; küme periyodik tazelenir.
 */
export interface InternalClientResolver {
  isInternal(socketAddress: string | undefined): boolean;
  refresh(): Promise<void>;
  close(): void;
}

interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export const INTERNAL_CLIENT_REFRESH_MS = 30_000;
/** Henüz adres yokken (deploy sırasında backend frontend'den ÖNCE başlar) daha sık dene. */
export const INTERNAL_CLIENT_RETRY_MS = 5_000;

/** `::ffff:172.19.0.4` → `172.19.0.4` (IPv4-mapped IPv6 soket adresleri). */
export function normalizeAddress(address: string | undefined): string | null {
  if (!address) return null;
  const lower = address.toLowerCase();
  return lower.startsWith("::ffff:") && isIP(lower.slice(7)) === 4 ? lower.slice(7) : lower;
}

export function createInternalClientResolver(
  frontendUrl: string | undefined,
  log: Logger,
  options: {
    refreshMs?: number;
    retryMs?: number;
    resolve4?: (host: string) => Promise<string[]>;
    resolve6?: (host: string) => Promise<string[]>;
  } = {}
): InternalClientResolver {
  const resolve4 = options.resolve4 ?? ((host: string) => dns.resolve4(host));
  const resolve6 = options.resolve6 ?? ((host: string) => dns.resolve6(host));
  let hostname: string | null = null;
  try {
    hostname = frontendUrl ? new URL(frontendUrl).hostname.replace(/^\[|\]$/g, "") : null;
  } catch {
    hostname = null;
  }
  let addresses = new Set<string>();
  let lastState: string | null = null;
  let lastRefreshAt = 0;
  let everResolved = false;

  function report(state: string, obj: object, msg: string, level: "info" | "warn") {
    if (state === lastState) return; // yalnızca durum değişince logla — 30 sn'de bir tekrar etmesin
    lastState = state;
    log[level](obj, msg);
  }

  async function refresh(): Promise<void> {
    lastRefreshAt = Date.now();
    if (!hostname || hostname === "localhost") {
      addresses = new Set();
      report("disabled", { hostname }, "İç istemci (frontend) tanıma devre dışı — tüm istekler ziyaretçi limitine tabi", "info");
      return;
    }
    if (isIP(hostname)) {
      addresses = new Set([normalizeAddress(hostname)!]);
      report(`ok:${hostname}`, { addresses: [...addresses] }, "İç istemci (frontend) adresi", "info");
      return;
    }
    const [v4, v6] = await Promise.allSettled([resolve4(hostname), resolve6(hostname)]);
    const next = [...(v4.status === "fulfilled" ? v4.value : []), ...(v6.status === "fulfilled" ? v6.value : [])]
      .map((a) => normalizeAddress(a))
      .filter((a): a is string => a !== null);
    addresses = new Set(next);
    if (next.length === 0) {
      // Compose'da frontend backend sağlıklı olduktan SONRA başlar — ilk açılışta çözümlenememesi
      // beklenir (info); daha önce çözümlenmiş bir adresin kaybolması ise gerçek bir sorundur (warn).
      report(
        "unresolved",
        { hostname },
        everResolved
          ? "İç istemci (frontend) adresi çözümlenemedi — fail-closed, SSR trafiği ziyaretçi limitine tabi"
          : "İç istemci (frontend) adresi henüz çözümlenemedi (frontend başlıyor olabilir) — yeniden denenecek",
        everResolved ? "warn" : "info"
      );
    } else {
      everResolved = true;
      report(`ok:${[...addresses].sort().join(",")}`, { hostname, addresses: [...addresses] }, "İç istemci (frontend) adresi çözümlendi", "info");
    }
  }

  const refreshMs = options.refreshMs ?? INTERNAL_CLIENT_REFRESH_MS;
  const retryMs = options.retryMs ?? INTERNAL_CLIENT_RETRY_MS;
  const timer = setInterval(() => {
    if (addresses.size === 0 || Date.now() - lastRefreshAt >= refreshMs) void refresh().catch(() => {});
  }, Math.min(retryMs, refreshMs));
  timer.unref();

  return {
    isInternal(socketAddress) {
      const normalized = normalizeAddress(socketAddress);
      return normalized !== null && addresses.has(normalized);
    },
    refresh,
    close() {
      clearInterval(timer);
    },
  };
}
