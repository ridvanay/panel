import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Paket AK — ana sayfa (serbest blok fixture'ı: Telehealth şablonundan içe aktarılan şerit / "How it works" / sayaç),
 * Hakkımızda sözlükleri (K6) ve "Specialties" başlık taraması (K7). Doktor ifadeleri ve "Specialties" başlığı ziyaretçide görünmez.
 */
const fetchSpecialtiesServer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/server-telehealth", () => ({ fetchSpecialtiesServer: (...a: unknown[]) => fetchSpecialtiesServer(...a) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { BlockRenderer } from "@/components/site/blocks";
import { SpecialtyCardsBlockView } from "@/components/site/blocks/specialty-cards-block";
import { normalizePageNodes } from "@/lib/page-builder/normalize";
import { inheritHiddenFromCanonical } from "@/lib/page-builder/hidden-blocks";
import { createBlock } from "@/lib/page-builder/registry";
import type { SpecialtyCardsBlock } from "@/lib/page-builder/types";
import { siteDictionary as en } from "@/lib/i18n/site-dictionaries/en";
import { siteDictionary as tr } from "@/lib/i18n/site-dictionaries/tr";
import { siteDictionary as de } from "@/lib/i18n/site-dictionaries/de";
import { siteDictionary as ar } from "@/lib/i18n/site-dictionaries/ar";
import { siteDictionary as fr } from "@/lib/i18n/site-dictionaries/fr";
import { siteDictionary as ro } from "@/lib/i18n/site-dictionaries/ro";
import { siteDictionary as sr } from "@/lib/i18n/site-dictionaries/sr-latn";
import { siteDictionary as es } from "@/lib/i18n/site-dictionaries/es";
import { siteDictionary as ru } from "@/lib/i18n/site-dictionaries/ru";

const DICTS = { en, de, ar, fr, ro, "sr-latn": sr, es, ru } as const;

const iconBox = (id: string, heading: string, description: string) => ({ id, type: "icon-box", data: { icon: "Clock", heading, description } });
const heading = (id: string, text: string) => ({ id, type: "heading", data: { text, level: 2, align: "center", underline: false } });

/** Şablondan içe aktarılan eski (doktorlu) metinler — canlıda gizlenir; gizlenmezse sızar. */
function fixture(hidden: boolean) {
  return [
    heading("hero-h", "Plan your treatment in Türkiye with a patient coordinator"),
    {
      id: "th-trust-band",
      type: "container",
      settings: {},
      ...(hidden ? { hidden: true } : {}),
      children: [
        iconBox("tb1", "24/7 Access", "Find an available doctor and book instantly."),
        iconBox("tb2", "Encrypted Consultation", "End-to-end encrypted video."),
        iconBox("tb3", "Verified Profiles", "All active doctor profiles are verified."),
      ],
    },
    heading("th-specialty-grid-heading", "Our Health Tourism Services"),
    {
      id: "th-how-it-works",
      type: "container",
      settings: {},
      ...(hidden ? { hidden: true } : {}),
      children: [heading("how-h", "How It Works"), iconBox("h1", "Choose Your Doctor", "Pick by the doctor's availability calendar.")],
    },
    {
      id: "th-counters",
      type: "counter",
      data: { items: [{ id: "k1", value: 6, label: "Spoken Language", metric: "visitorLanguages" }] },
    },
  ];
}

describe("ana sayfa — serbest blok fixture'ı", () => {
  it("şerit ve How it works gizliyken 'doctor', 'Choose your doctor', 'Verified profiles' HTML'de yok; başlık 'Specialties' değil", () => {
    const nodes = normalizePageNodes(fixture(true) as never);
    const { container } = render(
      <BlockRenderer nodes={nodes} chrome="page" siteContext={{ lang: "en", defaultLocaleCode: "en", metrics: { activeServices: 7, visitorLanguages: 8, activeCoordinators: 4, consultationMinutes: 30 } }} />
    );
    const html = container.textContent ?? "";
    expect(html).not.toMatch(/doctor/i);
    expect(html).not.toMatch(/Choose your doctor/i);
    expect(html).not.toMatch(/Verified profiles/i);
    expect(screen.getByRole("heading", { name: "Our Health Tourism Services" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /specialties/i })).toBeNull();
    // canlı sayaç: 6 değil gerçek veri (8 dil)
    expect(screen.getByText("Spoken Language").previousElementSibling).toHaveTextContent("8");
  });

  it("gizleme kontrolü: gizlenmeseydi metinler sızardı (fixture geçerli)", () => {
    const { container } = render(<BlockRenderer nodes={normalizePageNodes(fixture(false) as never)} chrome="page" />);
    expect(container.textContent).toMatch(/Choose Your Doctor/);
  });

  it("çeviri listesinde gizleme unutulsa bile ana listeye göre gizli kalır", () => {
    const canonical = normalizePageNodes(fixture(true) as never);
    const german = normalizePageNodes(fixture(false) as never);
    const { container } = render(<BlockRenderer nodes={inheritHiddenFromCanonical(german, canonical)} chrome="page" />);
    expect(container.textContent).not.toMatch(/doctor/i);
  });
});

describe("Our Health Tourism Services başlığı", () => {
  beforeEach(() => fetchSpecialtiesServer.mockReset());

  it("uzmanlık kartları bloğunun varsayılan başlığı 'Our Health Tourism Services'; URL'ler değişmez", async () => {
    fetchSpecialtiesServer.mockResolvedValue([{ id: "1", slug: "dental", name: "Dental Care", icon: "Smile", description: null, order: 1, isActive: true, parentId: null, imageUrl: null }]);
    const block = createBlock("specialty-cards") as SpecialtyCardsBlock;
    render(await SpecialtyCardsBlockView({ block, chrome: "page", siteContext: { lang: "en", defaultLocaleCode: "en" } }));
    expect(screen.getByRole("heading", { level: 2, name: "Our Health Tourism Services" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /specialties/i })).toBeNull();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/specialties/dental");
  });
});

describe("K7 — ziyaretçi sözlüklerinde 'Specialties' başlığı yok", () => {
  const keys: [string, (d: typeof en) => string][] = [
    ["blog.specialtiesTitle", (d) => d.blog.specialtiesTitle],
    ["blog.specialtiesAria", (d) => d.blog.specialtiesAria],
    ["blog.specialtyView", (d) => d.blog.specialtyView],
    ["reviews.overviewSpecialty", (d) => d.reviews.overviewSpecialty],
    ["telehealth.allSpecialties", (d) => d.telehealth.allSpecialties],
    ["telehealth.specialtyFilterAriaLabel", (d) => d.telehealth.specialtyFilterAriaLabel],
    ["telehealth.specialtiesEmptyTitle", (d) => d.telehealth.specialtiesEmptyTitle],
    ["telehealth.specialtiesEmptyDescription", (d) => d.telehealth.specialtiesEmptyDescription],
  ];

  it("EN: karşılıklar 'service' ve 'specialt' içermez", () => {
    expect(en.blog.specialtiesTitle).toBe("Browse by service");
    expect(en.reviews.overviewSpecialty).toBe("Service");
    expect(en.telehealth.allSpecialties).toBe("All services");
    expect(en.telehealth.specialtiesEmptyTitle).toBe("No service found");
    for (const [name, get] of keys) expect(get(en), name).not.toMatch(/specialt/i);
  });

  it("8 dil + tr(EN): her anahtar dolu; tr sözlüğü EN metin; EN dışı diller EN ile aynı değil", () => {
    for (const [name, get] of keys) {
      // tr/blog.ts Türkçe kalır (sözlük paritesi testi tr'de EN kopyasına izin vermez; tr ziyaretçiye servis edilmez).
      if (!name.startsWith("blog.")) expect(get(tr), `tr ${name}`).toBe(get(en));
      for (const [lang, dict] of Object.entries(DICTS)) {
        expect(get(dict as typeof en).length, `${lang} ${name}`).toBeGreaterThan(2);
        // "Service" fr'de aynı yazılır (yakın akraba sözcük) — yalnızca bu tek anahtarda eşitliğe izin verilir.
        if (lang !== "en" && name !== "reviews.overviewSpecialty") expect(get(dict as typeof en), `${lang} ${name}`).not.toBe(get(en));
      }
    }
  });

  it("hiçbir EN sözlük değeri 'Specialties' / 'Our Specialties' başlığı değildir", () => {
    const hits: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (typeof value === "string") {
        if (/^(our )?specialties$/i.test(value.trim()) || /^all specialties$/i.test(value.trim())) hits.push(`${path}=${value}`);
      } else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
      }
    };
    walk(en, "en");
    expect(hits).toEqual([]);
  });
});

