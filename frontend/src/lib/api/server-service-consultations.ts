import { fetchServerJson } from "./server-fetch";
import type { ServiceConsultationConfig } from "./service-consultations";

/**
 * AI İş 3 — `GET /service-consultations/config` (sunucu tarafı, `fetchServerJson` ile 60 sn önbellek).
 * Rezervasyon altyapısı bir hata verirse siteyi BOZMAMAK için her hatada `null` (= kapalı) döner; düğmeler `/request`'e gider.
 */
export async function fetchServiceConsultationConfigServer(): Promise<ServiceConsultationConfig | null> {
  try {
    const json = await fetchServerJson<{ data: ServiceConsultationConfig }>("/service-consultations/config");
    return json?.data ?? null;
  } catch {
    return null;
  }
}

/** Düğme yönlendirmeleri için: rezervasyon açık mı? */
export async function isServiceBookingEnabledServer(): Promise<boolean> {
  const config = await fetchServiceConsultationConfigServer();
  return config?.enabled === true;
}
