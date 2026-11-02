import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { NavigationItemDto, SiteSettings } from "@/lib/api/types";

/**
 * Paket AJ-2 (c) — ziyaretçi sayfalarının RENDER EDİLMİŞ HTML'inde (metin + erişilebilirlik öznitelikleri + JSON-LD)
 * hekim ima eden ifade taraması. WM Health bir aracı kuruluştur; sitede hekim yoktur (`lib/intermediary.ts`).
 *
 * Aranan ifadeler: doctor, physician, surgeon, "Dr.", "Prof.", "Consult Physicians", "Find a physician", "your doctor",
 * "(video) consultation with a doctor/physician/specialist". "video consultation" TEK BAŞINA yasak DEĞİLDİR
 * (hasta koordinatörüyle görüntülü görüşme sürer).
 *
 * İZİNLİ İSTİSNALAR (ALLOWED): tıbbi karar sorumluluğunu tesise bağlayan beyanlar — "physicians at authorized
 * healthcare facilities" ve tekil/benzer biçimleri.
 *
 * "FE-A beklemede": paralel çalışan FE-A'nın sahip olduğu dosyalardaki bulgular (üst şerit/header, talep sayfası,
 * koordinatör bandı, `request.ts`/`nav.ts`/`home.ts`/`services.ts`/`intermediary.ts`) FE_A_PENDING listesindedir;
 * orkestratör FE-A dosyalarını düzelttikten sonra liste boşaltılır ve test katılaşır.
 */
const mocks = vi.hoisted(() => ({ settings: vi.fn(), pages: vi.fn(), locales: vi.fn(), specialty: vi.fn(), specialties: vi.fn(), module: vi.fn(), theme: vi.fn() }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/context/locale-alternates-context", () => ({
  useLocaleAlternates: () => null,
  contentKindBasePath: () => "",
  useActiveLocaleCode: () => "en",
  useLocalizePath: () => (p: string) => p,
}));
vi.mock("@/lib/api/server-contact-channels", () => ({ fetchContactChannelsServer: async () => ({ whatsapp: { number: "+90 555 000 00 00", message: "Hello {package}" } }) }));
vi.mock("@/lib/api/server-contact", () => ({ fetchContactPageServer: async () => ({ content: { phone: "+90 212 000 00 00", email: "info@example.com" } }) }));
vi.mock("@/lib/api/server-locales", () => ({ fetchLocalesServer: () => mocks.locales() }));
vi.mock("@/lib/api/server-settings", () => ({ fetchSiteSettingsServer: () => mocks.settings() }));
vi.mock("@/lib/api/server-pages", () => ({ fetchPublishedPagesServer: () => mocks.pages(), fetchPageBySlugServer: () => Promise.resolve(null) }));
vi.mock("@/lib/api/server-packages", () => ({ fetchPackageServer: () => Promise.resolve(null) }));
vi.mock("@/lib/api/server-blog", () => ({ fetchBlogReviewersServer: () => Promise.resolve([]) }));
vi.mock("@/lib/api/server-modules", () => ({ isModuleEnabledServer: (key: string) => mocks.module(key) }));
vi.mock("@/lib/api/server-telehealth", () => ({
  fetchDoctorBySlugServer: vi.fn(async () => null),
  fetchSpecialtyBySlugServer: (...a: unknown[]) => mocks.specialty(...a),
  fetchSpecialtiesServer: (...a: unknown[]) => mocks.specialties(...a),
  fetchTelehealthThemeServer: () => mocks.theme(),
  fetchDoctorsServer: vi.fn(async () => {
    throw new Error("hekim listesi çekilmemeli");
  }),
}));

