import { CACHE_TAGS } from "@/lib/cache-tags";
import { fetchServerJson } from "@/lib/api/server-fetch";

/** Paket N — `GET /crm/config` (public). Takip kapalıysa yükleyici hiçbir şey yapmaz. */
export interface CrmPublicConfig {
  trackingEnabled: boolean;
  trackStaff: boolean;
  whatsappRef: boolean;
  excludedPaths: string[];
  consentVersion: string;
  heartbeatSeconds: number;
}

/** Hata/erişilemezlik durumunda `null` → takip YÜKLENMEZ (fail-closed). */
export async function fetchCrmConfigServer(): Promise<CrmPublicConfig | null> {
  try {
    const json = await fetchServerJson<{ data: CrmPublicConfig }>("/crm/config", { tags: [CACHE_TAGS.crmConfig] });
    return json?.data ?? null;
  } catch {
    return null;
  }
}
