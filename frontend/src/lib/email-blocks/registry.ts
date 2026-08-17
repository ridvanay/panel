import {
  Heading,
  ImageIcon,
  MousePointerClick,
  PanelBottom,
  PanelTop,
  SeparatorHorizontal,
  Text,
  type LucideIcon,
} from "lucide-react";
import type { EmailBlock, EmailBlockType } from "@/lib/api/types";

/** design-notes-email-editor-and-grid.md §A.1 — blok tipi → ikon/etiket eşlemesi (tek kaynak). */
export const emailBlockRegistry: Record<EmailBlockType, { label: string; icon: LucideIcon }> = {
  "logo-header": { label: "Logo / Üst Bilgi", icon: PanelTop },
  heading: { label: "Başlık", icon: Heading },
  text: { label: "Metin", icon: Text },
  button: { label: "Buton / CTA", icon: MousePointerClick },
  image: { label: "Görsel", icon: ImageIcon },
  divider: { label: "Ayırıcı", icon: SeparatorHorizontal },
  footer: { label: "Footer", icon: PanelBottom },
};

export const EMAIL_BLOCK_TYPES: EmailBlockType[] = [
  "logo-header",
  "heading",
  "text",
  "button",
  "image",
  "divider",
  "footer",
];

export function newEmailBlockId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

const DEFAULT_STYLE = {
  align: "left" as const,
  backgroundColor: null,
  textColor: null,
  paddingY: "md" as const,
  paddingX: "md" as const,
};

export function createEmailBlock(type: EmailBlockType): EmailBlock {
  const id = newEmailBlockId();
  const style = { ...DEFAULT_STYLE };
  switch (type) {
    case "logo-header":
      return { id, type, style, data: { useSiteLogo: true, logoUrl: null, height: 40 } };
    case "heading":
      return { id, type, style, data: { text: "Başlık", level: 2 } };
    case "text":
      return { id, type, style, data: { html: "<p>Metin girin…</p>" } };
    case "button":
      return {
        id,
        type,
        style,
        data: { label: "Tıklayın", href: "https://", backgroundColor: null, textColor: null, radius: "sm" },
      };
    case "image":
      return { id, type, style, data: { mediaId: null, url: "", alt: "", width: null } };
    case "divider":
      return { id, type, style, data: { thickness: 1, color: null } };
    case "footer":
      return { id, type, style, data: { text: "" } };
  }
}

export const EMAIL_BLOCK_SPACING_PX: Record<"none" | "sm" | "md" | "lg", number> = {
  none: 0,
  sm: 8,
  md: 16,
  lg: 32,
};
