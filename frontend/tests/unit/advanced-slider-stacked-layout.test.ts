import { describe, expect, it } from "vitest";
import {
  isStackedWidth,
  orderLayersForStack,
  stackAlignSelf,
  stackPaddingInlinePercent,
} from "@/components/site/advanced-slider/stacked-layout";
import type { ResolvedSliderLayer } from "@/components/site/advanced-slider/resolve-responsive";

function layer(id: string, yPercent: number, origin: ResolvedSliderLayer["position"]["origin"] = "bottom-left", extra: Partial<ResolvedSliderLayer> = {}): ResolvedSliderLayer {
  return {
    id,
    type: "text",
    content: { text: id },
    style: {},
    position: { xPercent: 8, yPercent, origin },
    animation: { inEffect: "fade", durationMs: 500, delayMs: 0, easing: "ease-out" },
    hidden: false,
    ...extra,
  } as ResolvedSliderLayer;
}

describe("Hero Studio akış düzeni (1280px altı)", () => {
  it("1280px altında akış düzeni kullanılır; 1280px ve üstü değişmez", () => {
    for (const w of [360, 768, 1024, 1180, 1279]) expect(isStackedWidth(w)).toBe(true);
    for (const w of [1280, 1440, 1920]) expect(isStackedWidth(w)).toBe(false);
  });

  it("katmanları aktif cihazın dikey konumuna göre dizer, gizlileri atar", () => {
    const layers = [
      layer("button", 90),
      layer("heading", 54),
      layer("hidden", 10, "top-left", { hidden: true }),
      layer("badge", 26),
      layer("text", 74),
    ];
    expect(orderLayersForStack(layers).map((l) => l.id)).toEqual(["badge", "heading", "text", "button"]);
  });

  it("aynı dikey konumda üstten hizalı katman önce, sonra orijinal sıra gelir", () => {
    const layers = [layer("b", 50, "bottom-left"), layer("t", 50, "top-left"), layer("t2", 50, "top-left")];
    expect(orderLayersForStack(layers).map((l) => l.id)).toEqual(["t", "t2", "b"]);
  });

  it("yatay hiza orijinden türetilir", () => {
    expect(stackAlignSelf(layer("a", 0, "top-left"))).toBe("flex-start");
    expect(stackAlignSelf(layer("a", 0, "middle-center"))).toBe("center");
    expect(stackAlignSelf(layer("a", 0, "bottom-right"))).toBe("flex-end");
  });

  it("yatay iç boşluk sola hizalı katmanların en küçük x değerinden, 4–10% arasında", () => {
    expect(stackPaddingInlinePercent([layer("a", 0)])).toBe(8);
    expect(stackPaddingInlinePercent([{ ...layer("a", 0), position: { xPercent: 1, yPercent: 0, origin: "top-left" } }])).toBe(4);
    expect(stackPaddingInlinePercent([{ ...layer("a", 0), position: { xPercent: 30, yPercent: 0, origin: "top-left" } }])).toBe(10);
    expect(stackPaddingInlinePercent([layer("c", 0, "top-center")])).toBe(6);
  });
});
