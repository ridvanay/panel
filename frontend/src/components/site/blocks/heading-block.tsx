import { cn } from "@/lib/utils";
import type { BlockChrome, HeadingBlock } from "@/lib/page-builder/types";
import { linkAttrs } from "@/lib/page-builder/link-attrs";

const TAG_MAP = { 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const;

const SIZE_CLASS: Record<HeadingBlock["data"]["level"], string> = {
  1: "font-heading text-3xl font-bold leading-tight sm:text-4xl",
  2: "font-heading text-2xl font-semibold leading-tight sm:text-3xl",
  3: "font-heading text-xl font-semibold leading-snug sm:text-2xl",
  4: "font-heading text-lg font-semibold sm:text-xl",
  5: "text-lg font-semibold sm:text-xl",
  6: "text-base font-semibold sm:text-lg",
};

const ALIGN_CLASS: Record<HeadingBlock["data"]["align"], string> = {
  left: "text-start",
  center: "text-center",
  right: "text-end",
};

export function HeadingBlockView({ block, chrome }: { block: HeadingBlock; chrome: BlockChrome }) {
  const Tag = TAG_MAP[block.data.level];
  const text = block.data.underline ? <span className="inline-block border-b-4 border-primary pb-1">{block.data.text}</span> : block.data.text;
  return (
    <section className={cn(chrome === "page" && "px-4 pt-8 pb-2 sm:px-6")}>
      {/* Paket Z1-ek - sayfa kromunda baslik, metin blogu ile AYNI kolonda (max-w-3xl) hizalanir. */}
      <div className={cn(chrome === "page" && "mx-auto max-w-3xl")}>
        <Tag className={cn(SIZE_CLASS[block.data.level], ALIGN_CLASS[block.data.align], "text-foreground")}>
          {block.data.href ? (
            <a {...linkAttrs(block.data.href)} className="transition-colors hover:text-primary">
              {text}
            </a>
          ) : (
            text
          )}
        </Tag>
      </div>
    </section>
  );
}
