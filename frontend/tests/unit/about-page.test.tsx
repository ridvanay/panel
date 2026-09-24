import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FOUNDER_DOCTOR_SLUG, selectAboutDoctors } from "@/lib/about-page";
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

describe("selectAboutDoctors", () => {
  it("kurucu bulunursa onu başa alır, ardından API sırasıyla (seq) kurucu hariç ilk 2 doktoru ekler", () => {
    const result = selectAboutDoctors(DOCTORS, "doctor-4");
    expect(result.doctors.map((d) => d.id)).toEqual(["4", "1", "2"]);
    expect(result.founderId).toBe("4");
  });

  it("kurucu zaten ilk sıradaysa tekrar etmez", () => {
    const result = selectAboutDoctors(DOCTORS, "doctor-1");
    expect(result.doctors.map((d) => d.id)).toEqual(["1", "2", "3"]);
    expect(result.founderId).toBe("1");
  });

  it("FOUNDER_DOCTOR_SLUG şu an boştur; varsayılan çağrı etiketsiz ilk 3 aktif doktoru API sırasıyla döner", () => {
    expect(FOUNDER_DOCTOR_SLUG).toBe("");
    expect(selectAboutDoctors(DOCTORS)).toEqual({ doctors: DOCTORS.slice(0, 3), founderId: null });
  });

  it("kurucu slug'ı boşsa veya bulunamazsa hata vermez, etiketsiz ilk 3 doktoru döner", () => {
    expect(selectAboutDoctors(DOCTORS, "")).toEqual({ doctors: DOCTORS.slice(0, 3), founderId: null });
    expect(selectAboutDoctors(DOCTORS, "yok-boyle-bir-doktor")).toEqual({ doctors: DOCTORS.slice(0, 3), founderId: null });
  });

  it("3'ten az doktor varsa olanları döner, boş listede boş döner", () => {
    expect(selectAboutDoctors(DOCTORS.slice(0, 2), "doctor-2").doctors.map((d) => d.id)).toEqual(["2", "1"]);
    expect(selectAboutDoctors([], "doctor-1")).toEqual({ doctors: [], founderId: null });
  });
});

describe("AboutDoctors", () => {
  const baseProps = {
    doctorsHref: "/en/doctors",
    activeLocaleCode: "en",
    defaultLocaleCode: "tr",
    intlLocale: "en-US",
  };

  it("yalnızca kurucunun kartında Founder etiketi gösterir, uzmanlık adını veritabanından olduğu gibi basar", () => {
    const { doctors, founderId } = selectAboutDoctors(DOCTORS, "doctor-2");
    render(<AboutDoctors {...baseProps} dict={enAboutStrings} telehealthDict={enTelehealthStrings} doctors={doctors} founderId={founderId} />);

    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByText("Founder")).toBeInTheDocument();
    expect(within(cards[1]).queryByText("Founder")).not.toBeInTheDocument();
    expect(screen.getAllByText("Cardiology")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "View all doctors" })).toHaveAttribute("href", "/en/doctors");
    expect(screen.getByRole("heading", { level: 2, name: "Meet our doctors" })).toBeInTheDocument();
  });

  it("varsayılan (boş) kurucu slug'ıyla ilk 3 aktif doktoru hiçbir Founder etiketi olmadan render eder", () => {
    const { doctors, founderId } = selectAboutDoctors(DOCTORS);
    render(<AboutDoctors {...baseProps} dict={enAboutStrings} telehealthDict={enTelehealthStrings} doctors={doctors} founderId={founderId} />);

    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => within(card).getByRole("heading", { level: 3 }).textContent)).toEqual([
      "Dr. Doctor 1",
      "Dr. Doctor 2",
      "Dr. Doctor 3",
    ]);
    expect(screen.queryByText("Founder")).not.toBeInTheDocument();
  });

  it("tr sözlüğüyle Türkçe metinleri kullanır", () => {
    const { doctors, founderId } = selectAboutDoctors(DOCTORS, "doctor-1");
    render(<AboutDoctors {...baseProps} activeLocaleCode="tr" intlLocale="tr-TR" doctorsHref="/doctors" dict={trAboutStrings} telehealthDict={trTelehealthStrings} doctors={doctors} founderId={founderId} />);

    expect(screen.getByText("Kurucu")).toBeInTheDocument();
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
});
