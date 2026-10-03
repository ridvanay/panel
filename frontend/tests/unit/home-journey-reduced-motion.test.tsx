import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

/**
 * journey-v2 turu (2026-10-03) — `prefers-reduced-motion: reduce` açıkken komet/nabız/float
 * animasyonlarının HİÇ render edilmediğini doğrular (görev dosyası §"Hareket": "her şey statik
 * ve tam çizili olsun"). Ayrı dosya — `vi.mock` HOISTED olduğu için dosyanın TAMAMINDA
 * `useReducedMotion` sahteleniyor, `home-journey-globe.test.tsx`'teki "KAPALIYKEN" testleriyle
 * ÇAKIŞMASIN diye.
 */
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return { ...actual, useReducedMotion: () => true };
});

describe("HomeJourney — prefers-reduced-motion AÇIKKEN", () => {
  it("comet (glow filtreli circle) ve nabız halkaları HİÇ render edilmez, çizgiler yine de DOM'dadır", async () => {
    const { HomeJourney } = await import("@/components/site/home/home-journey");
    const journey = {
      eyebrow: "Global patient journey",
      title: "From Across the World to Istanbul",
      body: "Body text",
      steps: [
        { id: "s1", icon: "Plane" as const, title: "Pre-Travel Planning", text: "Plan ahead." },
        { id: "s2", icon: "MapPin" as const, title: "Arrival in Istanbul", text: "We welcome you." },
      ],
      countries: [{ id: "c1", label: "Germany" }],
    };
    const { container } = render(<HomeJourney journey={journey} stepLabel="Step {number}" istanbulLabel="Istanbul" />);

    expect(container.querySelectorAll("circle[filter]").length).toBe(0);
    expect(container.querySelectorAll("path[stroke^='url(#journey-line']").length).toBe(1);
  });

  it("journey-v3: RotatingGlobe'un rAF döngüsü HİÇ başlamaz (küre dönmez, görev dosyası §\"prefers-reduced-motion\")", async () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");
    const { HomeJourney } = await import("@/components/site/home/home-journey");
    const journey = {
      eyebrow: "Global patient journey",
      title: "From Across the World to Istanbul",
      body: "Body text",
      steps: [{ id: "s1", icon: "Plane" as const, title: "Pre-Travel Planning", text: "Plan ahead." }],
      countries: [{ id: "c1", label: "Germany" }],
    };
    render(<HomeJourney journey={journey} stepLabel="Step {number}" istanbulLabel="Istanbul" />);
    expect(rafSpy).not.toHaveBeenCalled();
    rafSpy.mockRestore();
  });
});
