import { SERVER_API_BASE_URL, toInternalMediaUrl } from "../env";
import { CACHE_TAGS } from "../cache-tags";
import { fetchServerJson } from "./server-fetch";
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
  const query = new URLSearchParams({ limit: "100" });
  if (filters.specialtySlug) query.set("specialtySlug", filters.specialtySlug);
  if (filters.language) query.set("language", filters.language);
  if (filters.search) query.set("search", filters.search);
  const json = await fetchServerJson<{ data: DoctorProfile[] }>(`/doctors?${query.toString()}`, {
    tags: [CACHE_TAGS.doctors],
    transformText: toInternalMediaUrl,
  });
  return json?.data ?? [];
}

export async function fetchDoctorBySlugServer(slug: string): Promise<DoctorProfile | null> {
  const json = await fetchServerJson<{ data: DoctorProfile }>(`/doctors/${encodeURIComponent(slug)}`, {
    tags: [CACHE_TAGS.doctors],
    transformText: toInternalMediaUrl,
  });
  return json?.data ?? null;
}

/**
 * §4.2 (bağlayıcı) — slot VERİSİ sunucuda alınır (SSR), ama SAATLER `AvailabilityCalendar`
 * (istemci bileşeni) içinde ziyaretçinin diliminde biçimlendirilir. Sunucu yalnızca ISO-8601
 * `Z`'li anları taşır, hiçbir yerel saat string'i üretmez. Diğer fetch'lerin AKSİNE hata fırlatmaz:
 * `no-store` (önbelleğe girmez) ve takvim istemcide kendi tazelemesini yapar — boş liste geçicidir.
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
 * `telehealth` modülü kapalıysa (404) backend
 * `TELEHEALTH_THEME_DEFAULTS` (`backend/src/schemas/entities.ts`) İLE BİREBİR AYNI sabit
 * değerlere düşülür — `doctors/layout.tsx`'in `.telehealth-scope` enjeksiyonu bu yüzden asla
 * bozuk/eksik bir tema ile render edilmez. 429/5xx/ağ hatası fırlatır (bkz. server-fetch.ts) —
 * önbellekteki eski sayfa sunulmaya devam eder.
 */
const TELEHEALTH_THEME_DEFAULTS: TelehealthThemeSettings = {
  primaryColor: "#0f766e",
  secondaryColor: "#0369a1",
  accentColor: "#f59e0b",
  calendarActiveBg: "#0f766e",
  // Acil durum uyarısı — modül kapalıyken (404) de şerit AÇIK ve sözlük metinleri (güvenli taraf).
  emergencyNotice: { enabled: true, summary: {}, full: {} },
};

export async function fetchTelehealthThemeServer(): Promise<TelehealthThemeSettings> {
  const json = await fetchServerJson<{ data: TelehealthThemeSettings }>("/telehealth/theme", {
    tags: [CACHE_TAGS.telehealthTheme],
    transformText: toInternalMediaUrl,
  });
  return json?.data ?? TELEHEALTH_THEME_DEFAULTS;
}

export { TELEHEALTH_THEME_DEFAULTS };

/**
 * Görev (2026-09-16) — `GET /specialties` (public, sayfalama YOK) sunucu tarafı çağrısı.
 * `telehealth` modülü kapalıysa (404) `[]` döner — çağıran sayfalar (`/specialties`, `sitemap.ts`)
 * bu durumda boş liste/empty-state render eder. 429/5xx/ağ hatası fırlatır (bkz. server-fetch.ts).
 */
export async function fetchSpecialtiesServer(): Promise<Specialty[]> {
  const json = await fetchServerJson<{ data: Specialty[] }>("/specialties", { tags: [CACHE_TAGS.specialties] });
  return json?.data ?? [];
}

/**
 * `GET /specialties/{slug}` (public) — `Specialty` + `doctorCount`. `fetchDoctorBySlugServer` İLE
 * AYNI desen: bulunamazsa/404 ise `null` (varlığı SIZDIRILMAZ, `notFound()` çağıran taraftadır).
 */
export async function fetchSpecialtyBySlugServer(slug: string): Promise<SpecialtyWithDoctorCount | null> {
  const json = await fetchServerJson<{ data: SpecialtyWithDoctorCount }>(`/specialties/${encodeURIComponent(slug)}`, { tags: [CACHE_TAGS.specialties] });
  return json?.data ?? null;
}
