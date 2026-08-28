import { describe, expect, it } from "vitest";
import { resolveLayerForDevice } from "@/components/site/advanced-slider/resolve-responsive";
import type { SliderLayer } from "@/lib/sliders/types";

function baseLayer(): SliderLayer {
  return {
    id: "l1",
    type: "heading",
    content: { text: "Yeni Sezon", level: 2 },
    position: { xPercent: 10, yPercent: 50, origin: "middle-left", offsetX: 0, offsetY: 0 },
    style: { fontSize: 64, color: "#ffffff", fontWeight: 700 },
    animation: { inEffect: "fade-up", delayMs: 200, durationMs: 600 },
  };
}

describe("resolveLayerForDevice", () => {
  it("returns the layer unchanged for desktop (canonical fields)", () => {
    const layer = baseLayer();
    const resolved = resolveLayerForDevice(layer, "desktop");
    expect(resolved.hidden).toBe(false);
    expect(resolved.position.xPercent).toBe(10);
    expect(resolved.style.fontSize).toBe(64);
  });

  it("cascades desktop -> tablet: tablet inherits fields it doesn't override", () => {
    const layer: SliderLayer = { ...baseLayer(), responsive: { tablet: { style: { fontSize: 44 } } } };
    const resolved = resolveLayerForDevice(layer, "tablet");
    expect(resolved.style.fontSize).toBe(44);
    // Alan-grubu içinde SIĞ birleştirme: override edilmeyen `color` masaüstünden miras alınır.
    expect(resolved.style.color).toBe("#ffffff");
    expect(resolved.position.xPercent).toBe(10); // position hiç override edilmedi
  });

  it("cascades tablet -> mobile: mobile inherits from tablet (which inherits from desktop)", () => {
    const layer: SliderLayer = {
      ...baseLayer(),
      responsive: {
        tablet: { style: { fontSize: 44 } },
        mobile: { position: { xPercent: 50, yPercent: 50, origin: "middle-center" }, style: { textAlign: "center" } },
      },
    };
    const resolved = resolveLayerForDevice(layer, "mobile");
    // mobile.style yalnızca textAlign'ı override eder — fontSize TABLET'ten (44), color MASAÜSTÜ'nden miras alınır.
    expect(resolved.style.fontSize).toBe(44);
    expect(resolved.style.color).toBe("#ffffff");
    expect(resolved.style.textAlign).toBe("center");
    expect(resolved.position.xPercent).toBe(50);
    expect(resolved.position.origin).toBe("middle-center");
  });

  it("QA §7 madde 3 — mobil override İZOLE kalır, masaüstü değeri DEĞİŞMEZ", () => {
    const layer: SliderLayer = { ...baseLayer(), responsive: { mobile: { style: { fontSize: 30 } } } };
    const desktopResolved = resolveLayerForDevice(layer, "desktop");
    const mobileResolved = resolveLayerForDevice(layer, "mobile");
    expect(desktopResolved.style.fontSize).toBe(64);
    expect(mobileResolved.style.fontSize).toBe(30);
  });

  it("content is never touched by responsive overrides", () => {
    const layer: SliderLayer = { ...baseLayer(), responsive: { mobile: { style: { fontSize: 30 } } } };
    const resolved = resolveLayerForDevice(layer, "mobile");
    expect(resolved.content).toBe(layer.content);
  });

  it("hidden defaults to false unless explicitly overridden for the device", () => {
    const layer: SliderLayer = { ...baseLayer(), responsive: { mobile: { hidden: true } } };
    expect(resolveLayerForDevice(layer, "desktop").hidden).toBe(false);
    expect(resolveLayerForDevice(layer, "tablet").hidden).toBe(false);
    expect(resolveLayerForDevice(layer, "mobile").hidden).toBe(true);
  });
});
