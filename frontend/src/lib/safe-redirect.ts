/**
 * security-agent denetimi (customer-portal, 2026-08-24) — `/login?next=` ve `/register?next=`
 * open redirect koruması. `next.startsWith("/")` TEK BAŞINA yetersizdir: `//evil.com` da bu
 * testten geçer ama tarayıcı/`next/navigation` tarafından protokolü-göreli MUTLAK bir URL olarak
 * çözülür (`new URL("//evil.com", location.href)` → `https://evil.com/`) ve `router.replace()`
 * bunu harici (cross-origin) navigasyon olarak ele alıp tam sayfa yönlendirmesi yapar
 * (`node_modules/next/dist/client/components/app-router-instance.js` → `isExternalURL`).
 * `/\evil.com` gibi ters slash varyantları da tarayıcı tarafından `//evil.com`'a normalize edilir.
 *
 * Bu fonksiyon SADECE site-içi, göreli bir path'e izin verir.
 */
export function isSafeInternalPath(path: string | null | undefined): path is string {
  if (!path) return false;
  if (!path.startsWith("/")) return false;
  // `//evil.com` (protokol-göreli) ve `/\evil.com` (ters slash normalize) bypass'ları.
  if (path.startsWith("//") || path.startsWith("/\\")) return false;
  // Paket O — tarayıcılar URL içindeki TAB/CR/LF karakterlerini siler ("/<TAB>/evil.com" → "//evil.com")
  // ve ters eğik çizgiyi "/" sayar; yolun HERHANGİ bir yerindeki kontrol karakteri ya da "\" reddedilir.
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return false;
  }
  return true;
}
