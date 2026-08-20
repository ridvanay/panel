import { cn } from "@/lib/utils";
import type { BlockChrome, HeadingBlock } from "@/lib/page-builder/types";

const TAG_MAP = { 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const;

const SIZE_CLASS: Record<HeadingBlock["data"]["level"], string> = {
  1: "text-4xl font-bold sm:text-5xl",
  2: "text-3xl font-bold sm:text-4xl",
  3: "text-2xl font-semibold sm:text-3xl",
  4: "text-xl font-semibold sm:text-2xl",
  5: "text-lg font-semibold sm:text-xl",
  6: "text-base font-semibold sm:text-lg",
};

const ALIGN_CLASS: Record<HeadingBlock["data"]["align"], string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export function HeadingBlockView({ block, chrome }: { block: HeadingBlock; chrome: BlockChrome }) {
  const Tag = TAG_MAP[block.data.level];
  return (
    <section className={cn(chrome === "page" && "px-4 py-8 sm:px-6")}>
      <Tag className={cn(SIZE_CLASS[block.data.level], ALIGN_CLASS[block.data.align], "text-foreground")}>
        {block.data.underline ? (
          <span className="inline-block border-b-4 border-primary pb-1">{block.data.text}</span>
        ) : (
          block.data.text
        )}
      </Tag>
    </section>
  );
}
