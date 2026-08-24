import { redirect } from "next/navigation";
import { SERVER_API_BASE_URL } from "../env";
import { localizePathServer } from "./server-locales";
import type { PublicModule } from "./types";

/** Sunucu bileşenlerinden çağrılır — bkz. server-pages.ts'teki apiFetch kullanılmama gerekçesi. */
export async function fetchPublicModulesServer(): Promise<PublicModule[]> {
  try {
    const res = await fetch(`${SERVER_API_BASE_URL}/modules`, { next: { revalidate: 60 } });
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

/**
 * §customer-portal §4.3 — `products` modülü kapalıyken `/hesabim/siparislerim*` ve
 * `/hesabim/favorilerim` rotaları 404 DEĞİL, `/hesabim/profil`'e yönlendirilir (kullanıcı
 * kendi panelinin içindedir, "sayfa yok" yerine "bu bölüm şu an kapalı" davranışı doğrudur).
 * `redirect()` bir hata FIRLATIR — bu fonksiyon her zaman `await` edilen bir Server Component
 * gövdesinden, try/catch DIŞINDA çağrılmalıdır.
 */
export async function redirectIfModuleDisabledServer(lang: string, moduleKey: string): Promise<void> {
  const enabled = await isModuleEnabledServer(moduleKey);
  if (!enabled) {
    redirect(await localizePathServer(lang, "/hesabim/profil"));
  }
}
