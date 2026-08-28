import { describe, expect, it } from "vitest";
import { isLayerHiddenOnDevice, patchLayerGroup, removeLayerGroupOverride, resolveGroupForEditing } from "@/components/admin/hero-studio/layer-mutations";
import type { SliderLayer } from "@/lib/sliders/types";

function baseLayer(): SliderLayer {
  return {
    id: "l1",
    type: "heading",
    content: { text: "Başlık", level: 2 },
    position: { xPercent: 10, yPercent: 50, origin: "middle-left", offsetX: 0, offsetY: 0 },
    style: { fontSize: 64 },
    animation: { inEffect: "fade-up", delayMs: 200, durationMs: 600 },
  };
}

describe("patchLayerGroup", () => {
  it("device=desktop writes ROOT fields directly", () => {
    const layer = baseLayer();
    const next = patchLayerGroup(layer, "desktop", "position", { xPercent: 25 });
    expect(next.position.xPercent).toBe(25);
    expect(next.responsive).toBeUndefined();
  });

  it("device=tablet/mobile writes ONLY responsive.<device>.<group>, root stays untouched", () => {
    const layer = baseLayer();
    const next = patchLayerGroup(layer, "mobile", "style", { fontSize: 30 });
    expect(next.style.fontSize).toBe(64); // kök DEĞİŞMEDİ
    expect(next.responsive?.mobile?.style?.fontSize).toBe(30);
  });

  it("patching a second field for the same device/group preserves the first (shallow merge)", () => {
    const layer = baseLayer();
    const step1 = patchLayerGroup(layer, "mobile", "style", { fontSize: 30 });
    const step2 = patchLayerGroup(step1, "mobile", "style", { textAlign: "center" });
    expect(step2.responsive?.mobile?.style?.fontSize).toBe(30);
    expect(step2.responsive?.mobile?.style?.textAlign).toBe("center");
  });

  it("patching tablet does not affect an existing mobile override", () => {
    const layer = baseLayer();
    const withMobile = patchLayerGroup(layer, "mobile", "style", { fontSize: 30 });
    const withTablet = patchLayerGroup(withMobile, "tablet", "style", { fontSize: 44 });
    expect(withTablet.responsive?.mobile?.style?.fontSize).toBe(30);
    expect(withTablet.responsive?.tablet?.style?.fontSize).toBe(44);
  });
});

describe("resolveGroupForEditing", () => {
  it("reports overridden=false on desktop", () => {
    const layer = baseLayer();
    const { overridden } = resolveGroupForEditing(layer, "style", "desktop");
    expect(overridden).toBe(false);
  });

  it("reports overridden=true only for the device that actually has an override", () => {
    const layer = patchLayerGroup(baseLayer(), "mobile", "style", { fontSize: 30 });
    expect(resolveGroupForEditing(layer, "style", "desktop").overridden).toBe(false);
    expect(resolveGroupForEditing(layer, "style", "tablet").overridden).toBe(false);
    expect(resolveGroupForEditing(layer, "style", "mobile").overridden).toBe(true);
  });
});

describe("removeLayerGroupOverride", () => {
  it("removes the override key entirely (not set to null) and reverts to inherited value", () => {
    const layer = patchLayerGroup(baseLayer(), "mobile", "style", { fontSize: 30 });
    const cleared = removeLayerGroupOverride(layer, "mobile", "style");
    expect(cleared.responsive).toBeUndefined();
    expect(resolveGroupForEditing(cleared, "style", "mobile").value.fontSize).toBe(64);
  });

  it("removing one group's override leaves sibling groups/devices intact", () => {
    let layer = patchLayerGroup(baseLayer(), "mobile", "style", { fontSize: 30 });
    layer = patchLayerGroup(layer, "mobile", "position", { xPercent: 50 });
    layer = patchLayerGroup(layer, "tablet", "style", { fontSize: 44 });

    const cleared = removeLayerGroupOverride(layer, "mobile", "style");
    expect(cleared.responsive?.mobile?.position?.xPercent).toBe(50);
    expect(cleared.responsive?.mobile?.style).toBeUndefined();
    expect(cleared.responsive?.tablet?.style?.fontSize).toBe(44);
  });
});

describe("isLayerHiddenOnDevice", () => {
  it("mobile inherits tablet's hidden flag when mobile has no explicit override", () => {
    const layer: SliderLayer = { ...baseLayer(), responsive: { tablet: { hidden: true } } };
    expect(isLayerHiddenOnDevice(layer, "desktop")).toBe(false);
    expect(isLayerHiddenOnDevice(layer, "tablet")).toBe(true);
    expect(isLayerHiddenOnDevice(layer, "mobile")).toBe(true);
  });
});
