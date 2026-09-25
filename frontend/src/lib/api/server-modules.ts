import { redirect } from "next/navigation";
import { CACHE_TAGS } from "../cache-tags";
import { fetchServerJson } from "./server-fetch";
import { localizePathServer } from "./server-locales";
import type { PublicModule } from "./types";

/** Sunucu bileşenlerinden çağrılır — bkz. server-pages.ts'teki apiFetch kullanılmama gerekçesi. */
export async function fetchPublicModulesServer(): Promise<PublicModule[]> {
  const json = await fetchServerJson<{ data: PublicModule[] }>("/modules", { tags: [CACHE_TAGS.modules] });
  return json?.data ?? [];
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
