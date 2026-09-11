import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DoctorProfileHero } from "@/components/site/telehealth/doctor-profile-hero";
import type { DoctorProfile } from "@/lib/api/types";

/** `.claude/design-notes-telehealth.md` §2.1.2 — hero başlık satırı. */
function makeDoctor(overrides: Partial<DoctorProfile> = {}): DoctorProfile {
  return {
    id: "doctor-1",
    userId: null,
    specialtyId: "specialty-1",
    specialty: {
      id: "specialty-1",
      name: "Kardiyoloji",
      slug: "kardiyoloji",
      icon: "heart",
      description: null,
      order: 0,
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    title: "Dr.",
    fullName: "Elif Aydemir",
    slug: "dr-elif-aydemir",
    bio: "Örnek biyografi.",
    languages: ["tr", "en"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 45000,
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

describe("DoctorProfileHero", () => {
  it("gerçek avatar YOKSA monogram fallback'i (baş harfler + marka gradyanı) gösterir, taşma OLMAZ", () => {
    render(<DoctorProfileHero doctor={makeDoctor()} />);
    expect(screen.getByText("EA")).toBeInTheDocument();
  });

  it("gerçek `avatarMedia` VARSA <img> render eder, monogram GÖRÜNMEZ", () => {
    render(
      <DoctorProfileHero
        doctor={makeDoctor({
          avatarMedia: {
            id: "m1",
            url: "https://example.com/a.jpg",
            filename: "a.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 1024,
            altText: "Dr. Elif Aydemir",
            width: 512,
            height: 512,
            folderId: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        })}
      />
    );
    const img = screen.getByRole("img", { name: "Dr. Elif Aydemir" });
    expect(img).toHaveAttribute("src", "https://example.com/a.jpg");
    expect(screen.queryByText("EA")).not.toBeInTheDocument();
  });

  it("`isVerified: true` iken 'Doğrulanmış Hekim' chip'i gösterir", () => {
    render(<DoctorProfileHero doctor={makeDoctor({ isVerified: true })} />);
    expect(screen.getByText("Doğrulanmış Hekim")).toBeInTheDocument();
  });

  it("`isVerified: false` iken 'Doğrulanmış Hekim' chip'i HİÇ render EDİLMEZ (sahte negatif sinyal yok)", () => {
    render(<DoctorProfileHero doctor={makeDoctor({ isVerified: false })} />);
    expect(screen.queryByText("Doğrulanmış Hekim")).not.toBeInTheDocument();
  });

  it("uzmanlık chip'i doktorun uzmanlık adını gösterir, uzmanlık YOKSA 'Genel Danışmanlık' fallback'ine düşer", () => {
    render(<DoctorProfileHero doctor={makeDoctor()} />);
    expect(screen.getByText("Kardiyoloji")).toBeInTheDocument();

    render(<DoctorProfileHero doctor={makeDoctor({ specialty: null, specialtyId: null })} />);
    expect(screen.getByText("Genel Danışmanlık")).toBeInTheDocument();
  });

  it("dil rozetlerini ISO kodunun büyük harfli hali olarak gösterir + erişilebilir tam ad `aria-label`'ı taşır", () => {
    render(<DoctorProfileHero doctor={makeDoctor({ languages: ["tr", "en"] })} />);
    expect(screen.getByText("TR")).toBeInTheDocument();
    expect(screen.getByText("EN")).toBeInTheDocument();
    expect(screen.getByLabelText("Konuşulan diller: Türkçe, İngilizce")).toBeInTheDocument();
  });

  it("uzun ad `break-words` ile ikinci satıra sarkar, `truncate` KULLANILMAZ (kesilmez)", () => {
    render(<DoctorProfileHero doctor={makeDoctor({ fullName: "Çok Uzun Bir Ad Soyad Örneği Testi" })} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.className).toContain("break-words");
    expect(heading.className).not.toContain("truncate");
    expect(heading).toHaveTextContent("Dr. Çok Uzun Bir Ad Soyad Örneği Testi");
  });
});
