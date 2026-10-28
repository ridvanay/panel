import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import type { DoctorProfile } from "@/lib/api/types";
import { doctorDisplayName, publicDoctorName } from "@/lib/doctor-display-name";
import { DoctorPublicNameField } from "@/components/admin/telehealth/doctor-public-name-field";
import { DoctorCard } from "@/components/site/telehealth/doctor-card";
import { buildDoctorJsonLd } from "@/lib/doctor-json-ld";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";

/**
 * Paket U (C) — frontend kopyası backend ile aynı örnekleri verir (admin önizlemesi); ziyaretçi
 * bileşenleri (kart, JSON-LD) API'nin görünen adını kullanır; Arapça (RTL) ve Sırpça Latin'de ad
 * gösterimi bozulmaz; admin formu otomatik kısaltmayı ve elle düzeltmeyi canlı önizler.
 */
const EXAMPLES: [string, string][] = [
  ["Hakan SOFU", "H. Sofu"],
  ["Doğukan YILDIRIM", "D. Yıldırım"],
  ["Kamil ÖZDİL", "K. Özdil"],
  ["Ayşe Zehra ÖZDEMİR KAYA", "A. Z. Özdemir Kaya"],
  ["Hasan Tuna Türkmen", "H. T. Türkmen"],
  ["Ali FIRAT", "A. Fırat"],
  ["Kadir KOLCUOĞLU", "K. Kolcuoğlu"],
];

function makeDoctor(overrides: Partial<DoctorProfile> = {}): DoctorProfile {
  return {
    id: "d1",
    userId: null,
    specialtyId: null,
    specialty: null,
    title: "Prof. Dr.",
    // Public API yanıtındaki gibi: `fullName` de görünen addır.
    fullName: "H. Sofu",
    displayName: "H. Sofu",
    slug: "hakan-sofu",
    subSpecialty: null,
    bio: "Orthopedics.",
    aboutHtml: null,
    practiceStartYear: null,
    experienceYears: null,
    cvEntries: [],
    publications: [],
    socialLinks: [],
    languages: ["tr", "en"],
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
  } as DoctorProfile;
}

describe("doktor görünen adı — frontend", () => {
  it.each(EXAMPLES)("%s → %s (backend ile aynı)", (fullName, expected) => {
    expect(doctorDisplayName({ fullName, isFounder: false })).toBe(expected);
  });

  it("kurucu tam ad; publicName doluysa o; publicDoctorName displayName'i tercih eder", () => {
    expect(doctorDisplayName({ fullName: "Vahit MUTLU", isFounder: true })).toBe("Vahit MUTLU");
    expect(doctorDisplayName({ fullName: "Hakan SOFU", publicName: "Hakan Sofu" })).toBe("Hakan Sofu");
    expect(publicDoctorName({ fullName: "x", displayName: "H. Sofu" })).toBe("H. Sofu");
  });

  it("JSON-LD Physician: ad görünen ad, tam ad yalnızca alternateName (SEO kararı)", () => {
    const json = JSON.parse(buildDoctorJsonLd(makeDoctor(), "https://example.com/doctors/hakan-sofu", "Hakan SOFU"));
    expect(json.name).toBe("Prof. Dr. H. Sofu");
    expect(json.alternateName).toBe("Hakan SOFU");
    // Kurucu / tam adla gösterilen doktorda alternateName eklenmez; verilmezse de yok.
    expect(JSON.parse(buildDoctorJsonLd(makeDoctor({ fullName: "Vahit MUTLU", displayName: "Vahit MUTLU" }), "https://x", "Vahit MUTLU")).alternateName).toBeUndefined();
    expect(buildDoctorJsonLd(makeDoctor(), "https://x")).not.toContain("Hakan");
  });

  it("doktor kartı Arapça (RTL) ve Sırpça Latin'de adı bozmadan gösterir", async () => {
    for (const lang of ["ar", "sr-latn"]) {
      const dict = (await getSiteDictionary(lang)).telehealth;
      const { container, unmount } = render(
        <div dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
          <DoctorCard doctor={makeDoctor()} activeLocaleCode={lang} defaultLocaleCode="en" dict={dict} />
        </div>
      );
      expect(container.textContent).toContain("Prof. Dr. H. Sofu");
      expect(container.textContent).not.toContain("Hakan");
      unmount();
    }
  });
});

function FieldHarness({ fullName, publicName, isFounder }: { fullName: string; publicName: string; isFounder: boolean }) {
  const { register } = useForm<{ publicName: string }>({ defaultValues: { publicName } });
  return <DoctorPublicNameField registration={register("publicName")} title="Prof. Dr." fullName={fullName} publicName={publicName} isFounder={isFounder} />;
}

describe("admin — sitede görünen ad alanı", () => {
  it("boşken otomatik kısaltmayı etiket ve önizlemede gösterir", () => {
    render(<FieldHarness fullName="Hakan SOFU" publicName="" isFounder={false} />);
    expect(screen.getByText(/boş bırakılırsa otomatik: H\. Sofu/)).toBeInTheDocument();
    expect(screen.getByTestId("doctor-public-name-preview")).toHaveTextContent("Prof. Dr. H. Sofu");
  });

  it("elle düzeltme önizlemeye yansır; kurucuda otomatik değer tam addır", () => {
    const { unmount } = render(<FieldHarness fullName="Hakan SOFU" publicName="Hakan Sofu" isFounder={false} />);
    expect(screen.getByTestId("doctor-public-name-preview")).toHaveTextContent("Prof. Dr. Hakan Sofu");
    unmount();
    render(<FieldHarness fullName="Vahit MUTLU" publicName="" isFounder />);
    expect(screen.getByTestId("doctor-public-name-preview")).toHaveTextContent("Prof. Dr. Vahit MUTLU");
  });
});
