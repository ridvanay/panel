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
  return (
    <RichContentWithShortcodes
      html={block.data.html}
      locale={siteContext?.lang}
      className={cn(
        "prose",
        chrome === "page" ? "mx-auto max-w-3xl px-4 py-8 sm:px-6" : "max-w-none",
        ALIGN_CLASS[block.data.align ?? "left"] ?? ALIGN_CLASS.left
      )}
    />
  );
}
