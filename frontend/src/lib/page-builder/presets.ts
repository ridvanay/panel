import { newId } from "./registry";
import { DEFAULT_CONTAINER_SETTINGS, type ContainerNode } from "./types";

/**
 * Layout Picker ön ayarları (§8.2 mimar dokümanı). `weights` AĞIRLIKTIR, yüzde DEĞİL — `33/66`
 * tam olarak `1fr 2fr` demektir; yüzdeleri ayrıca saklamak `widthFr` ile senkron kalması gereken
 * ikinci bir gerçek kaynağı yaratırdı (v1'in `columnCount` hatası). Sıra, ui-designer'ın
 * `design-notes-page-builder-container-ui.md` §1.2 tablosuyla BİREBİR aynıdır.
 */
export type LayoutPresetId = "100" | "50-50" | "33-66" | "66-33" | "33-33-33" | "25-50-25" | "25-25-25-25";

export interface LayoutPreset {
  id: LayoutPresetId;
  /** TR, kullanıcıya dönük etiket. */
  label: string;
  /** Alt konteynerlerin `widthFr` ağırlıkları. Uzunluk = oluşacak sütun sayısı. */
  weights: number[];
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: "100", label: "Tek Sütun", weights: [1] },
  { id: "50-50", label: "İki Eşit Sütun", weights: [1, 1] },
  { id: "33-66", label: "Dar + Geniş", weights: [1, 2] },
  { id: "66-33", label: "Geniş + Dar", weights: [2, 1] },
  { id: "33-33-33", label: "Üç Eşit Sütun", weights: [1, 1, 1] },
  { id: "25-50-25", label: "Dar + Geniş + Dar", weights: [1, 2, 1] },
  { id: "25-25-25-25", label: "Dört Eşit Sütun", weights: [1, 1, 1, 1] },
];

/**
 * Bir ön ayardan yeni bir `ContainerNode` üretir. `"100"` (`weights.length === 1`) TEK bir
 * konteyner döner (alt konteyner YOK — "sadece bir bölüm/section ekle" durumu). Diğerleri: dış
 * konteyner (`direction: "row"`) + `weights.length` adet alt konteyner (`direction: "column"`,
 * her biri kendi `widthFr`'ini taşır).
 */
export function createContainerFromPreset(preset: LayoutPreset): ContainerNode {
  if (preset.weights.length <= 1) {
    return {
      id: newId(),
      type: "container",
      settings: { ...DEFAULT_CONTAINER_SETTINGS },
      children: [],
    };
  }

  return {
    id: newId(),
    type: "container",
    settings: { ...DEFAULT_CONTAINER_SETTINGS, direction: "row" },
    children: preset.weights.map((weight) => ({
      id: newId(),
      type: "container",
      settings: { ...DEFAULT_CONTAINER_SETTINGS, widthFr: weight },
      children: [],
    })),
  };
}