describe("K6 — Hakkımızda: 'What we coordinate'", () => {
  const OLD = /what we treat|\bour treatment areas|\bwe treat\b|\bour treatment\b|\bour patients.{0,3} treatment|treatment areas/i;

  it("EN metinler talimattakiyle birebir; meta açıklama 'treatment services we facilitate'", () => {
    expect(en.about.treatmentEyebrow).toBe("What we coordinate");
    expect(en.about.treatmentTitle).toBe("Treatment services we facilitate");
    expect(en.about.treatmentBody).toBe(
      "Each patient’s needs are different. We connect you with healthcare facilities holding an International Health Tourism Authorization Certificate, where treatment decisions are made following an individual medical evaluation."
    );
    expect(en.about.metaDescription).toContain("the treatment services we facilitate");
    expect(en.about.metaDescription).not.toMatch(OLD);
  });

  it("tr sözlüğü EN metin; 8 dilin üç alanı dolu, birbirinden ve eski metinden farklı", () => {
    expect(tr.about.treatmentEyebrow).toBe(en.about.treatmentEyebrow);
    expect(tr.about.treatmentTitle).toBe(en.about.treatmentTitle);
    expect(tr.about.treatmentBody).toBe(en.about.treatmentBody);
    const titles = new Set<string>();
    for (const [lang, dict] of Object.entries(DICTS)) {
      const a = (dict as typeof en).about;
      expect(a.treatmentEyebrow.length, lang).toBeGreaterThan(3);
      expect(a.treatmentBody.length, lang).toBeGreaterThan(60);
      titles.add(a.treatmentTitle);
      if (lang !== "en") {
        expect(a.treatmentTitle, lang).not.toBe(en.about.treatmentTitle);
        expect(a.treatmentBody, lang).not.toBe(en.about.treatmentBody);
      }
    }
    expect(titles.size).toBe(8);
  });

  it("'we treat / our treatment / our patients' treatment / treatment areas' taraması: EN ziyaretçi sözlüklerinde bulgu yok", () => {
    const hits: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (typeof value === "string") {
        if (OLD.test(value)) hits.push(`${path}: ${value.slice(0, 80)}`);
      } else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
      }
    };
    walk(en, "en");
    expect(hits).toEqual([]);
  });
});

