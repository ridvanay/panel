import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { siteDictionary as en } from "@/lib/i18n/site-dictionaries/en";
import { siteDictionary as tr } from "@/lib/i18n/site-dictionaries/tr";
import { siteDictionary as de } from "@/lib/i18n/site-dictionaries/de";
import { siteDictionary as es } from "@/lib/i18n/site-dictionaries/es";
import { siteDictionary as fr } from "@/lib/i18n/site-dictionaries/fr";
import { siteDictionary as ar } from "@/lib/i18n/site-dictionaries/ar";
import { siteDictionary as ru } from "@/lib/i18n/site-dictionaries/ru";
import { siteDictionary as ro } from "@/lib/i18n/site-dictionaries/ro";
import { siteDictionary as srLatn } from "@/lib/i18n/site-dictionaries/sr-latn";
import { resolveLanguageSupport } from "@/lib/language-support";
import { SupportLanguagesBand } from "@/components/site/support/support-languages-band";
import { SupportBadge } from "@/components/site/support/support-badge";
import { AccreditationList } from "@/components/site/accreditations/accreditation-list";
import { AccreditationStrip } from "@/components/site/accreditations/accreditation-strip";
import { SiteFooter } from "@/components/site/site-footer";
import { buildMedicalOrganizationJsonLd } from "@/lib/page-builder/structured-data";
import { SITEMAP_SECTIONS, buildIndex, buildSection, type SitemapData } from "@/lib/sitemap/build";
import type { DoctorProfile, PublicAccreditation, SiteSettings, Specialty, TelehealthThemeSettings } from "@/lib/api/types";

/**
 * Paket V — sözlük anahtar eşitliği (9 dil), destek bandı/rozeti doğruluk kuralı, yetki belgeleri
 * görünümü ve JSON-LD, sitemap'te `/doctors` kalmaması ve hekimsiz uzmanlığın dışarıda kalması,
 * kaynakta eski site yolu kalmaması (tarama testi).
 */
const DICTS = { en, tr, de, es, fr, ar, ru, ro, "sr-latn": srLatn };

function keyPaths(value: unknown, prefix = ""): string[] {
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
  return [prefix];
}

describe("sözlük anahtar eşitliği (9 dil)", () => {
  const enKeys = keyPaths(en).sort();
  it.each(Object.entries(DICTS))("%s: EN ile aynı anahtarlar, boş değer yok", (_code, dict) => {
    expect(keyPaths(dict).sort()).toEqual(enKeys);
    for (const key of ["nav.consultPhysicians", "nav.languageSheetTitle", "common.supportBandTitle", "common.accreditationStripTitle", "telehealth.specialtyCoordinatorTitle"]) {
      const value = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], dict);
      expect(typeof value === "string" && value.trim().length > 0, key).toBe(true);
    }
  });

  it("menü etiketi tablosu: EN Consult Physicians, TR Hekime Danışın; sr-latn Latin alfabesi", () => {
    expect(en.nav.consultPhysicians).toBe("Consult Physicians");
    expect(tr.nav.consultPhysicians).toBe("Hekime Danışın");
    expect(JSON.stringify(srLatn)).not.toMatch(/[Ѐ-ӿ]/);
    expect(en.telehealth.doctorsPageTitle).toBe("Physicians");
    expect(en.telehealth.featuredDoctorsCarouselLabel).toBe("Featured physicians");
    expect(en.telehealth.viewProfileCta).toBe("View physician");
  });
});

const settingsWith = (languageSupport: TelehealthThemeSettings["languageSupport"]) => ({ languageSupport }) as Pick<TelehealthThemeSettings, "languageSupport">;

