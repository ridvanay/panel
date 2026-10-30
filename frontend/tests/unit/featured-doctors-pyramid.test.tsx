import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { DoctorProfile } from "@/lib/api/types";
import type { FeaturedDoctorsBlock } from "@/lib/page-builder/types";
import { createBlock } from "@/lib/page-builder/registry";

/**
 * Paket P (İş 3) — Öne Çıkan Doktorlar "piramit": kurucu üstte (büyük kart, "Kurucu" rozeti, uzmanlık,
 * bio'nun ilk cümlesi), ince ayraç, diğerleri altında ortalanmış; kurucu yoksa ızgara gibi. Arşivli ve
 * pasif doktorlar hiç görünmez. Rozet 6 dilde (Arapça dahil).
 */
const fetchDoctorsServer = vi.fn<() => Promise<DoctorProfile[]>>();
vi.mock("@/lib/api/server-telehealth", () => ({ fetchAllDoctorsServer: () => fetchDoctorsServer() }));

import { FeaturedDoctorsBlockView, firstSentence, splitFounderPyramid } from "@/components/site/blocks/featured-doctors-block";

let seq = 0;
function doctor(overrides: Partial<DoctorProfile>): DoctorProfile {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    userId: null,
    specialtyId: null,
    specialty: null,
    additionalSpecialties: [],
    title: "Dr.",
    subSpecialty: null,
    fullName: `Doktor ${seq}`,
    slug: `doktor-${seq}`,
    bio: "Kısa özet.",
    aboutHtml: null,
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: null,
    currency: "TRY",
    avatarMediaId: null,
    avatarMedia: null,
    isVerified: false,
    isActive: true,
    order: 0,
    availability: [],
    isFounder: false,
    rosterTier: null,
    ...overrides,
  } as DoctorProfile;
}

function block(data: Partial<FeaturedDoctorsBlock["data"]>): FeaturedDoctorsBlock {
  const base = createBlock("featured-doctors") as FeaturedDoctorsBlock;
  return { ...base, data: { ...base.data, ...data } };
}

beforeEach(() => fetchDoctorsServer.mockReset());

describe("piramit yardımcıları", () => {
  it("kurucu ayrılır; 'tümü' kaynağında diğerleri katman → sıra; kurucu yoksa null", () => {
    const a = doctor({ order: 2 });
    const b = doctor({ order: 1, rosterTier: 2 });
    const f = doctor({ isFounder: true, order: 5 });
    const c = doctor({ order: 0 });
    expect(splitFounderPyramid([a, b, f, c], "all")).toEqual({ founder: f, others: [b, c, a] });
    expect(splitFounderPyramid([a, f, c], "selected")!.others).toEqual([a, c]); // seçim sırası korunur
    expect(splitFounderPyramid([a, c], "all")).toBeNull();
  });

  it("ilk cümle", () => {
    expect(firstSentence("Genel cerrah. Bariatrik cerrahide uzman.")).toBe("Genel cerrah.");
    expect(firstSentence("Noktasız tek cümle")).toBe("Noktasız tek cümle");
    expect(firstSentence(null)).toBe("");
  });
});

describe("FeaturedDoctorsBlockView — pyramid", () => {
  it("kurucu üstte rozet, uzmanlık ve kısa tanıtımla; ayraç ve diğerleri altında; arşivli/pasif görünmez", async () => {
    fetchDoctorsServer.mockResolvedValue([
      doctor({ fullName: "Ayşe Yılmaz", slug: "ayse" }),
      doctor({
        title: "Doç. Dr.",
        fullName: "Vahit Mutlu",
        slug: "vahit-mutlu",
        isFounder: true,
        bio: "Bariatrik ve metabolik cerrahi uzmanı. İkinci cümle.",
        specialty: { name: "Obezite ve Metabolik Cerrahi" } as DoctorProfile["specialty"],
      }),
      doctor({ fullName: "Test Arşiv", slug: "test-arsiv", archivedAt: "2026-10-01T00:00:00.000Z" } as Partial<DoctorProfile>),
      doctor({ fullName: "Test Pasif", slug: "test-pasif", isActive: false }),
      doctor({ fullName: "Mehmet Kaya", slug: "mehmet" }),
    ]);
    render(await FeaturedDoctorsBlockView({ block: block({ source: "all", layout: "pyramid" }), chrome: "page", siteContext: { lang: "tr", defaultLocaleCode: "tr" } }));

    const pyramid = screen.getByTestId("featured-doctors-pyramid");
    const founder = within(pyramid).getByTestId("featured-founder-card");
    expect(founder).toHaveAttribute("href", "/physicians/vahit-mutlu");
    expect(founder).toHaveTextContent("Kurucu");
    expect(founder).toHaveTextContent("Doç. Dr. Vahit Mutlu");
    expect(founder).toHaveTextContent("Obezite ve Metabolik Cerrahi");
    expect(founder).toHaveTextContent("Bariatrik ve metabolik cerrahi uzmanı.");
    expect(founder).not.toHaveTextContent("İkinci cümle");
    expect(within(pyramid).getByTestId("pyramid-connector")).toBeInTheDocument();
    const others = within(pyramid).getAllByRole("listitem").map((li) => li.textContent);
    expect(others).toEqual([expect.stringContaining("Ayşe Yılmaz"), expect.stringContaining("Mehmet Kaya")]);
    expect(screen.queryByText(/Test Arşiv|Test Pasif/)).not.toBeInTheDocument();
  });

  it("kurucu yoksa pyramid ızgara gibi davranır", async () => {
    fetchDoctorsServer.mockResolvedValue([doctor({ fullName: "Ayşe" }), doctor({ fullName: "Mehmet" })]);
    render(await FeaturedDoctorsBlockView({ block: block({ source: "all", layout: "pyramid" }), chrome: "page", siteContext: { lang: "tr", defaultLocaleCode: "tr" } }));
    expect(screen.queryByTestId("featured-doctors-pyramid")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("Arapça: rozet 'المؤسس'", async () => {
    fetchDoctorsServer.mockResolvedValue([doctor({ isFounder: true, fullName: "Vahit Mutlu" })]);
    render(await FeaturedDoctorsBlockView({ block: block({ source: "all", layout: "pyramid" }), chrome: "page", siteContext: { lang: "ar", defaultLocaleCode: "tr" } }));
    expect(screen.getByTestId("featured-founder-card")).toHaveTextContent("المؤسس");
  });
});
