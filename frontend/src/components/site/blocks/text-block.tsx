import { cn } from "@/lib/utils";
import type { BlockChrome, TextBlock } from "@/lib/page-builder/types";

export function TextBlockView({ block, chrome }: { block: TextBlock; chrome: BlockChrome }) {
  return (
    <div
      className={cn("prose", chrome === "page" ? "mx-auto max-w-3xl px-4 py-8 sm:px-6" : "max-w-none")}
      dangerouslySetInnerHTML={{ __html: block.data.html }}
    />
  );
}
