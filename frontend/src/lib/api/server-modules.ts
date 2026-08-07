import { API_BASE_URL } from "../env";
import type { PublicModule } from "./types";

/** Sunucu bileşenlerinden çağrılır — bkz. server-pages.ts'teki apiFetch kullanılmama gerekçesi. */
export async function fetchPublicModulesServer(): Promise<PublicModule[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/modules`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const json = (await res.json()) as { data: PublicModule[] };
    return json.data;
  } catch {
    return [];
  }
}

/** Tek bir modülün açık olup olmadığını kontrol eder — bkz. `(site)/products/layout.tsx`. */
export async function isModuleEnabledServer(key: string): Promise<boolean> {
  const modules = await fetchPublicModulesServer();
  return modules.some((module) => module.key === key && module.enabled);
}
