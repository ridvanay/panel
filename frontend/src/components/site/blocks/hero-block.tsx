import { cn } from "@/lib/utils";
import type { BlockChrome, HeroBlock } from "@/lib/page-builder/types";

export function HeroBlockView({ block, chrome }: { block: HeroBlock; chrome: BlockChrome }) {
  return (
    <section className={cn("text-center", chrome === "page" && "px-4 py-16 sm:px-6")}>
      <h1 className="text-4xl font-semibold text-foreground">{block.data.heading}</h1>
      {block.data.subheading && <p className="mt-3 text-lg text-foreground/60">{block.data.subheading}</p>}
    </section>
  );
}
