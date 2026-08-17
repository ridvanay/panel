import { SERVER_API_BASE_URL } from "../env";
import type { Plan } from "./types";

/**
 * Sunucu bileşenlerinden (SSR) çağrılmak üzere ayrı, minimal bir fetch — `client.ts`'teki
 * `apiFetch` kasıtlı olarak burada KULLANILMAZ: onun token-store'u modül seviyeli tek bir
 * bellek değişkenidir, tarayıcıda sekme başına güvenlidir ama Next sunucu sürecinde tüm
 * istekler arasında paylaşılır — SSR'da kullanılırsa kullanıcılar arası token sızıntısına
 * yol açar. GET /plans zaten herkese açık olduğundan basit, damgasız bir fetch yeterli.
 */
export async function fetchPlansServer(): Promise<Plan[]> {
  try {
    const res = await fetch(`${SERVER_API_BASE_URL}/plans`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const json = (await res.json()) as { data: Plan[] };
    return json.data;
  } catch {
    return [];
  }
}
