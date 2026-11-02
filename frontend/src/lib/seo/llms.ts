import type { Locale, SitePage, Specialty } from "@/lib/api/types";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { isHomepageDuplicate, type SitemapData } from "@/lib/sitemap/build";

/**
 * Paket S — `/llms.txt` ve `/llms-full.txt` (llmstxt.org biçimi, Markdown, kanonik dil EN). Yapay zekâ
 * asistanlarının siteyi doğru anlaması için: hizmetler (bölümler), işleyiş, diller,
 * yasal metinler, iletişim ve ZORUNLU acil durum notu. Yalnızca yayımlanmış/aktif/arşivlenmemiş içerik.
 * Kişisel iletişim bilgisi, fiyat ve hasta verisi YOKTUR.
 */
export const LLMS_CONTACT_EMAIL = "info@wmhealthistanbul.com";
/** Paket AH — kurumsal kimlik ibaresi (aracı kuruluş; sağlık kuruluşu değil). Hekim adı/sayısı llms çıktısında YOKTUR. */
export const LLMS_INTERMEDIARY_NOTE =
  "WM Health is an international health tourism intermediary organization, not a healthcare provider. All medical treatments are performed by healthcare facilities holding an International Health Tourism Authorization Certificate issued by the Republic of Türkiye Ministry of Health.";
export const LLMS_EMERGENCY_NOTE = "Not for medical emergencies. Information on this site does not replace an in-person examination.";

export type LlmsData = SitemapData & { siteName: string };

function url(data: LlmsData, path: string): string {
  return path === "/" ? data.siteUrl : `${data.siteUrl}${path}`;
}

function defaultLocaleCode(locales: Locale[]): string {
  const enabled = locales.filter((l) => l.enabled);
  return (enabled.find((l) => l.isDefault) ?? enabled[0])?.code ?? "en";
}

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Metinden e-posta, telefon, bağlantı ve fiyat içeren cümleleri ayıklar (kişisel iletişim/fiyat yok). */
// İnceleme bulgusu — telefon kalıbı yıl aralıklarını ("2010-2015") yakalamasın: `+` ile başlayan ya da
// 3-3-2/4 gruplu numaralar. Fiyat: sembol, ISO kodu ya da sözcükle ("100 euros", "200 lira").
const CONTACT_OR_PRICE =
  /[\w.+-]+@[\w-]+\.[\w.]+|\+\d[\d\s().-]{7,}\d|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{2,4}\b|https?:\/\/|www\.|[€$£₺]|\b(?:EUR|USD|TRY|TL|GBP)\b|\b\d[\d.,]*\s?(?:euros?|dollars?|lira|liras|pounds?)\b/i;

export function sanitizePublicText(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !CONTACT_OR_PRICE.test(sentence))
    .join(" ")
    .trim();
}

function firstSentence(text: string | null | undefined): string {
  const clean = sanitizePublicText(text ?? "");
  const match = /^.+?[.!?](\s|$)/.exec(clean);
  return (match ? match[0] : clean).trim();
}

function activeSpecialties(data: LlmsData): Specialty[] {
  return data.specialties.filter((s) => s.isActive !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function legalPages(data: LlmsData): SitePage[] {
  return data.pages.filter(
    (p) => p.isLegalDocument && !p.noIndex && (!p.status || p.status === "PUBLISHED") && !isHomepageDuplicate(p, data.homePageId)
  );
}

export function buildLlmsTxt(data: LlmsData, { full = false }: { full?: boolean } = {}): string {
  const specialties = activeSpecialties(data);
  const enabled = data.locales.filter((l) => l.enabled);
  const defaultCode = defaultLocaleCode(data.locales);
  const languages = enabled.map((l) => languageName(l.code));

  const out: string[] = [];
  out.push(`# ${data.siteName || "WM Health Istanbul"}`, "");
  out.push(
    `> ${LLMS_INTERMEDIARY_NOTE} ` +
      `The website is available in ${languages.join(", ")}. ${LLMS_EMERGENCY_NOTE}`,
    ""
  );

  out.push("## Health tourism services", "", `- [All services](${url(data, "/specialties")})`, `- [Find your treatment](${url(data, "/find-your-treatment")}): answer a few questions and get a suggestion for the right service`);
  for (const s of specialties) {
    const sentence = firstSentence(s.description);
    out.push(`- [${s.name}](${url(data, `/specialties/${s.slug}`)})${sentence ? `: ${sentence}` : ""}`);
    if (full) {
      const description = sanitizePublicText(s.description ?? "");
      if (description && description !== sentence) out.push(`  ${description}`);
    }
  }
  out.push("");

  out.push(
    "## How it works",
    "",
    `1. Choose a service: [Health Tourism Services](${url(data, "/specialties")}), or use [Find your treatment](${url(data, "/find-your-treatment")}).`,
    `2. Send a consultation request: [Request a consultation](${url(data, "/request")}).`,
    "3. A patient coordinator contacts you within 1 business day and plans your treatment, travel and stay.",
    "4. Treatment is performed at an authorized healthcare facility; the coordinator supports you before, during and after your visit.",
    "",
    `- [Home page](${url(data, "/")})`,
    `- [VIP accommodation and transfer](${url(data, "/vip-accommodation-transfer")})`,
    ""
  );

  const packages = (data.packages ?? []).filter((p) => p.locales.length > 0);
  if (packages.length > 0) {
    out.push("## Health packages", "", `- [All health packages](${url(data, "/packages")})`);
    for (const p of packages) {
      const sentence = firstSentence(p.summary);
      out.push(`- [${p.title || p.slug}](${url(data, `/packages/${p.slug}`)})${sentence ? `: ${sentence}` : ""}`);
    }
    out.push("");
  }

  // Paket Z1 — sağlık rehberleri (blog): yalnızca indekslenebilir yayındaki yazılar, en yenisi önce.
  const posts = (data.posts ?? [])
    .filter((p) => !p.noIndex && p.title)
    .sort((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? "") || 0);
  if (posts.length > 0) {
    out.push("## Health guides", "", `- [All health guides](${url(data, "/blog")}): patient guides written by the editorial team from reliable public health sources.`);
    for (const post of full ? posts : posts.slice(0, 20)) {
      const sentence = firstSentence(post.excerpt);
      out.push(`- [${post.title}](${url(data, `/blog/${post.slug}`)})${sentence ? `: ${sentence}` : ""}`);
    }
    out.push("");
  }

  out.push("## Languages", "");
  for (const l of enabled) {
    const prefix = withLocalePrefix("/", l.code, defaultCode);
    out.push(`- ${languageName(l.code)} (${l.code}): ${url(data, prefix)}${l.code === defaultCode ? " (default, no prefix)" : ""}`);
  }
  out.push("");

  const legal = legalPages(data);
  if (legal.length > 0) {
    out.push("## Legal", "");
    for (const page of legal) out.push(`- [${page.title}](${url(data, `/${page.slug}`)})`);
    out.push("");
  }

  out.push("## Contact", "", `- Email: ${LLMS_CONTACT_EMAIL}`, "", "## Important", "", `- ${LLMS_EMERGENCY_NOTE}`, "");
  return out.join("\n");
}

export const LLMS_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
} as const;