import RequestPage from "@/app/[lang]/(site)/request/page";
import VipAccommodationTransferPage from "@/app/[lang]/(site)/vip-accommodation-transfer/page";
import FindYourTreatmentPage from "@/app/[lang]/(site)/find-your-treatment/page";
import SpecialtiesPage from "@/app/[lang]/(site)/specialties/page";
import { ContentStandardsPage } from "@/components/site/trust/content-standards-page";
import { HomePageView } from "@/components/site/home/home-page-view";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { MatcherCtaCard, MatcherLaunchButton } from "@/components/site/matcher/matcher-modal";
import { OurRole, WhoWeAre } from "@/components/site/about/intermediary-sections";
import { BlogFindPhysicianCta } from "@/components/site/blog/blog-cta-blocks";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { intermediaryStrings } from "@/lib/i18n/site-dictionaries/en/intermediary";

const LOCALES = [{ code: "en", label: "English", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0, hreflang: null }];

/** Yasak ifadeler (EN). */
const FORBIDDEN = /\b(?:doctors?|physicians?|surgeons?)\b|\bDr\.|\bProf\.|consult physicians|find a physician|(?:video )?consultation with (?:a |an |our |the )?(?:doctor|physician|specialist)/i;

/** İzinli istisnalar — bulunan eşleşmeden ÖNCE metinden çıkarılır. */
const ALLOWED: RegExp[] = [
  /\bphysicians?\s+(?:at|in|from)\s+(?:the\s+|an?\s+)?(?:authorized\s+|partner\s+)?healthcare\s+facilit(?:y|ies)/gi,
];

/**
 * FE-A beklemede: bu dosyalardaki bulgular testi düşürmez ama raporlanır. Her giriş: kaynak dosya + ifade.
 * (Doldurma kuralı: yalnızca FE-A sahipli dosyalar.)
 */
const FE_A_PENDING: { file: string; phrase: RegExp }[] = [];

function visibleText(container: HTMLElement): string {
  const parts: string[] = [container.textContent ?? ""];
  for (const el of container.querySelectorAll("[aria-label],[title],[alt],[placeholder]")) {
    for (const attr of ["aria-label", "title", "alt", "placeholder"]) {
      const v = el.getAttribute(attr);
      if (v) parts.push(v);
    }
  }
  return parts.join("\n");
}

export function findDoctorPhrases(text: string): string[] {
  let cleaned = text;
  for (const allowed of ALLOWED) cleaned = cleaned.replace(allowed, "");
  const found: string[] = [];
  for (const line of cleaned.split("\n")) {
    const m = FORBIDDEN.exec(line);
    if (m && !FE_A_PENDING.some((p) => p.phrase.test(line))) found.push(line.slice(Math.max(0, m.index - 30), m.index + 60));
  }
  return found;
}

beforeEach(() => {
  mocks.locales.mockReset().mockResolvedValue(LOCALES);
  mocks.settings.mockReset().mockResolvedValue({ siteName: "WM Health", healthTourismCertificateNo: null });
  mocks.pages.mockReset().mockResolvedValue([]);
  mocks.module.mockReset().mockResolvedValue(true);
  mocks.theme.mockReset().mockResolvedValue({ emergencyNotice: { enabled: false, summary: {}, full: {} } });
  const spec = (over: Record<string, unknown>) => ({ id: over.slug, name: String(over.slug), icon: "Stethoscope", description: null, order: 0, isActive: true, parentId: null, imageUrl: null, ...over });
  mocks.specialty.mockReset().mockResolvedValue({ ...spec({ slug: "esd", name: "ESD" }), doctorCount: 4, children: [] });
  mocks.specialties.mockReset().mockResolvedValue([spec({ slug: "gastroenterology", name: "Gastroenterology" }), spec({ slug: "esd", name: "ESD", parentId: "gastroenterology" })]);
});

describe("Tarama yardımcısı", () => {
  it("yasak ifadeleri yakalar, izinli beyanı geçirir", () => {
    expect(findDoctorPhrases("Meet our doctors")).toHaveLength(1);
    expect(findDoctorPhrases("Free video consultation with a specialist")).toHaveLength(1);
    expect(findDoctorPhrases("Find a physician")).toHaveLength(1);
    expect(findDoctorPhrases("Dr. Vahit Mutlu")).toHaveLength(1);
    expect(findDoctorPhrases("Free online video consultation with a patient coordinator")).toHaveLength(0);
    expect(findDoctorPhrases("Decisions are made by physicians at authorized healthcare facilities.")).toHaveLength(0);
    expect(findDoctorPhrases("Diagnosis is made by a physician at an authorized healthcare facility.".replace("a physician", "physicians"))).toHaveLength(0);
  });
});

