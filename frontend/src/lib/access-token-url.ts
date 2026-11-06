/**
 * Paket AP — gizli erişim token'ları adres çubuğunda yalnızca `#` parçasında gelir (sunucuya, Nginx log'una,
 * `Referer`'a gitmez). Sayfa token'ı okur, `history.replaceState` ile adresten siler ve aynı sekmede yenileme /
 * geri dönüş için `sessionStorage`'da tutar (`localStorage` KULLANILMAZ). API'ye `X-Access-Token` başlığı ya da
 * POST gövdesiyle gider.
 *
 * Eski bağlantılar (gönderilmiş e-postalar: `?t=`, `?token=`, yol parçası) `LEGACY_TOKEN_IN_URL_UNTIL` tarihine
 * kadar okunur ve hemen yeni biçime çevrilir; süre dolunca "token yok" sayılır. Backend'deki sabitle
 * (`backend/src/lib/access-token-transport.ts`) aynı tarih.
 */
/** Misafir erişim token'ı başlığı (backend: `lib/access-token-transport.ts`). */
export const ACCESS_TOKEN_HEADER = "X-Access-Token";
export const LEGACY_TOKEN_IN_URL_UNTIL = new Date("2026-12-21T00:00:00.000Z");

export function isLegacyTokenTransportAllowed(now: Date = new Date()): boolean {
  return now.getTime() < LEGACY_TOKEN_IN_URL_UNTIL.getTime();
}

/** `#t=…` (anahtarlı) ya da `#…` (çıplak) parçadan token. */
export function readHashToken(hash: string, key?: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  if (!key) {
    try {
      return decodeURIComponent(raw).trim() || null;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(raw).get(key)?.trim() || null;
}

/** `#t=` biçiminde parça — bağlantı üreticileri için. */
export function tokenFragment(token: string | null | undefined, key = "t"): string {
  return token ? `#${key}=${encodeURIComponent(token)}` : "";
}

function storageGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* gizli pencere / engelli depolama: token yalnızca bellekte kalır */
  }
}

export interface TakeTokenOptions {
  /** `#<key>=` anahtarı; verilmezse parçanın tamamı token'dır (`#<token>`). */
  hashKey?: string;
  /** Eski sorgu parametresi (`t`, `token`) — geçiş süresince okunur ve adresten silinir. */
  legacyQueryKey?: string;
  /** Eski yol biçimindeki token (çağıran sayfa yol parametresinden verir) — geçiş süresince. */
  legacyPathToken?: string | null;
  /** Eski yol biçiminde, token'sız yeni yol (ör. `/en/review`) ya da mevcut yoldan onu üreten fonksiyon. */
  cleanPath?: string | ((pathname: string) => string);
  /** `sessionStorage` anahtarı — yoksa token yalnızca bellekte tutulur. */
  storageKey?: string;
}

/**
 * Adresteki token'ı alır ve adresi HEMEN temizler. Öncelik: `#` parçası → eski sorgu / yol (geçiş süresi) →
 * `sessionStorage`. Yalnızca tarayıcıda çağrılır (ör. `useEffect`).
 */
export function takeTokenFromLocation(options: TakeTokenOptions): string | null {
  const url = new URL(window.location.href);
  const legacyAllowed = isLegacyTokenTransportAllowed();
  const fromHash = readHashToken(url.hash, options.hashKey);
  const fromQuery = options.legacyQueryKey ? url.searchParams.get(options.legacyQueryKey)?.trim() || null : null;
  const fromPath = options.legacyPathToken?.trim() || null;

  const hadUrlToken = Boolean(fromHash || fromQuery || fromPath);
  if (hadUrlToken) {
    // Token adreste HİÇ kalmaz — süre dolmuş eski biçim de silinir (geçmişe/`Referer`'a düşmesin).
    if (options.legacyQueryKey) url.searchParams.delete(options.legacyQueryKey);
    url.hash = "";
    if (fromPath && options.cleanPath) url.pathname = typeof options.cleanPath === "function" ? options.cleanPath(url.pathname) : options.cleanPath;
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  }

  const token = fromHash ?? (legacyAllowed ? (fromQuery ?? fromPath) : null);
  if (token) {
    if (options.storageKey) storageSet(options.storageKey, token);
    return token;
  }
  return options.storageKey ? storageGet(options.storageKey) : null;
}
