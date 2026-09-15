import { DOCTOR_SITE_URL, SITE_URL } from "@/lib/env";

/**
 * `.claude/architect-scope-doctor-subdomain.md` §5.5 — hekim portalının host bazlı izolasyonu için
 * SAF (yan etkisiz), hem sunucu (`proxy.ts`) hem istemci (`DoctorPortalRouteGuard`,
 * `components/auth/login-form.tsx`) tarafından ORTAK kullanılan yardımcı modül. `NEXT_PUBLIC_*`
 * değerleri build-time'da hem sunucu hem istemci paketine AYNI şekilde inline edildiği için
 * (`lib/env.ts`'teki diğer `NEXT_PUBLIC_*` sabitleriyle AYNI desen) bu modül her iki ortamda da
 * güvenle import edilebilir — `"use client"` işareti GEREKMEZ.
 */

function safeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function hostnameOf(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** `SITE_URL` DAİMA geçerli bir mutlak URL'dir (bkz. `lib/env.ts` varsayılanı) — fallback ham değeridir. */
export const SITE_ORIGIN: string = safeOrigin(SITE_URL) ?? SITE_URL;

/**
 * `SITE_ORIGIN`'in çözülmüş hostname'i (port HARİÇ, lowercase), ör. `"siteadi.localhost"`. `proxy.ts`
 * `.claude/architect-scope-doctor-subdomain.md` §6'daki `localhost` → `siteadi.localhost` host
 * migrasyonunu tespit etmek için bunu DIŞARI açık olarak kullanır (eski `Host: localhost` isteklerini
 * `SITE_ORIGIN`'e 307 ile yönlendirmek için) — bu yüzden dışa açık (`export`).
 */
export const SITE_HOST: string | null = hostnameOf(SITE_ORIGIN);
const RAW_DOCTOR_ORIGIN = safeOrigin(DOCTOR_SITE_URL);
const RAW_DOCTOR_HOSTNAME = hostnameOf(RAW_DOCTOR_ORIGIN);

/**
 * §3.4 KARAR — yapılandırma hatası koruması: `NEXT_PUBLIC_DOCTOR_URL` tanımsızsa VEYA çözülen
 * hostname ana site ile AYNIYSA (`DOCTOR_HOST === SITE_HOST`) subdomain modu KAPALI kabul edilir.
 * Bu korunma olmadan `proxy.ts`'in ana-host → doktor-host `/doctor` devri (§3.1 [4]) ile doktor-
 * host'un kendi ana-host'a geri gönderme dalları (§3.1 [9]) arasında sonsuz bir yönlendirme
 * döngüsü oluşur (döngü analizi doğrulaması §3.4'te yazılıdır).
 */
export const DOCTOR_ORIGIN: string | null =
  RAW_DOCTOR_ORIGIN && RAW_DOCTOR_HOSTNAME && RAW_DOCTOR_HOSTNAME !== SITE_HOST ? RAW_DOCTOR_ORIGIN : null;

/** `DOCTOR_ORIGIN`'in çözülmüş hostname'i — `SITE_HOST` ile AYNI dışa açma gerekçesi. */
export const DOCTOR_HOST: string | null = DOCTOR_ORIGIN ? hostnameOf(DOCTOR_ORIGIN) : null;

/** `NEXT_PUBLIC_DOCTOR_URL` geçerli VE ana site'tan farklı bir hostname'e çözülüyorsa `true`. */
export function isSubdomainModeEnabled(): boolean {
  return DOCTOR_ORIGIN !== null;
}

/**
 * `host` bir `Host` header değeri (ör. `"doktor.siteadi.localhost:3000"`, port İÇEREBİLİR) ya da
 * `window.location.hostname` (port İÇERMEZ) olabilir — her iki biçim için de port ayıklanır.
 * Subdomain modu kapalıyken (`DOCTOR_HOST === null`) her zaman `false` döner.
 */
export function isDoctorHostname(host: string): boolean {
  if (!DOCTOR_HOST) return false;
  const normalized = host.split(":")[0]?.trim().toLowerCase() ?? "";
  return normalized.length > 0 && normalized === DOCTOR_HOST;
}

/**
 * §3.6 GÜVENLİK KURALI — bu fonksiyon `path` (`/doctor` gibi, `/` ile başlamalı) için doktor
 * origin'inde mutlak bir URL üretir. Hedef YALNIZCA `DOCTOR_ORIGIN`'den (env'den türetilmiş sabit)
 * gelir; hiçbir zaman çağıranın `Host`/`window.location` değerinden türetilmez — aksi hâlde
 * host-header injection ile açık yönlendirme (open redirect) yüzeyi açılır (security-agent kuralı).
 * Subdomain modu kapalıyken çağrılması BEKLENMEZ (çağıran taraf `isSubdomainModeEnabled()` ile
 * korumalıdır); yine de asla `null`/istisna üretmeyen bir fallback olarak `SITE_ORIGIN` kullanılır.
 */
export function toDoctorOrigin(path: string): string {
  const origin = DOCTOR_ORIGIN ?? SITE_ORIGIN;
  return `${origin}${path}`;
}