describe("Ziyaretçi sayfaları — render edilmiş HTML'de hekim ifadesi yok (EN)", () => {
  const params = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ lang: "en", ...extra }) });

  it.each([
    ["talep formu (FE-A sayfası)", async () => RequestPage({ params: Promise.resolve({ lang: "en" }), searchParams: Promise.resolve({}) })],
    ["VIP Accommodation & Transfer", async () => VipAccommodationTransferPage(params())],
    ["Find your treatment sayfası", async () => FindYourTreatmentPage(params())],
    ["Health Tourism Services listesi", async () => SpecialtiesPage({ ...params(), searchParams: Promise.resolve({}) } as never)],
    ["Content standards", async () => ContentStandardsPage({ lang: "en" })],
  ])("%s", async (_name, build) => {
    const { container } = render(await build());
    expect(findDoctorPhrases(visibleText(container))).toEqual([]);
  });

  it.each(["de", "ar", "ru", "fr", "es", "ro", "sr-latn"])("%s: VIP, bölüm ve Find your treatment sayfalarında hekim ima eden sözcük yok (çok dilli desen)", async (lang) => {
    const { impliesDoctor } = await import("@/lib/intermediary");
    const { default: SpecialtyDetailPage } = await import("@/app/[lang]/(site)/specialties/[slug]/page");
    const local = { params: Promise.resolve({ lang }) };
    for (const build of [() => VipAccommodationTransferPage(local), () => FindYourTreatmentPage(local), () => SpecialtyDetailPage({ params: Promise.resolve({ lang, slug: "esd" }) })]) {
      const { container, unmount } = render(await build());
      const hits = visibleText(container).split(String.fromCharCode(10)).filter((line) => impliesDoctor(line));
      expect(hits.map((h) => h.slice(0, 80)), lang).toEqual([]);
      unmount();
    }
  });

  it("bölüm sayfası (hekim sayısı olan kayıtla da)", async () => {
    const { default: SpecialtyDetailPage } = await import("@/app/[lang]/(site)/specialties/[slug]/page");
    const { container } = render(await SpecialtyDetailPage({ params: Promise.resolve({ lang: "en", slug: "esd" }) }));
    expect(findDoctorPhrases(visibleText(container))).toEqual([]);
  });

  it("ana sayfa: CMS'te kalmış hekim vurgulu metinler süzülür, varsayılanlar gelir", async () => {
    const polluted = {
      hero: {
        title: "Meet our doctors",
        body: "Free video consultation with our doctors",
        primaryCta: { label: "Meet Our Medical Team", href: "/physicians" },
        secondaryCta: { label: "How it works", href: "#how" },
      },
      journey: {
        steps: [
          { id: "a", title: "Planning", text: "Share your history" },
          { id: "b", title: "Arrival", text: "We welcome you" },
          { id: "c", title: "Examination", text: "The physician responsible for your care completes the examinations." },
        ],
      },
      closing: { title: "Talk to our physicians today" },
    };
    const { container } = render(await HomePageView({ data: polluted, siteContext: { lang: "en", defaultLocaleCode: "en" } as never }));
    expect(findDoctorPhrases(visibleText(container))).toEqual([]);
    // Süzülmeyen alan korunur.
    expect(container.textContent).toContain("How it works");
  });

  it("header + footer (hekim listesi bağlantısı içeren eski menü verisiyle)", async () => {
    const dict = await getSiteDictionary("en");
    const nav = (id: string, label: string, href: string, order: number): NavigationItemDto => ({ id, label, href, order, parentId: null }) as NavigationItemDto;
    const header = render(
      <SiteHeader
        {...({
          settings: { siteName: "WM Health", logoUrl: null } as unknown as SiteSettings,
          pages: [],
          navigationItems: [nav("h", "Home", "/", 0), nav("d", "Consult Physicians", "/physicians", 1), nav("c", "Contact", "/contact", 2)],
          ctaLabel: "Book a consultation",
          ctaHref: "/request",
          dict: dict.nav,
          navSpecialties: [],
          telehealthModuleEnabled: true,
          intermediary: { shortLabel: intermediaryStrings.shortLabel, facilitiesLink: intermediaryStrings.facilitiesLink },
        } as unknown as Parameters<typeof SiteHeader>[0])}
      />
    );
    expect(findDoctorPhrases(visibleText(header.container))).toEqual([]);
    header.unmount();
    const footer = render(
      <SiteFooter
        siteName="WM Health"
        footerColumns={[
          { id: "p", title: "Platform", order: 0, links: [{ id: "1", label: "Consult Physicians", href: "/physicians", order: 0 }, { id: "2", label: "About", href: "/about", order: 1 }] },
          { id: "e", title: "Services", order: 1, links: [] },
        ]}
        physiciansNavLabel={dict.nav.consultPhysicians}
        intermediary={dict.intermediary}
      />
    );
    expect(findDoctorPhrases(visibleText(footer.container))).toEqual([]);
  });

  it("matcher giriş noktaları, blog CTA ve aracı kuruluş bölümleri", async () => {
    const dict = await getSiteDictionary("en");
    const { container } = render(
      <div>
        <MatcherCtaCard />
        <MatcherLaunchButton />
        <BlogFindPhysicianCta t={dict.blog} />
        <WhoWeAre t={dict.request} />
        <OurRole t={dict.request} />
      </div>
    );
    expect(findDoctorPhrases(visibleText(container))).toEqual([]);
  });
});

