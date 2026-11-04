/**
 * Paket AK (K5) — iletişim sayfası "Open in Google Maps" bağlantısı: adres doluysa HER ZAMAN adresi aratır
 * (eski/yanlış kayıtlı `mapUrl` yeni adresi geçersiz kılmasın); `mapUrl` yalnızca adres yoksa kullanılır.
 */
export function mapsHref(mapUrl: string, address: string): string | null {
  const trimmedAddress = address.trim();
  if (trimmedAddress) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmedAddress)}`;
  if (mapUrl) return mapUrl;
  return null;
}
