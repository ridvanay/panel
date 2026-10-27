import type { DoctorProfile, Locale, SitePage, Specialty } from "@/lib/api/types";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { isHomepageDuplicate, type SitemapData } from "@/lib/sitemap/build";

/**
 * Paket S — `/llms.txt` ve `/llms-full.txt` (llmstxt.org biçimi, Markdown, kanonik dil EN). Yapay zekâ
 * asistanlarının siteyi doğru anlaması için: uzmanlıklar, doktorlar (kurucu en üstte), işleyiş, diller,
 * yasal metinler, iletişim ve ZORUNLU acil durum notu. Yalnızca yayımlanmış/aktif/arşivlenmemiş içerik.
 * Kişisel iletişim bilgisi, fiyat ve hasta verisi YOKTUR.
 */
export const LLMS_CONTACT_EMAIL = "info@wmhealthistanbul.com";
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

/** Klinik rakam içeren biyografiye çekince eklenir (rakamlar doktorun kendi beyanıdır). */
function bioWithCaveat(bio: string): string {
  const clean = sanitizePublicText(bio);
  if (!clean) return "";
  return /\d/.test(clean) ? `${clean} (Figures as stated in the doctor's professional biography.)` : clean;
}

function activeDoctors(data: LlmsData): DoctorProfile[] {
  return data.doctors
    .filter((d) => d.isActive !== false && !d.archivedAt)
    .sort((a, b) => Number(Boolean(b.isFounder)) - Number(Boolean(a.isFounder)) || (a.order ?? 0) - (b.order ?? 0) || a.fullName.localeCompare(b.fullName));
}

function activeSpecialties(data: LlmsData): Specialty[] {
  return data.specialties.filter((s) => s.isActive !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function legalPages(data: LlmsData): SitePage[] {
  return data.pages.filter(
    (p) => p.isLegalDocument && !p.noIndex && (!p.status || p.status === "PUBLISHED") && !isHomepageDuplicate(p, data.homePageId)
  );
}

function doctorLine(data: LlmsData, d: DoctorProfile): string {
  const name = `${d.title} ${d.fullName}`.trim();
  const parts = [d.specialty?.name, d.subSpecialty].filter(Boolean).join(" — ");
  return `- [${name}](${url(data, `/doctors/${d.slug}`)})${d.isFounder ? " (founder)" : ""}${parts ? `: ${parts}` : ""}`;
}

export function buildLlmsTxt(data: LlmsData, { full = false }: { full?: boolean } = {}): string {
  const doctors = activeDoctors(data);
  const specialties = activeSpecialties(data);
  const founder = doctors.find((d) => d.isFounder);
  const enabled = data.locales.filter((l) => l.enabled);
  const defaultCode = defaultLocaleCode(data.locales);
  const languages = enabled.map((l) => languageName(l.code));

  const out: string[] = [];
  out.push(`# ${data.siteName || "WM Health Istanbul"}`, "");
  out.push(
    `> Istanbul-based platform for online video consultations with specialist doctors, built for international patients. ` +
      `Consultations and the website are available in ${languages.join(", ")}.` +
      (founder ? ` Founded by ${`${founder.title} ${founder.fullName}`.trim()}.` : "") +
      ` ${LLMS_EMERGENCY_NOTE}`,
    ""
  );

  out.push("## Specialties", "");
  for (const s of specialties) {
    const sentence = firstSentence(s.description);
    out.push(`- [${s.name}](${url(data, `/specialties/${s.slug}`)})${sentence ? `: ${sentence}` : ""}`);
    if (full) {
      const description = sanitizePublicText(s.description ?? "");
      if (description && description !== sentence) out.push(`  ${description}`);
    }
  }
  out.push("");

  out.push("## Doctors", "");
  for (const d of doctors) {
    out.push(doctorLine(data, d));
    if (full) {
      const bio = bioWithCaveat(d.bio ?? "");
      if (bio) out.push(`  ${bio}`);
    }
  }
  out.push("");

  out.push(
    "## How it works",
    "",
    `1. Choose a specialty or a doctor: [Doctors](${url(data, "/doctors")}), [Specialties](${url(data, "/specialties")}).`,
    "2. Pick an available time on the doctor's page. Times are shown in your own time zone and in Istanbul time.",
    "3. Confirm your details and identity, then pay securely online.",
    "4. At the appointment time, join the private video consultation from the link in your confirmation email or patient portal.",
    "",
    `- [Home page](${url(data, "/")})`,
    `- [Book an appointment](${url(data, "/doctors")}): open a doctor's page and use the booking section.`,
    ""
  );

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
