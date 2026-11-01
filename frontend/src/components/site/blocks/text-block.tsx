import { cn } from "@/lib/utils";
import type { BlockChrome, TextAlign, TextBlock } from "@/lib/page-builder/types";
import { RichContentWithShortcodes } from "./rich-content-with-shortcodes";
import type { BlockSiteContext } from "./index";

const ALIGN_CLASS: Record<TextAlign, string> = {
  left: "text-start",
  center: "text-center",
  right: "text-end",
};

export function TextBlockView({ block, chrome, siteContext }: { block: TextBlock; chrome: BlockChrome; siteContext?: BlockSiteContext }) {
  // Paket Z1-ek - `@tailwindcss/typography` projede yok (`prose` etkisizdi): zengin metin `.blog-prose` tipografisini
  // alir (baslik olcegi, aralik, liste/tablo); CMS varyanti kolon genisligini sarmalayici belirler.
  const body = (
    <RichContentWithShortcodes
      html={block.data.html}
      locale={siteContext?.lang}
      className={cn("blog-prose blog-prose--fill", ALIGN_CLASS[block.data.align ?? "left"] ?? ALIGN_CLASS.left)}
    />
  );
  if (chrome !== "page") return body;
  return <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">{body}</div>;
}
