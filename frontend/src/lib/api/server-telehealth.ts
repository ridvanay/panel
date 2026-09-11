import { SERVER_API_BASE_URL, toInternalMediaUrl } from "../env";
import type { AvailabilitySlot, DoctorProfile } from "./types";

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
