/**
 * Paket N — trafik kaynağı sınıflandırması (saf). Öncelik: UTM > reklam tıklama kimliği (gclid/gbraid/
 * wbraid) > referrer alanı > doğrudan. Kendi alan adımızdan gelen referrer "doğrudan" sayılır.
 */
export interface SourceInput {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  hasAdClickId?: boolean;
  referrerHost?: string | null;
  ownHosts: readonly string[];
}

export interface ClassifiedSource {
  source: string;
  medium: string;
  campaign: string | null;
}

const SEARCH_ENGINES: [RegExp, string][] = [
  [/(^|\.)google\./, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)yandex\./, "yandex"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)yahoo\./, "yahoo"],
  [/(^|\.)baidu\.com$/, "baidu"],
  [/(^|\.)ecosia\.org$/, "ecosia"],
  [/(^|\.)naver\.com$/, "naver"],
];

const SOCIAL: [RegExp, string][] = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|m\.facebook\.com|l\.facebook\.com)$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "x"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "linkedin"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)pinterest\./, "pinterest"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, "whatsapp"],
  [/(^|\.)(t\.me|telegram\.org)$/, "telegram"],
  [/(^|\.)vk\.com$/, "vk"],
];

function clean(value: string | null | undefined, max = 100): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase().slice(0, max);
  return v.length > 0 ? v : null;
}

export function classifySource(input: SourceInput): ClassifiedSource {
  const utmSource = clean(input.utmSource);
  const utmMedium = clean(input.utmMedium);
  const campaign = clean(input.utmCampaign, 150);
  if (utmSource || utmMedium) {
    return { source: utmSource ?? "(not set)", medium: utmMedium ?? "(not set)", campaign };
  }
  if (input.hasAdClickId) {
    return { source: "google", medium: "cpc", campaign };
  }
  const host = clean(input.referrerHost, 200)?.replace(/^www\./, "") ?? null;
  if (!host || input.ownHosts.some((own) => host === own || host.endsWith(`.${own}`))) {
    return { source: "(direct)", medium: "(none)", campaign };
  }
  for (const [pattern, name] of SEARCH_ENGINES) if (pattern.test(host)) return { source: name, medium: "organic", campaign };
  for (const [pattern, name] of SOCIAL) if (pattern.test(host)) return { source: name, medium: "social", campaign };
  return { source: host, medium: "referral", campaign };
}
