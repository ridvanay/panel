import { describe, expect, it } from "vitest";
import { LAYOUT_PRESETS, createContainerFromPreset, type LayoutPresetId } from "@/lib/page-builder/presets";
import { DEFAULT_CONTAINER_SETTINGS, type ContainerNode } from "@/lib/page-builder/types";

describe("LAYOUT_PRESETS", () => {
  it("mimar/ui-designer dokümanlarındaki 7 ön ayarı, AYNI sırada ve AYNI ağırlıklarla tanımlar", () => {
    const expected: { id: LayoutPresetId; weights: number[] }[] = [
      { id: "100", weights: [1] },
      { id: "50-50", weights: [1, 1] },
      { id: "33-66", weights: [1, 2] },
      { id: "66-33", weights: [2, 1] },
      { id: "33-33-33", weights: [1, 1, 1] },
      { id: "25-50-25", weights: [1, 2, 1] },
      { id: "25-25-25-25", weights: [1, 1, 1, 1] },
    ];
    expect(LAYOUT_PRESETS.map((p) => ({ id: p.id, weights: p.weights }))).toEqual(expected);
  });

  it("her ön ayarın TR kullanıcıya dönük, boş olmayan bir etiketi vardır", () => {
    for (const preset of LAYOUT_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });
});

describe("createContainerFromPreset", () => {
  it('"100" (Tek Sütun) — alt konteyner OLMADAN tek bir konteyner üretir', () => {
    const preset = LAYOUT_PRESETS.find((p) => p.id === "100")!;
    const container = createContainerFromPreset(preset);
    expect(container.type).toBe("container");
    expect(container.settings).toEqual(DEFAULT_CONTAINER_SETTINGS);
    expect(container.children).toEqual([]);
  });

  it.each(LAYOUT_PRESETS.filter((p) => p.weights.length > 1))(
    '"$id" — dış konteyner direction:"row" + weights.length adet alt konteyner (her biri widthFr taşır)',
    (preset) => {
      const container = createContainerFromPreset(preset);
      expect(container.settings.direction).toBe("row");
      expect(container.children).toHaveLength(preset.weights.length);
      for (const [index, child] of container.children.entries()) {
        expect(child.type).toBe("container");
        const childContainer = child as ContainerNode;
        expect(childContainer.settings.direction).toBe("column");
        expect(childContainer.settings.widthFr).toBe(preset.weights[index]);
        expect(childContainer.children).toEqual([]);
      }
    }
  );

  it("her çağrıda benzersiz id'ler üretir (dış + iç konteynerler)", () => {
    const preset = LAYOUT_PRESETS.find((p) => p.id === "50-50")!;
    const a = createContainerFromPreset(preset);
    const b = createContainerFromPreset(preset);
    const allIds = [a.id, ...a.children.map((c) => c.id), b.id, ...b.children.map((c) => c.id)];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it.each(LAYOUT_PRESETS)('"$id" — geçerli/tam bir ContainerNode üretir (settings BÜTÜN alanları taşır)', (preset) => {
    const container = createContainerFromPreset(preset);
    expect(container.id).toBeTruthy();
    expect(container.settings.layout).toBe("boxed");
    expect(container.settings.gap).toBe(DEFAULT_CONTAINER_SETTINGS.gap);
  });
});
