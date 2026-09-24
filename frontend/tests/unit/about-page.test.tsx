import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  ABOUT_ICON_KEYS,
  buildDefaultAboutContent,
  getAboutDataForLocale,
  resolveAboutContent,
  resolveAboutHref,
  selectAboutDoctors,
  toEditableAboutContent,
  isAboutTemplatePage,
} from "@/lib/about-page";
import { AboutDoctors } from "@/components/site/about/about-doctors";
import { aboutStrings as enAboutStrings } from "@/lib/i18n/site-dictionaries/en/about";
import { aboutStrings as trAboutStrings } from "@/lib/i18n/site-dictionaries/tr/about";
import { telehealthStrings as enTelehealthStrings } from "@/lib/i18n/site-dictionaries/en/telehealth";
import { telehealthStrings as trTelehealthStrings } from "@/lib/i18n/site-dictionaries/tr/telehealth";
import type { DoctorProfile } from "@/lib/api/types";

function makeDoctor(id: string, overrides: Partial<DoctorProfile> = {}): DoctorProfile {
  return {
    id,
    userId: null,
    specialtyId: "specialty-1",
    specialty: {
      id: "specialty-1",
      name: "Cardiology",
      slug: "kardiyoloji",
      icon: "HeartPulse",
      description: null,
      order: 0,
      isActive: true,
      imageMediaId: null,
      imageUrl: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    title: "Dr.",
    fullName: `Doctor ${id}`,
    slug: `doctor-${id}`,
    subSpecialty: null,
    bio: "Bio.",
    aboutHtml: null,
    practiceStartYear: null,
    experienceYears: null,
    cvEntries: [],
    publications: [],
    languages: ["en"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: null,
    currency: "TRY",
    avatarMediaId: null,
    avatarMedia: null,
    isVerified: false,
    verifiedAt: null,
    isActive: true,
    order: 0,
    availability: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const DOCTORS = ["1", "2", "3", "4", "5"].map((id) => makeDoctor(id));
const EN_DEFAULTS = buildDefaultAboutContent(enAboutStrings);
const TR_DEFAULTS = buildDefaultAboutContent(trAboutStrings);

describe("selectAboutDoctors", () => {
  it("kurucu id'si bulunursa onu başa alır, ardından API sırasıyla (seq) kurucu hariç doktorları ekler", () => {
    const result = selectAboutDoctors(DOCTORS, "4", 3);
    expect(result.doctors.map((d) => d.id)).toEqual(["4", "1", "2"]);
    expect(result.founderId).toBe("4");
  });

  it("gösterilecek sayıya uyar", () => {
    expect(selectAboutDoctors(DOCTORS, null, 1).doctors.map((d) => d.id)).toEqual(["1"]);
    expect(selectAboutDoctors(DOCTORS, "5", 5).doctors.map((d) => d.id)).toEqual(["5", "1", "2", "3", "4"]);
  });

  it("kurucu seçilmemişse veya artık aktif değilse hata vermez, etiketsiz ilk N doktoru döner", () => {
    expect(selectAboutDoctors(DOCTORS, null, 3)).toEqual({ doctors: DOCTORS.slice(0, 3), founderId: null });
    expect(selectAboutDoctors(DOCTORS, "pasif-doktor", 3)).toEqual({ doctors: DOCTORS.slice(0, 3), founderId: null });
    expect(selectAboutDoctors([], "1", 3)).toEqual({ doctors: [], founderId: null });
  });
});

describe("resolveAboutContent — sözlük varsayılanlarıyla alan bazında birleştirme", () => {
  it("kayıt yoksa (null) veya bozuk veri gelirse tamamen sözlük metinlerini döner, hata fırlatmaz", () => {
    expect(resolveAboutContent(null, EN_DEFAULTS)).toEqual(EN_DEFAULTS);
    for (const bad of [undefined, "metin", 42, [], { hero: "bozuk", treatments: { items: "x" }, doctors: { count: "3" } }]) {
      expect(() => resolveAboutContent(bad, EN_DEFAULTS)).not.toThrow();
      expect(resolveAboutContent(bad, EN_DEFAULTS)).toEqual(EN_DEFAULTS);
    }
  });

  it("dolu alanları kullanır, boş/boşluk alanlarda varsayılana düşer", () => {
    const result = resolveAboutContent(
      { hero: { title: "  Yeni başlık  ", body: "   ", primaryCta: { label: "", href: "/contact" } } },
      EN_DEFAULTS
    );
    expect(result.hero.title).toBe("Yeni başlık");
    expect(result.hero.body).toBe(EN_DEFAULTS.hero.body);
    expect(result.hero.primaryCta).toEqual({ label: EN_DEFAULTS.hero.primaryCta.label, href: "/contact" });
  });

  it("adı boş kartları atlar; liste tamamen boşsa varsayılan liste gösterilir", () => {
    const partial = resolveAboutContent(
      { treatments: { items: [{ id: "a", name: "Kardiyoloji", icon: "HeartPulse" }, { id: "b", name: "  ", icon: "Heart" }] } },
      TR_DEFAULTS
    );
    expect(partial.treatments.items).toEqual([{ id: "a", name: "Kardiyoloji", icon: "HeartPulse" }]);
    expect(resolveAboutContent({ treatments: { items: [] } }, TR_DEFAULTS).treatments.items).toEqual(TR_DEFAULTS.treatments.items);
    expect(resolveAboutContent({ approach: { items: [{ id: "x", title: "", body: "metin" }] } }, TR_DEFAULTS).approach.items).toEqual(
      TR_DEFAULTS.approach.items
    );
  });

  it("listede olmayan ikon güvenli bir varsayılana düşer", () => {
    const result = resolveAboutContent({ treatments: { items: [{ id: "a", name: "X", icon: "Skull" }] } }, EN_DEFAULTS);
    expect(result.treatments.items[0]!.icon).toBe("BadgeCheck");
  });

  it("göster/gizle bayrakları yalnızca gerçek boolean ise dikkate alınır", () => {
    const hidden = resolveAboutContent({ treatments: { enabled: false }, approach: { enabled: false }, doctors: { enabled: false } }, EN_DEFAULTS);
    expect([hidden.treatments.enabled, hidden.approach.enabled, hidden.doctors.enabled]).toEqual([false, false, false]);
    const garbage = resolveAboutContent({ treatments: { enabled: "false" } }, EN_DEFAULTS);
    expect(garbage.treatments.enabled).toBe(true);
  });

  it("doktor sayısını 1–6 dışında veya tam sayı değilse varsayılana (3) çeker", () => {
    for (const count of [0, 7, 2.5, "4", null]) {
      expect(resolveAboutContent({ doctors: { count } }, EN_DEFAULTS).doctors.count).toBe(3);
    }
    expect(resolveAboutContent({ doctors: { count: 6 } }, EN_DEFAULTS).doctors.count).toBe(6);
  });
});

describe("getAboutDataForLocale — dil sızıntısı yok", () => {
  const trBlock = { id: "r", type: "about-page", data: { hero: { title: "TR başlık" } } };
  const enBlock = { id: "r", type: "about-page", data: { hero: { title: "EN title" } } };

  it("varsayılan dil kanonik blokları, diğer diller YALNIZCA kendi çevirisini okur", () => {
    const page = { blocks: [trBlock], translations: { en: { title: "About Us", blocks: [enBlock] } } };
    expect(getAboutDataForLocale(page, "tr", "tr")).toEqual(trBlock.data);
    expect(getAboutDataForLocale(page, "en", "tr")).toEqual(enBlock.data);
  });

  it("İngilizce blok yoksa Türkçe içerik İngilizce sayfaya düşmez (sözlük gösterilir)", () => {
    const page = { blocks: [trBlock], translations: { en: { title: "About Us" } } };
    expect(getAboutDataForLocale(page, "en", "tr")).toBeNull();
    const content = resolveAboutContent(getAboutDataForLocale(page, "en", "tr"), EN_DEFAULTS);
    expect(content.hero.title).toBe(enAboutStrings.heroTitle);
  });

  it("kayıt yoksa null döner; about bloğu olmayan sayfa şablon sayılmaz", () => {
    expect(getAboutDataForLocale(null, "tr", "tr")).toBeNull();
    expect(isAboutTemplatePage({ blocks: [{ id: "h", type: "heading", data: {} }], translations: {} })).toBe(false);
    expect(isAboutTemplatePage({ blocks: [], translations: { en: { blocks: [enBlock] } } })).toBe(true);
  });
});

describe("resolveAboutHref", () => {
  it("site içi yolları aktif dile göre önekler; çapa ve mutlak adresleri olduğu gibi bırakır", () => {
    expect(resolveAboutHref("/doctors", "en", "tr")).toBe("/en/doctors");
    expect(resolveAboutHref("/doctors", "tr", "tr")).toBe("/doctors");
    expect(resolveAboutHref("#doctors", "en", "tr")).toBe("#doctors");
    expect(resolveAboutHref("https://example.com/a", "en", "tr")).toBe("https://example.com/a");
    expect(resolveAboutHref("//cdn.example.com/a", "en", "tr")).toBe("//cdn.example.com/a");
  });
});

describe("toEditableAboutContent — admin formu", () => {
  it("boş alanları varsayılanla DOLDURMAZ ve adı boş yeni kartları atmaz", () => {
    const editable = toEditableAboutContent({ hero: { title: "" }, treatments: { items: [{ id: "n", name: "", icon: "Heart" }] } });
    expect(editable.hero.title).toBe("");
    expect(editable.treatments.items).toEqual([{ id: "n", name: "", icon: "Heart" }]);
    expect(editable.doctors).toMatchObject({ enabled: true, count: 3, founderDoctorId: null });
  });
});

describe("AboutDoctors", () => {
  const baseProps = {
    doctorsHref: "/en/doctors",
    activeLocaleCode: "en",
    defaultLocaleCode: "tr",
    intlLocale: "en-US",
  };

  it("yalnızca kurucunun kartında etiket gösterir, uzmanlık adını veritabanından olduğu gibi basar", () => {
    const { doctors, founderId } = selectAboutDoctors(DOCTORS, "2", 3);
    render(<AboutDoctors {...baseProps} section={EN_DEFAULTS.doctors} telehealthDict={enTelehealthStrings} doctors={doctors} founderId={founderId} />);

    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    expect(within(cards[0]!).getByText("Founder")).toBeInTheDocument();
    expect(within(cards[1]!).queryByText("Founder")).not.toBeInTheDocument();
    expect(screen.getAllByText("Cardiology")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "View all doctors" })).toHaveAttribute("href", "/en/doctors");
    expect(screen.getByRole("heading", { level: 2, name: "Meet our doctors" })).toBeInTheDocument();
  });

  it("kurucu seçilmemişken ilk 3 aktif doktoru hiçbir etiket olmadan render eder", () => {
    const { doctors, founderId } = selectAboutDoctors(DOCTORS, null, 3);
    render(<AboutDoctors {...baseProps} section={EN_DEFAULTS.doctors} telehealthDict={enTelehealthStrings} doctors={doctors} founderId={founderId} />);

    const cards = screen.getAllByRole("listitem");
    expect(cards.map((card) => within(card).getByRole("heading", { level: 3 }).textContent)).toEqual(["Dr. Doctor 1", "Dr. Doctor 2", "Dr. Doctor 3"]);
    expect(screen.queryByText("Founder")).not.toBeInTheDocument();
  });

  it("admin'in girdiği metinleri kullanır (tr)", () => {
    const section = resolveAboutContent({ doctors: { title: "Ekibimiz", founderLabel: "Kurucu Hekim" } }, TR_DEFAULTS).doctors;
    const { doctors, founderId } = selectAboutDoctors(DOCTORS, "1", 3);
    render(
      <AboutDoctors
        {...baseProps}
        activeLocaleCode="tr"
        intlLocale="tr-TR"
        doctorsHref="/doctors"
        section={section}
        telehealthDict={trTelehealthStrings}
        doctors={doctors}
        founderId={founderId}
      />
    );
    expect(screen.getByRole("heading", { level: 2, name: "Ekibimiz" })).toBeInTheDocument();
    expect(screen.getByText("Kurucu Hekim")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tüm doktorlar" })).toHaveAttribute("href", "/doctors");
  });
});

describe("about sözlüğü", () => {
  it("tr'deki randevu CTA'sı mevcut telehealth karşılığını yeniden kullanır", () => {
    expect(trAboutStrings.bookConsultationCta).toBe(trTelehealthStrings.bookAppointmentCta);
  });

  it("en ve tr aynı anahtar kümesine sahiptir", () => {
    expect(Object.keys(trAboutStrings).sort()).toEqual(Object.keys(enAboutStrings).sort());
  });

  it("ikon listesi tekrarsızdır", () => {
    expect(new Set(ABOUT_ICON_KEYS).size).toBe(ABOUT_ICON_KEYS.length);
  });
});
