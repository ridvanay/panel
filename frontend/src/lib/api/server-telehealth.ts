import { SERVER_API_BASE_URL, toInternalMediaUrl } from "../env";
import { CACHE_TAGS } from "../cache-tags";
import { fetchServerJson } from "./server-fetch";
import type { FeaturedReviewsData, ReviewsListResponse } from "../review-types";
import type { AvailabilitySlot, DoctorProfile, DoctorReviewsResponse, DoctorShowcase, Specialty, SpecialtyWithDoctorCount, TelehealthThemeSettings } from "./types";

/**
 * `.claude/architect-scope-telehealth-template.md` §5.2 — public `/doctors*` sunucu bileşenleri
 * için tek veri kaynağı. `apiFetch` KULLANILMAZ (bkz. `server-products.ts`'teki gerekçe — sunucu
 * bileşenleri istemci-yalnızca `token-store`/`credentials: include` akışına girmez).
 */

export interface ListDoctorsServerFilters {
  specialtySlug?: string;
  language?: string;
  search?: string;
  /** Paket L — aktif içerik dili; doktor title/bio/aboutHtml/subSpecialty çevirisi (yoksa kanonik). */
  locale?: string;
}

export async function fetchDoctorsServer(filters: ListDoctorsServerFilters = {}): Promise<DoctorProfile[]> {
  const query = new URLSearchParams({ limit: "100" });
  if (filters.specialtySlug) query.set("specialtySlug", filters.specialtySlug);
  if (filters.language) query.set("language", filters.language);
  if (filters.search) query.set("search", filters.search);
  if (filters.locale) query.set("locale", filters.locale);
  const json = await fetchServerJson<{ data: DoctorProfile[] }>(`/doctors?${query.toString()}`, {
    tags: [CACHE_TAGS.doctors],
    transformText: toInternalMediaUrl,
  });
  return json?.data ?? [];
}

/**
 * Paket D — public doktorların TAMAMI (cursor ile sayfalanır). `fetchDoctorsServer` tek sayfa (100)
 * döndürür; 100'den fazla aktif doktorda öne çıkan doktorlar bloğu seçili doktoru kaçırmasın diye.
 * Sonsuz döngüye karşı en fazla `maxPages` sayfa.
 */
export async function fetchAllDoctorsServer(maxPages = 10, locale?: string): Promise<DoctorProfile[]> {
  const doctors: DoctorProfile[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    if (locale) query.set("locale", locale);
    const json: { data: DoctorProfile[]; meta?: { nextCursor?: string | null } } | null = await fetchServerJson(`/doctors?${query.toString()}`, {
      tags: [CACHE_TAGS.doctors],
      transformText: toInternalMediaUrl,
    });
    doctors.push(...(json?.data ?? []));
    cursor = json?.meta?.nextCursor ?? null;
    if (!cursor) break;
  }
  return doctors;
}

export async function fetchDoctorBySlugServer(slug: string, locale?: string): Promise<DoctorProfile | null> {
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  const json = await fetchServerJson<{ data: DoctorProfile }>(`/doctors/${encodeURIComponent(slug)}${query}`, {
    tags: [CACHE_TAGS.doctors],
    transformText: toInternalMediaUrl,
  });
  return json?.data ?? null;
}

/**
 * Paket Y — hekim vitrini (işlemler + foto/video). Geçici hatada fırlatmak yerine boş vitrin
 * dönülür: profil sayfası vitrin yüzünden düşmemeli (bölümler zaten boşsa gizlenir).
 */
export async function fetchDoctorShowcaseServer(slug: string, locale?: string): Promise<DoctorShowcase> {
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  try {
    const json = await fetchServerJson<{ data: DoctorShowcase }>(`/doctors/${encodeURIComponent(slug)}/showcase${query}`, {
      tags: [CACHE_TAGS.doctors],
      transformText: toInternalMediaUrl,
    });
    return json?.data ?? { procedures: [], media: [] };
  } catch {
    return { procedures: [], media: [] };
  }
}

/** Paket Y — yorumların İLK sayfası (SEO için sunucuda); sonraki sayfalar/filtreler istemcide. Hata → `null`. */
export async function fetchDoctorReviewsServer(slug: string, locale?: string): Promise<DoctorReviewsResponse | null> {
  const query = new URLSearchParams({ sort: "newest", page: "1" });
  if (locale) query.set("locale", locale);
  try {
    const json = await fetchServerJson<{ data: DoctorReviewsResponse }>(`/doctors/${encodeURIComponent(slug)}/reviews?${query.toString()}`, {
      tags: [CACHE_TAGS.doctors],
    });
    return json?.data ?? null;
  } catch {
    return null;
  }
}

/** Paket Y — anasayfa karuseli (`GET /reviews/featured`). Hata/boş → `null` (bölüm görünmez). */
export async function fetchFeaturedReviewsServer(locale?: string): Promise<FeaturedReviewsData | null> {
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  try {
    const json = await fetchServerJson<{ data: FeaturedReviewsData }>(`/reviews/featured${query}`);
    return json?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Paket AE — `GET /reviews` (herkese açık yorum listesi). 404/boş → `null`; 5xx/ağ hatası da `null`
 * (sayfa kendi hata durumunu gösterir, tüm site hata sayfasına düşmez).
 */
export async function fetchReviewsListServer(params: { locale: string; doctor?: string; language?: string; minRating?: number; page?: number }): Promise<ReviewsListResponse | null> {
  const query = new URLSearchParams({ locale: params.locale });
  if (params.doctor) query.set("doctor", params.doctor);
  if (params.language) query.set("language", params.language);
  if (params.minRating) query.set("minRating", String(params.minRating));
  if (params.page && params.page > 1) query.set("page", String(params.page));
  try {
    const json = await fetchServerJson<{ data: ReviewsListResponse }>(`/reviews?${query.toString()}`);
    return json?.data ?? null;
  } catch {
    return null;
  }
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
export async function fetchSpecialtiesServer(locale?: string): Promise<Specialty[]> {
  // Paket O — `locale`: uzmanlık adı/açıklaması o dilde (çeviri yoksa kanonik EN).
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  const json = await fetchServerJson<{ data: Specialty[] }>(`/specialties${query}`, { tags: [CACHE_TAGS.specialties] });
  return json?.data ?? [];
}

/**
 * `GET /specialties/{slug}` (public) — `Specialty` + `doctorCount`. `fetchDoctorBySlugServer` İLE
 * AYNI desen: bulunamazsa/404 ise `null` (varlığı SIZDIRILMAZ, `notFound()` çağıran taraftadır).
 */
export async function fetchSpecialtyBySlugServer(slug: string, locale?: string): Promise<SpecialtyWithDoctorCount | null> {
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  const json = await fetchServerJson<{ data: SpecialtyWithDoctorCount }>(`/specialties/${encodeURIComponent(slug)}${query}`, {
    tags: [CACHE_TAGS.specialties],
  });
  return json?.data ?? null;
}
