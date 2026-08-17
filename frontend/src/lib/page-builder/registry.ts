import type { Block, BlockType } from "./types";

/**
 * Palette blok tipleri — §10.17.6 mimar kararı: `registry.ts`'e `columns` EKLENMEZ, palette'te
 * "Sütun" diye bir öğe yoktur. Sütun, var olan bir bloğun "Düzen" seçiciyle sarmalanmasıyla
 * oluşur (bkz. `lib/page-builder/columns.ts`).
 */
export type PaletteBlockType = Exclude<BlockType, "columns">;

export const blockRegistry: Record<PaletteBlockType, { label: string }> = {
  hero: { label: "Hero" },
  text: { label: "Metin" },
  image: { label: "Görsel" },
  gallery: { label: "Galeri" },
  cta: { label: "Çağrı Butonu (CTA)" },
  "featured-products": { label: "Öne Çıkan Ürünler" },
  "featured-portfolio": { label: "Öne Çıkan Projeler" },
};

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export function createBlock(type: PaletteBlockType): Block {
  const id = newId();
  switch (type) {
    case "hero":
      return { id, type, data: { heading: "Başlık", subheading: "" } };
    case "text":
      return { id, type, data: { html: "<p>Metin girin…</p>" } };
    case "image":
      return { id, type, data: { url: "", alt: "" } };
    case "gallery":
      return { id, type, data: { images: [] } };
    case "cta":
      return { id, type, data: { heading: "Harekete geçin", buttonLabel: "Tıklayın", buttonHref: "/" } };
    case "featured-products":
      return { id, type, data: { heading: "", limit: 4 } };
    case "featured-portfolio":
      return { id, type, data: { heading: "", limit: 4 } };
  }
}
