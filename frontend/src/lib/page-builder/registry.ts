import {
  Heading as HeadingIcon,
  Image as ImageIcon,
  LayoutTemplate,
  ListCollapse,
  MousePointerClick,
  PanelsTopLeft,
  SeparatorHorizontal,
  ShoppingBag,
  SquareStack,
  Text as TextIcon,
  Type,
  Images,
  Briefcase,
  Video,
  TrendingUp,
  Quote,
  Tag,
  Newspaper,
  Mail,
  Code2,
  SplitSquareHorizontal,
  Infinity as InfinityIcon,
  SlidersHorizontal,
  Users2,
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
  video: { label: "Video Oynatıcı", category: "media", icon: Video },
  accordion: { label: "Akordiyon / SSS", category: "media", icon: ListCollapse },
  tabs: { label: "Sekmeler", category: "media", icon: PanelsTopLeft },
  "before-after-slider": { label: "Öncesi / Sonrası", category: "media", icon: SplitSquareHorizontal },
  hero: { label: "Hero", category: "marketing", icon: LayoutTemplate },
  cta: { label: "Çağrı Butonu (CTA)", category: "marketing", icon: Type },
  counter: { label: "Sayaç / İstatistik", category: "marketing", icon: TrendingUp },
  testimonial: { label: "Müşteri Yorumları", category: "marketing", icon: Quote },
  "pricing-table": { label: "Fiyatlandırma Tablosu", category: "marketing", icon: Tag },
  "logo-marquee": { label: "Logo Bandı", category: "marketing", icon: InfinityIcon },
  "skill-bar": { label: "İlerleme Çubuğu & Yetenekler", category: "marketing", icon: SlidersHorizontal },
  team: { label: "Ekip Üyesi Kartı", category: "marketing", icon: Users2 },
  "featured-products": { label: "Öne Çıkan Ürünler", category: "dynamic", icon: ShoppingBag },
  "featured-portfolio": { label: "Öne Çıkan Projeler", category: "dynamic", icon: Briefcase },
  "latest-posts": { label: "Son Blog Yazıları", category: "dynamic", icon: Newspaper },
  "contact-form": { label: "İletişim Formu", category: "dynamic", icon: Mail },
  "custom-html": { label: "Özel HTML / Kod", category: "dynamic", icon: Code2 },
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
      // BOŞ bırakılır — `TextBlockEditor` bunu `PostEditor`'a verir, `PostEditor`'daki
      // `@tiptap/extension-placeholder` (bkz. post-editor.tsx) YALNIZCA içerik boşken tetiklenir.
      // Önceden buraya gerçek metin ("<p>Metin girin…</p>") basılıyordu — bu placeholder'ı
      // TAMAMEN devre dışı bırakıyordu (editör hep "12 karakter" gösteriyordu, kullanıcı elle
      // silmek zorunda kalıyordu). Gerçek placeholder metni artık text-block.tsx'ten prop olarak
      // geçiliyor.
      return { id, type, data: { html: "" } };
    case "image":
      return { id, type, data: { url: "", alt: "", caption: "", radius: "none", lightbox: false } };
    case "gallery":
      return { id, type, data: { images: [], layout: "grid" } };
    case "cta":
      // MEVCUT DAVRANIŞ KORUNUR: `align: "center"` + `style: "plain"` bugünkü render'ın BİREBİR
      // aynısıdır. `secondaryButtonLabel`/`secondaryButtonHref` KASITLI OLARAK hiç eklenmez
      // (undefined) — `href` alanı backend'de `SafeHrefSchema` (`.min(1)`) ile doğrulanır, boş
      // string ("") GEÇERSİZDİR ve varsayılan blok anında kaydedilince 422 üretirdi (bkz.
      // `IconBoxBlockEditor`'ın opsiyonel `href`'i OMİT eden AYNI desen).
      return {
        id,
        type,
        data: {
          heading: "Harekete geçin",
          buttonLabel: "Tıklayın",
          buttonHref: "/",
          description: "",
          align: "center",
          style: "plain",
        },
      };
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
    case "video":
      return { id, type, data: { provider: "youtube", url: "", autoplay: false, muted: false } };
    case "accordion":
      return {
        id,
        type,
        data: {
          allowMultipleOpen: false,
          items: [{ id: newId(), question: "Soru", answer: "" }],
        },
      };
    case "tabs":
      return {
        id,
        type,
        data: {
          orientation: "horizontal",
          items: [
            { id: newId(), label: "Sekme 1", content: "" },
            { id: newId(), label: "Sekme 2", content: "" },
          ],
        },
      };
    case "counter":
      return {
        id,
        type,
        data: {
          items: [
            { id: newId(), value: 500, suffix: "+", label: "Mutlu Müşteri" },
            { id: newId(), value: 98, prefix: "%", label: "Memnuniyet" },
            { id: newId(), value: 10, suffix: "+", label: "Yıllık Deneyim" },
          ],
        },
      };
    case "testimonial":
      // `quote`/`authorName` backend'de ZORUNLU (`.min(1)`) — `AccordionBlockEditor`'ın "Soru"
      // varsayılanıyla AYNI gerekçe, boş bırakılırsa varsayılan blok anında kaydedilince 422
      // üretir. `authorRole`/`avatarUrl` OPSİYONEL — `""` DEĞİL, hiç eklenmez (undefined) —
      // `avatarUrl` `SafeHrefSchema` ile doğrulanır, boş string GEÇERSİZDİR (bkz. `cta` case'i).
      return {
        id,
        type,
        data: {
          items: [{ id: newId(), quote: "Yorum metnini buraya yazın…", authorName: "Ad Soyad", rating: 5 }],
        },
      };
    case "pricing-table":
      return {
        id,
        type,
        data: {
          plans: [
            {
              id: newId(),
              name: "Başlangıç",
              price: "₺299",
              period: "/ay",
              description: "",
              features: ["Özellik 1", "Özellik 2"],
              highlighted: false,
              buttonLabel: "Satın Al",
              buttonHref: "/",
            },
            {
              id: newId(),
              name: "Profesyonel",
              price: "₺599",
              period: "/ay",
              description: "",
              features: ["Özellik 1", "Özellik 2", "Özellik 3"],
              highlighted: true,
              buttonLabel: "Satın Al",
              buttonHref: "/",
            },
          ],
        },
      };
    case "latest-posts":
      return { id, type, data: { heading: "Son Yazılar", limit: 3 } };
    case "contact-form":
      return { id, type, data: { showTitle: true } };
    case "custom-html":
      return { id, type, data: { html: "" } };
    case "before-after-slider":
      return {
        id,
        type,
        data: { beforeUrl: "", afterUrl: "", beforeLabel: "Önce", afterLabel: "Sonra", orientation: "horizontal" },
      };
    case "logo-marquee":
      return { id, type, data: { items: [], speedSeconds: 30, pauseOnHover: true } };
    case "skill-bar":
      return {
        id,
        type,
        data: {
          items: [
            { id: newId(), label: "Yetenek 1", percent: 80 },
            { id: newId(), label: "Yetenek 2", percent: 60 },
          ],
        },
      };
    case "team":
      return {
        id,
        type,
        data: {
          members: [{ id: newId(), name: "Ad Soyad", role: "Unvan", socialLinks: [] }],
        },
      };
  }
}
