import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { HomeJourney } from "@/components/site/home/home-journey";

/**
 * journey-v3 turu (2026-10-03) — RotatingGlobe'un rAF yaşam döngüsü testleri (görev dosyası
 * §"Test ve teslim": "bileşen unmount'ta döngüyü durduruyor mu"). Varsayılan jsdom
 * `IntersectionObserver` polyfill'i (tests/setup.ts) HİÇBİR görünürlük bildirmediği için
 * (`observe()` no-op) bu dosyaya özel, SENKRON `isIntersecting: true` bildiren bir sahte
 * kuruluyor — aksi halde döngü gerçek tarayıcı dışında asla "görünür" sayılmaz ve rAF hiç
 * tetiklenmez (ayrı dosya: diğer testlerin varsayılan polyfill'ini BOZMAMAK için).
 */
describe("HomeJourney — RotatingGlobe rAF yaşam döngüsü (hareket AÇIK)", () => {
  let realIO: typeof IntersectionObserver;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    realIO = globalThis.IntersectionObserver;
    class ImmediateVisibleIntersectionObserver {
      private callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    globalThis.IntersectionObserver = ImmediateVisibleIntersectionObserver as unknown as typeof IntersectionObserver;

    // rAF/cAF'i GERÇEKTEN çağırmayan (yalnızca kaydeden) sahteler — döngünün kendi kendini
    // yinelemesi (`requestAnimationFrame(loop)`) test ortamında SONSUZ ÖZYİNELEMEYE yol
    // AÇMAZ, çünkü callback hiçbir zaman otomatik tetiklenmez.
    rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(42);
    cafSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.IntersectionObserver = realIO;
    rafSpy.mockRestore();
    cafSpy.mockRestore();
  });

  it("bölüm görünür olduğunda rAF döngüsü BAŞLAR, unmount'ta `cancelAnimationFrame` İLE DURDURULUR", () => {
    const journey = {
      eyebrow: "Global patient journey",
      title: "From Across the World to Istanbul",
      body: "Body text",
      steps: [{ id: "s1", icon: "Plane" as const, title: "Pre-Travel Planning", text: "Plan ahead." }],
      countries: [{ id: "c1", label: "Germany" }],
    };
    const { unmount } = render(<HomeJourney journey={journey} stepLabel="Step {number}" istanbulLabel="Istanbul" />);

    expect(rafSpy).toHaveBeenCalled();
    unmount();
    expect(cafSpy).toHaveBeenCalledWith(42);
  });
});
