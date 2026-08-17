import { SERVER_API_BASE_URL } from "../env";
import type { Locale } from "./types";

/**
 * Tek başına içerik olmadığında bile site her zaman en az bir dilde çalışmalıdır — ağ hatasında
 * "tr" varsayılan dile düşülür (bkz. server-settings.ts'teki AYNI fail-open deseni). Bu SADECE
 * bir son çare fallback'idir; normal koşulda liste her zaman `GET /locales`'ten gelir (sabit dil
 * listesi KODA GÖMÜLMEZ — `.claude/architect-scope-i18n.md` §4.3).
 */
const FALLBACK_LOCALES: Locale[] = [
  { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
];

/**
 * `GET /locales` (public) — site dil değiştirici ve `[lang]` rota doğrulaması bunu okur.
 * Önbellek politikası `GET /appearance` ile AYNIDIR (`revalidate: 60`, bkz. proxy.ts).
 */
export async function fetchLocalesServer(): Promise<Locale[]> {
  try {
    const res = await fetch(`${SERVER_API_BASE_URL}/locales`, { next: { revalidate: 60 } });
    if (!res.ok) return FALLBACK_LOCALES;
    const json = (await res.json()) as { data: Locale[] };
    if (!json.data || json.data.length === 0) return FALLBACK_LOCALES;
    return json.data;
  } catch {
    return FALLBACK_LOCALES;
  }
}

export async function fetchDefaultLocaleServer(): Promise<Locale> {
  const locales = await fetchLocalesServer();
  return locales.find((l) => l.isDefault) ?? locales[0] ?? FALLBACK_LOCALES[0]!;
}

export { FALLBACK_LOCALES };
