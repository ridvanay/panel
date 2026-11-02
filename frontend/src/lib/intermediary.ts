/**
 * Paket AH — WM Health bir sağlık kuruluşu değil, uluslararası sağlık turizmi aracı kuruluşudur.
 * Ziyaretçi tarafında hiçbir hekim adı/fotoğrafı/unvanı/sayısı gösterilmez. Kayıtlar silinmez;
 * yalnızca ziyaretçi görünümünden çıkarılır (admin ve hekim portalı etkilenmez). Bayrak kodu silmeden
 * yüzeyleri toplu açıp kapatmak içindir.
 */
export const DOCTORS_VISIBLE_TO_VISITORS: boolean = false;

/** Talep formunun yolu (dil önekiz); `service`/`package` sorgu parametreleri isteğe bağlı. */
export function requestFormPath(params?: { service?: string | null; pkg?: string | null }): string {
  const qs = new URLSearchParams();
  if (params?.service) qs.set("service", params.service);
  if (params?.pkg) qs.set("package", params.pkg);
  const query = qs.toString();
  return query ? `/request?${query}` : "/request";
}

/** Blog yazarı etiketi (kişi adı yerine editör ekibi). */
export const EDITORIAL_TEAM_NAME = "WM Health Editorial Team";