describe("AJ-6 — CMS süzme, footer kolonları, yorum kayıtları", () => {
  it("impliesDoctor: 8 dilde hekim ima eden metni yakalar, izinli beyanı ve hasta koordinatörünü geçirir", async () => {
    const { impliesDoctor } = await import("@/lib/intermediary");
    for (const text of ["Meet Our Medical Team", "video consultation with our doctors", "Prof. Dr. Ali", "Unsere Ärzte kennenlernen", "Наши врачи", "Découvrez nos médecins", "Conozca a nuestros médicos", "ابحث عن طبيب", "Pronađite lekara", "Cunoașteți medicii noștri"]) {
      expect(impliesDoctor(text), text).toBe(true);
    }
    for (const text of ["Free online video consultation with a patient coordinator", "Treatments by physicians at authorized healthcare facilities", "Los tratamientos médicos se realizan en centros autorizados", "Gastroenterology"]) {
      expect(impliesDoctor(text), text).toBe(false);
    }
  });

  it("sanitizeDoctorTexts: işaretli alan silinir, işaretli madde içeren liste atılır, etiketi giden CTA'nın bağlantısı da gider; bayrak açıkken aynen döner", async () => {
    const { sanitizeDoctorTexts } = await import("@/lib/intermediary");
    const raw = {
      hero: { title: "Quality care", body: "Talk to our doctors", primaryCta: { label: "Meet Our Medical Team", href: "/physicians" }, imageUrl: "/uploads/hero-doctor.webp" },
      journey: { steps: [{ id: "a", title: "One", text: "Fine" }, { id: "b", title: "Two", text: "The physician responsible for your care" }] },
      doctors: { enabled: true, title: "Meet our doctors" },
    };
    const out = sanitizeDoctorTexts(raw, false) as typeof raw & { hero: { primaryCta?: unknown; body?: string } };
    expect(out.hero.title).toBe("Quality care");
    expect(out.hero.body).toBeUndefined();
    expect(out.hero.primaryCta).toEqual({});
    expect(out.hero.imageUrl).toBe("/uploads/hero-doctor.webp");
    expect((out as { journey: Record<string, unknown> }).journey.steps).toBeUndefined();
    expect((out as { doctors: { enabled: boolean } }).doctors.enabled).toBe(false);
    expect(sanitizeDoctorTexts(raw, true)).toBe(raw);
  });

  it("visibleFooterColumns: bağlantısız / başlıksız kolonlar ve hekim listesi bağlantısı çıkar", async () => {
    const { visibleFooterColumns } = await import("@/components/site/site-footer");
    const link = (id: string, href: string) => ({ id, label: id, href, order: 0 });
    const cols = visibleFooterColumns([
      { id: "p", title: "Platform", order: 0, links: [link("home", "/"), link("doc", "/physicians")] },
      { id: "s", title: "Services", order: 1, links: [] },
      { id: "n", title: " ", order: 2, links: [link("x", "/x")] },
      { id: "d", title: "Doctors", order: 3, links: [link("d1", "/doctors")] },
    ] as never);
    expect(cols.map((c) => c.id)).toEqual(["p"]);
    expect(cols[0].links.map((l) => l.id)).toEqual(["home"]);
  });

  it("withoutDoctorFromReviews: hekim adı, yanıtı ve filtre listesi yorum kayıtlarından çıkar", async () => {
    const { withoutDoctorFromReviews } = await import("@/lib/intermediary");
    const data = { items: [{ id: "1", doctor: { name: "Dr. X", slug: "x" }, doctorReply: "Thanks" }], doctors: [{ slug: "x", name: "Dr. X", count: 1 }] };
    const out = withoutDoctorFromReviews(data);
    expect(JSON.stringify(out)).not.toMatch(/Dr\. X|Thanks/);
    expect(out.items[0].doctorReply).toBeNull();
  });
});

