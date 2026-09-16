import { SERVER_API_BASE_URL, toInternalMediaUrl } from "../env";
import type { AvailabilitySlot, DoctorProfile, Specialty, SpecialtyWithDoctorCount, TelehealthThemeSettings } from "./types";

/**
 * `.claude/architect-scope-telehealth-template.md` §5.2 — public `/doctors*` sunucu bileşenleri
 * için tek veri kaynağı. `apiFetch` KULLANILMAZ (bkz. `server-products.ts`'teki gerekçe — sunucu
 * bileşenleri istemci-yalnızca `token-store`/`credentials: include` akışına girmez).
 */

export interface ListDoctorsServerFilters {
  specialtySlug?: string;
  language?: string;
  search?: string;
}

export async function fetchDoctorsServer(filters: ListDoctorsServerFilters = {}): Promise<DoctorProfile[]> {
  try {
    const query = new URLSearchParams({ limit: "100" });
    if (filters.specialtySlug) query.set("specialtySlug", filters.specialtySlug);
    if (filters.language) query.set("language", filters.language);
    if (filters.search) query.set("search", filters.search);

    const res = await fetch(`${SERVER_API_BASE_URL}/doctors?${query.toString()}`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const json = JSON.parse(toInternalMediaUrl(await res.text())) as { data: DoctorProfile[] };
    return json.data;
  } catch {
    return [];
  }
}

export async function fetchDoctorBySlugServer(slug: string): Promise<DoctorProfile | null> {
  try {
    const res = await fetch(`${SERVER_API_BASE_URL}/doctors/${encodeURIComponent(slug)}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = JSON.parse(toInternalMediaUrl(await res.text())) as { data: DoctorProfile };
    return json.data;
  } catch {
    return null;
  }
}

/**
 * §4.2 (bağlayıcı) — slot VERİSİ sunucuda alınır (SSR), ama SAATLER `AvailabilityCalendar`
 * (istemci bileşeni) içinde ziyaretçinin diliminde biçimlendirilir. Sunucu yalnızca ISO-8601
 * `Z`'li anları taşır, hiçbir yerel saat string'i üretmez.
 */
export async function fetchDoctorSlotsServer(slug: string, from: string, to: string): Promise<AvailabilitySlot[]> {
  try {
    const res = await fetch(`${SERVER_API_BASE_URL}/doctors/${encodeURIComponent(slug)}/slots?from=${from}&to=${to}`, {
      // Slot müsaitliği randevu alımıyla saniyeler içinde değişebilir — 60sn'lik genel ISR
      // gecikmesi burada KABUL EDİLEMEZ (bir hasta az önce alınmış bir saati görüp seçebilir).
      // `AvailabilityCalendar` istemci tarafında zaten kendi tazeleme/yeniden-doğrulamasını yapar.
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data: AvailabilitySlot[] };
    return json.data;
  } catch {
    return [];
  }
}

/**
 * Görev (2026-09-14) Görev 1/2 — `GET /telehealth/theme` (PUBLIC, prefiks YOK) sunucu tarafı
 * çağrısı. `fetchSiteAppearanceServer` İLE AYNI önbellek politikası (`revalidate: 60`, §10.12.9)
 * ve "asla çökme" ilkesi: backend erişilemezse/`telehealth` modülü kapalıysa (404) backend
 * `TELEHEALTH_THEME_DEFAULTS` (`backend/src/schemas/entities.ts`) İLE BİREBİR AYNI sabit
 * değerlere düşülür — `doctors/layout.tsx`'in `.telehealth-scope` enjeksiyonu bu yüzden asla
 * bozuk/eksik bir tema ile render edilmez.
 */
const TELEHEALTH_THEME_DEFAULTS: TelehealthThemeSettings = {
  primaryColor: "#0f766e",
  secondaryColor: "#0369a1",
  accentColor: "#f59e0b",
  calendarActiveBg: "#0f766e",
};

export async function fetchTelehealthThemeServer(): Promise<TelehealthThemeSettings> {
  try {
    const res = await fetch(`${SERVER_API_BASE_URL}/telehealth/theme`, { next: { revalidate: 60 } });
    if (!res.ok) return TELEHEALTH_THEME_DEFAULTS;
    const json = JSON.parse(toInternalMediaUrl(await res.text())) as { data: TelehealthThemeSettings };
    return json.data;
  } catch {
    return TELEHEALTH_THEME_DEFAULTS;
  }
}

export { TELEHEALTH_THEME_DEFAULTS };

/**
 * Görev (2026-09-16) — `GET /specialties` (public, sayfalama YOK) sunucu tarafı çağrısı.
 * `fetchDoctorsServer` İLE AYNI "asla çökme" ilkesi (§9.5): backend erişilemezse/`telehealth`
 * modülü kapalıysa (404) `[]` döner — çağıran sayfalar (`/specialties`, `sitemap.ts`) bu durumda
 * sessizce boş liste/empty-state render eder.
 */
export async function fetchSpecialtiesServer(): Promise<Specialty[]> {
  try {
    const res = await fetch(`${SERVER_API_BASE_URL}/specialties`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const json = (await res.json()) as { data: Specialty[] };
    return json.data;
  } catch {
    return [];
  }
}

/**
 * `GET /specialties/{slug}` (public) — `Specialty` + `doctorCount`. `fetchDoctorBySlugServer` İLE
 * AYNI desen: bulunamazsa/404 ise `null` (varlığı SIZDIRILMAZ, `notFound()` çağıran taraftadır).
 */
export async function fetchSpecialtyBySlugServer(slug: string): Promise<SpecialtyWithDoctorCount | null> {
  try {
    const res = await fetch(`${SERVER_API_BASE_URL}/specialties/${encodeURIComponent(slug)}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: SpecialtyWithDoctorCount };
    return json.data;
  } catch {
    return null;
  }
}
