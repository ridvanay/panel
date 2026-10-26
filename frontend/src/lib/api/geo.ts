import { apiFetch } from "./client";

/** Paket R — `GET /geo/hint`: IP'den yalnızca ülke kodu + olası dilim (saat dilimi ÖNERİSİ için). */
export interface GeoHint {
  countryCode: string | null;
  timeZone: string | null;
}

const SESSION_KEY = "wm-geo-hint";

/**
 * Sekme oturumunda bir kez sorulur (sessionStorage önbelleği); hata/engel durumunda `null` — öneri
 * yalnızca bir kolaylıktır, randevu akışını asla bloklamaz. IP istemciye geri dönmez.
 */
export async function getGeoHint(): Promise<GeoHint | null> {
  try {
    const cached = window.sessionStorage.getItem(SESSION_KEY);
    if (cached) {
      const value = JSON.parse(cached) as Partial<GeoHint> | null;
      const ok = (v: unknown) => v === null || typeof v === "string";
      if (value && ok(value.countryCode) && ok(value.timeZone)) return { countryCode: value.countryCode ?? null, timeZone: value.timeZone ?? null };
    }
  } catch {
    // sessionStorage yok — doğrudan sor.
  }
  try {
    const hint = await apiFetch<GeoHint>("/geo/hint", { skipAuthRetry: true });
    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(hint));
    } catch {
      // önemsiz
    }
    return hint;
  } catch {
    return null;
  }
}
