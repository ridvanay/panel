import {
  Heading as HeadingIcon,
  Image as ImageIcon,
  LayoutTemplate,
  MousePointerClick,
  SeparatorHorizontal,
  ShoppingBag,
  SquareStack,
  Text as TextIcon,
  Type,
  Images,
  Briefcase,
  type LucideIcon,
} from "lucide-react";
import type { ContentBlock, ContentBlockType } from "./types";

/**
 * Palette "İçerik" bölümü kaydı (§8.2/§8.3 mimar dokümanı — v3'te `container` BURAYA
 * EKLENMEZ, kendi ayrı kaydı `presets.ts::LAYOUT_PRESETS`'tedir; "Düzen" bölümü onu kullanır).
 */
export type PaletteBlockType = ContentBlockType;

/** Kategorize blok seçici (§Faz 0) — sıra, kullanıcının kategorilendirmesiyle BİREBİR aynı. */
export type PaletteBlockCategory = "basic" | "media" | "marketing" | "dynamic";

export const PALETTE_CATEGORIES: PaletteBlockCategory[] = ["basic", "media", "marketing", "dynamic"];

export const PALETTE_CATEGORY_LABEL: Record<PaletteBlockCategory, string> = {
  basic: "Temel Elemanlar",
  media: "Medya & İnteraktif",
  marketing: "Pazarlama & Sosyal Kanıt",
  dynamic: "Dinamik & CMS",
};

export const blockRegistry: Record<PaletteBlockType, { label: string; category: PaletteBlockCategory; icon: LucideIcon }> = {
  heading: { label: "Başlık", category: "basic", icon: HeadingIcon },
  text: { label: "Metin", category: "basic", icon: TextIcon },
  button: { label: "Buton", category: "basic", icon: MousePointerClick },
  "icon-box": { label: "İkon Kutusu", category: "basic", icon: SquareStack },
  divider: { label: "Ayırıcı & Boşluk", category: "basic", icon: SeparatorHorizontal },
  image: { label: "Görsel", category: "media", icon: ImageIcon },
  gallery: { label: "Galeri", category: "media", icon: Images },
  hero: { label: "Hero", category: "marketing", icon: LayoutTemplate },
  cta: { label: "Çağrı Butonu (CTA)", category: "marketing", icon: Type },
  "featured-products": { label: "Öne Çıkan Ürünler", category: "dynamic", icon: ShoppingBag },
  "featured-portfolio": { label: "Öne Çıkan Projeler", category: "dynamic", icon: Briefcase },
};

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export function createBlock(type: PaletteBlockType): ContentBlock {
  const id = newId();
  switch (type) {
    case "hero":
      return { id, type, data: { heading: "Başlık", subheading: "" } };
    case "text":
      return { id, type, data: { html: "<p>Metin girin…</p>" } };
    case "image":
      return { id, type, data: { url: "", alt: "" } };
    case "gallery":
      return { id, type, data: { images: [], layout: "grid" } };
    case "cta":
      return { id, type, data: { heading: "Harekete geçin", buttonLabel: "Tıklayın", buttonHref: "/" } };
    case "featured-products":
      return { id, type, data: { heading: "", limit: 4 } };
    case "featured-portfolio":
      return { id, type, data: { heading: "", limit: 4 } };
    case "heading":
      return { id, type, data: { text: "Başlık", level: 2, align: "left", underline: false } };
    case "button":
      return { id, type, data: { label: "Tıklayın", href: "/", style: "solid", size: "md", align: "left" } };
    case "icon-box":
      return { id, type, data: { icon: "Sparkles", heading: "Başlık", description: "" } };
    case "divider":
      return { id, type, data: { variant: "line", style: "solid", height: 32 } };
  }
}