describe("kendi dilinizde destek — doğruluk kuralı", () => {
  it("liste boşsa (varsayılan) bölüm yok: band, rozet ve footer satırı render edilmez", () => {
    expect(resolveLanguageSupport(null, "en")).toBeNull();
    expect(resolveLanguageSupport(settingsWith({ supportLanguages: [], supportHours: { en: "9-18" }, interpreterIncluded: true }), "en")).toBeNull();
    const { container } = render(
      <>
        <SupportLanguagesBand support={null} dict={en.common} chatEnabled contactHref="/contact" />
        <SupportBadge support={null} label={en.common.supportBadge} />
      </>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("doluyken yalnızca seçili diller; tercüman cümlesi yalnızca interpreterIncluded; saatler aktif dil → EN", () => {
    const support = resolveLanguageSupport(
      settingsWith({ supportLanguages: ["en", "ar", "it"], supportHours: { en: "Mon–Sat 09:00–21:00" }, interpreterIncluded: false }),
      "de",
      [{ code: "ar", nativeLabel: "العربية" }]
    );
    render(<SupportLanguagesBand support={support} dict={en.common} chatEnabled={false} contactHref="/en/contact" />);
    const band = screen.getByTestId("support-languages-band");
    const items = within(within(band).getByRole("list", { name: "Supported languages" })).getAllByRole("listitem");
    // Bayrağı olmayan dil (it) için nötr kod rozeti ("IT") gösterilir; ad ayrı öğededir.
    expect(items.map((li) => li.querySelector("[lang]")?.textContent)).toEqual(["English", "العربية", "Italiano"]);
    expect(within(band).getByText("العربية")).toHaveAttribute("dir", "rtl");
    expect(band).not.toHaveTextContent(en.common.supportInterpreterIncluded);
    expect(band).toHaveTextContent("Mon–Sat 09:00–21:00");
    // Canlı destek kapalıyken yalnızca iletişim ("Talk to us").
    expect(within(band).queryByRole("button", { name: "Live chat" })).toBeNull();
    expect(within(band).getByRole("link", { name: "Talk to us" })).toHaveAttribute("href", "/en/contact");
  });

  it("tercüman açık + canlı destek açık; rozet sayıyı gösterir", () => {
    const support = resolveLanguageSupport(settingsWith({ supportLanguages: ["en", "tr"], supportHours: {}, interpreterIncluded: true }), "tr");
    render(
      <>
        <SupportLanguagesBand support={support} dict={tr.common} chatEnabled contactHref="/contact" />
        <SupportBadge support={support} label={tr.common.supportBadge} />
      </>
    );
    expect(screen.getByText(tr.common.supportInterpreterIncluded)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tr.common.liveChatCta })).toBeInTheDocument();
    expect(screen.getByTestId("support-badge")).toHaveTextContent("2 dilde destek");
  });
});

const BADGE: PublicAccreditation = {
  id: "b1",
  name: "Health Türkiye",
  description: null,
  issuer: "USHAŞ",
  logoUrl: "https://cdn.example/ht.png",
  logoAlt: "Health Türkiye logo",
  certificateNo: "HT-123",
  verificationUrl: "https://healthturkiye.gov.tr/verify",
  validUntil: "2027-01-31",
};

describe("yetki belgeleri — görünüm ve JSON-LD", () => {
  it("liste boşsa şerit, liste ve footer logoları yok", () => {
    const { container } = render(
      <>
        <AccreditationStrip badges={[]} dict={en.common} detailsHref="/about#accreditations" />
        <AccreditationList badges={[]} dict={en.common} intlLocale="en-GB" />
      </>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("Hakkımızda listesi: belge no ve yeni sekmede güvenli 'Doğrula' bağlantısı", () => {
    render(<AccreditationList badges={[BADGE]} dict={tr.common} intlLocale="tr-TR" />);
    const list = screen.getByTestId("accreditation-list");
    expect(list).toHaveTextContent("Belge no: HT-123");
    expect(list).toHaveTextContent("Veren kurum: USHAŞ");
    const verify = within(list).getByRole("link", { name: /Health Türkiye belgesini doğrula/ });
    expect(verify).toHaveAttribute("href", "https://healthturkiye.gov.tr/verify");
    expect(verify).toHaveAttribute("target", "_blank");
    expect(verify).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(list).getByRole("img", { name: "Health Türkiye logo" })).toHaveAttribute("src", "https://cdn.example/ht.png");
  });

  it("anasayfa şeridi ve footer logoları", () => {
    render(
      <>
        <AccreditationStrip badges={[BADGE]} dict={en.common} detailsHref="/about#accreditations" />
        <SiteFooter siteName="WM" accreditations={[BADGE]} accreditationsHref="/about#accreditations" accreditationsLabel="Licences" supportLine="Patient support in your language: English" />
      </>
    );
    expect(screen.getByTestId("accreditation-strip")).toHaveTextContent("Licensed & accredited");
    expect(screen.getByTestId("accreditation-strip")).toHaveTextContent("Certificate no. HT-123");
    expect(within(screen.getByTestId("footer-accreditations")).getByRole("link")).toHaveAttribute("href", "/about#accreditations");
    expect(screen.getByTestId("footer-support-line")).toHaveTextContent("Patient support in your language: English");
  });

  it("MedicalOrganization.hasCredential yalnızca verilen (görünür) belgelerden; liste boşsa alan yok", () => {
    const settings = { siteName: "WM Health" } as SiteSettings;
    const withBadge = JSON.parse(buildMedicalOrganizationJsonLd(settings, [], "https://x.test", [BADGE]));
    expect(withBadge.hasCredential).toEqual([
      {
        "@type": "EducationalOccupationalCredential",
        name: "Health Türkiye",
        credentialCategory: "license",
        identifier: "HT-123",
        recognizedBy: { "@type": "Organization", name: "USHAŞ" },
        url: "https://healthturkiye.gov.tr/verify",
        expires: "2027-01-31",
      },
    ]);
    expect(JSON.parse(buildMedicalOrganizationJsonLd(settings, [], "https://x.test"))).not.toHaveProperty("hasCredential");
  });
});

describe("sitemap — /physicians ve hekimsiz uzmanlık", () => {
  const doctor = (slug: string, specialtySlug: string, extra: string[] = []) =>
    ({ id: slug, slug, isActive: true, archivedAt: null, updatedAt: "2026-10-20T00:00:00.000Z", specialty: { slug: specialtySlug }, additionalSpecialties: extra.map((s) => ({ id: s, name: s, slug: s })), avatarMedia: null }) as unknown as DoctorProfile;
  const specialty = (slug: string) => ({ slug, name: slug, isActive: true }) as unknown as Specialty;
  const DATA: SitemapData = {
    siteUrl: "https://x.test",
    locales: ["tr", "en", "ar"].map((code, i) => ({ code, label: code, nativeLabel: code, isDefault: code === "tr", enabled: true, sortOrder: i, hreflang: null })),
    homePageId: null,
    pages: [],
    doctors: [doctor("hakan-sofu", "orthopedics", ["sports-medicine"])],
    specialties: [specialty("orthopedics"), specialty("sports-medicine"), specialty("thoracic-surgery"), specialty("neurosurgery")],
    posts: [],
    products: [],
    portfolio: [],
  };

  it("hiçbir bölümde ve index'te /doctors yok; hekim sayfaları /physicians altında", () => {
    const all = [...SITEMAP_SECTIONS.flatMap((s) => buildSection(s, DATA)), ...buildIndex(DATA)];
    expect(JSON.stringify(all)).not.toMatch(/\/doctors(\/|"|\.)/);
    expect(buildSection("physicians", DATA).map((e) => e.loc)).toContain("https://x.test/en/physicians/hakan-sofu");
  });

  it("hekimi olmayan uzmanlık sitemap'e girmez (birincil ya da ek uzmanlıkla atanınca girer)", () => {
    const locs = buildSection("specialties", DATA).map((e) => e.loc);
    expect(locs).toContain("https://x.test/specialties/orthopedics");
    expect(locs).toContain("https://x.test/specialties/sports-medicine");
    expect(locs.some((l) => l.includes("thoracic-surgery") || l.includes("neurosurgery"))).toBe(false);
  });
});

describe("tarama: kaynakta eski site yolu (/doctors) kalmadı", () => {
  const ROOT = path.resolve(__dirname, "../../src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|mjs)$/.test(entry.name)) files.push(full);
    }
  };
  walk(ROOT);

  it("site sayfaları/bileşenleri `/doctors` site bağlantısı üretmez (API çağrıları, admin paneli ve eski yolu çeviren yardımcılar hariç)", () => {
    const allowed = [
      /lib[\\/]api[\\/]/, // backend API uçları (`GET /doctors`) — site URL'si değil
      /app[\\/]admin[\\/]/,
      /components[\\/]admin[\\/]/,
      /lib[\\/]i18n[\\/]physicians-path\.ts$/,
    ];
    const offenders: string[] = [];
    for (const file of files) {
      if (allowed.some((re) => re.test(file))) continue;
      fs.readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
          if (/["'`]\/doctors(?=[/"'`?])/.test(code)) offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("rota klasörü /physicians; eski /doctors klasörü yok", () => {
    expect(fs.existsSync(path.join(ROOT, "app/[lang]/(site)/physicians/[slug]/page.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "app/[lang]/(site)/doctors"))).toBe(false);
  });
});