/**
 * Paket AL İş 4 — EN ziyaretçi sözlüğünde "doctor / physician / surgeon / specialist / our hospital / we treat / Dr." taraması.
 * - İZİNLİ BEYAN: tıbbi karar sorumluluğunu yetkili tesise bağlayan cümleler (ALLOWED).
 * - BAYRAKLA KAPALI ÖZELLİK ANAHTARLARI: hekim portalı/profili/randevusu (telehealth, portal, consultation, reviews ad alanları)
 *   ve hekim bölümleri (FLAGGED_KEYS) — kodda durur, ziyaretçide kapalıdır; silinmez ama burada pinlenir.
 *   Listeye YENİ bir anahtar düşerse test kırılır: ya metin düzeltilir ya bilinçli olarak buraya eklenir.
 * - KALAN ZİYARETÇİ YERLERİ (REMAINING_VISITOR): ziyaretçi sayfasından erişilebilen ama hekim ima eden metinler (rapora yazıldı).
 */
describe("AL İş 4 — sözlükte hekim ifadesi taraması (EN)", () => {
  const TERMS = /\b(?:doctors?|physicians?|surgeons?|specialists?|our hospitals?|we treat)\b|\bDr\./i;
  const ALLOWED = [/\b(?:made )?by (?:a |the )?physicians?(?: at| in| from)? (?:an? |the )?(?:authorized )?healthcare facilit(?:y|ies)/gi, /\bphysicians? at (?:an? )?authorized healthcare facilit(?:y|ies)/gi];
  const FLAGGED_NAMESPACES = ["telehealth", "portal", "consultation", "reviews"];
  const FLAGGED_KEYS = [
    "nav.doctorPortal",
    "nav.consultPhysicians",
    "about.doctorsTitle",
    "about.viewAllDoctorsCta",
    "contact.doctorRequestMessage",
    "home.doctorsTitle",
    "home.doctorsCta",
    "packages.relatedDoctorsTitle",
    "blog.previewBannerPending",
  ];
  // Hekim-ima eden ama ziyaretçiye açık (medical-reviewers / içerik standartları) metinler: rapora yazıldı, ürün sahibi kararı bekler.
  const REMAINING_VISITOR = ["trustPages.mrIntro", "trustPages.mrReviewersTitle", "trustPages.mrReviewersText", "trustPages.mrReviewersEmpty"];

  function scan(): string[] {
    const hits: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (typeof value === "string") {
        let cleaned = value;
        for (const re of ALLOWED) cleaned = cleaned.replace(re, "");
        if (TERMS.test(cleaned)) hits.push(path);
      } else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(en, "");
    return hits.filter((p) => !FLAGGED_NAMESPACES.includes(p.split(".")[0]));
  }

  it("yeni hekim ifadesi eklenmemiş: kalan bulgular yalnızca bilinen bayraklı / raporlanmış anahtarlar", () => {
    expect(scan().sort()).toEqual([...FLAGGED_KEYS, ...REMAINING_VISITOR].sort());
  });

  it("izinli beyanlar (yetkili tesiste hekim) bulgu sayılmaz", () => {
    const hits = scan();
    for (const key of ["blog.disclaimer", "trustPages.csNotText", "request.aboutDont2", "serviceBooking.medicalNote"]) expect(hits, key).not.toContain(key);
  });
});