/**
 * AJ-6 (d) — yatay taşma (birim düzeyi buluşsal kontrol; ölçülü görsel kontrol orkestratörde: 1440/390, EN/AR).
 * jsdom yerleşim ölçmez; bu yüzden 390 px'ten geniş, ÖNEKSİZ (mobilde de geçerli) sabit genişlik sınıfları aranır.
 */
describe("AJ-6 — yatay taşma buluşsalı (mobil 390 px)", () => {
  const MOBILE = 390;
  const FIXED_WIDTH = /^(?:min-w|w)-\[(\d+)px\]$/;

  function overflowRisks(container: HTMLElement): string[] {
    const risks: string[] = [];
    for (const el of container.querySelectorAll("[class]")) {
      for (const cls of (el.getAttribute("class") ?? "").split(/\s+/)) {
        const m = FIXED_WIDTH.exec(cls);
        if (m && Number(m[1]) > MOBILE) risks.push(`${el.tagName.toLowerCase()}.${cls}`);
        if (/^w-screen$/.test(cls)) risks.push(`${el.tagName.toLowerCase()}.${cls}`);
      }
    }
    return risks;
  }

  const params = (lang: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ lang, ...extra }) });

  it.each(["en", "ar"])("%s: ana sayfa, VIP, hizmetler, bölüm, Find your treatment ve içerik standartları mobilde sabit geniş öğe içermez", async (lang) => {
    const { default: SpecialtyDetailPage } = await import("@/app/[lang]/(site)/specialties/[slug]/page");
    const builds: Array<() => Promise<React.ReactElement>> = [
      () => HomePageView({ data: {}, siteContext: { lang, defaultLocaleCode: "en" } as never }),
      () => VipAccommodationTransferPage(params(lang)),
      () => SpecialtiesPage({ ...params(lang), searchParams: Promise.resolve({}) } as never),
      () => SpecialtyDetailPage({ params: Promise.resolve({ lang, slug: "esd" }) }),
      () => FindYourTreatmentPage(params(lang)),
      () => ContentStandardsPage({ lang }),
    ];
    for (const build of builds) {
      const { container, unmount } = render(await build());
      expect(overflowRisks(container)).toEqual([]);
      unmount();
    }
  });
});
