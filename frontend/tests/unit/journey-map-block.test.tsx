import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createBlock } from "@/lib/page-builder/registry";
import type { JourneyMapBlock } from "@/lib/page-builder/types";
import { JourneyMapBlockView } from "@/components/site/blocks/journey-map-block";
import { JourneyMapBlockEditor } from "@/components/admin/page-builder/blocks/journey-map-block";

function journeyBlock(overrides: Partial<JourneyMapBlock["data"]> = {}): JourneyMapBlock {
  const base = createBlock("journey-map") as JourneyMapBlock;
  return {
    ...base,
    data: {
      ...base.data,
      eyebrow: "Global patient journey",
      title: "From Across the World to Istanbul",
      body: "Body text",
      steps: [
        { id: "s1", icon: "Plane", title: "Pre-Travel Planning", text: "Plan ahead." },
        { id: "s2", icon: "MapPin", title: "Arrival in Istanbul", text: "We welcome you." },
      ],
      countries: [{ id: "c1", label: "Germany" }],
      ...overrides,
    },
  };
}

describe("JourneyMapBlockView", () => {
  it("içeriği (eyebrow/title/adımlar/ülkeler) render eder, EN varsayılan etiketlerle", () => {
    render(<JourneyMapBlockView block={journeyBlock()} />);
    expect(screen.getByText("Global patient journey")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "From Across the World to Istanbul" })).toBeInTheDocument();
    expect(screen.getByText("Pre-Travel Planning")).toBeInTheDocument();
    expect(screen.getByText("Arrival in Istanbul")).toBeInTheDocument();
    expect(screen.getByText("Germany")).toBeInTheDocument();
    expect(screen.getByText("Istanbul")).toBeInTheDocument();
    expect(screen.getByText(/Step 1/)).toBeInTheDocument();
  });

  it("siteContext.lang=tr iken TR etiketlerini (Adım/İstanbul) kullanır", () => {
    render(<JourneyMapBlockView block={journeyBlock()} siteContext={{ lang: "tr", defaultLocaleCode: "tr" }} />);
    expect(screen.getByText("İstanbul")).toBeInTheDocument();
    expect(screen.getByText(/Adım 1/)).toBeInTheDocument();
  });
});

describe("JourneyMapBlockEditor", () => {
  it("4 adımdayken (HOME_MAX_JOURNEY_STEPS) 'Adım ekle' devre dışı kalır", () => {
    const full = journeyBlock({
      steps: [
        { id: "s1", icon: "Plane", title: "A", text: "" },
        { id: "s2", icon: "MapPin", title: "B", text: "" },
        { id: "s3", icon: "Stethoscope", title: "C", text: "" },
        { id: "s4", icon: "BadgeCheck", title: "D", text: "" },
      ],
    });
    render(<JourneyMapBlockEditor block={full} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Adım ekle/ })).toBeDisabled();
  });

  it("2 adımdayken (HOME_MIN_JOURNEY_STEPS) 'Sil'e basmak onChange'i TETİKLEMEZ (no-op)", () => {
    const minimal = journeyBlock(); // varsayılan 2 adım taşır
    const onChange = vi.fn();
    render(<JourneyMapBlockEditor block={minimal} onChange={onChange} />);
    const removeButtons = screen.getAllByRole("button", { name: "Sil" });
    fireEvent.click(removeButtons[0]!);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ülke eklemeyi HOME_MAX_JOURNEY_COUNTRIES'te durdurur", () => {
    const countries = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, label: `Country ${i}` }));
    const full = journeyBlock({ countries });
    render(<JourneyMapBlockEditor block={full} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Ülke ekle/ })).toBeDisabled();
  });
});
