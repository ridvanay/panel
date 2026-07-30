/**
 * Erişim (access) token'ı yalnızca bellekte tutan modül-seviyeli mağaza.
 * Bilinçli tercih: backend token'ı response body'de döner (cookie'de değil), bu yüzden
 * sayfa yenilendiğinde bellek sıfırlanır — AuthProvider mount olduğunda `/auth/refresh`
 * ile (httpOnly refresh cookie üzerinden) sessizce yeniden hidratlar. Bkz. AuthProvider.
 */
let accessToken: string | null = null;
const listeners = new Set<(token: string | null) => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  listeners.forEach((listener) => listener(token));
}

export function clearAccessToken(): void {
  setAccessToken(null);
}

export function subscribeAccessToken(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
