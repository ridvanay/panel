import type { HeroBlock } from "@/lib/page-builder/types";

export function HeroBlockView({ block }: { block: HeroBlock }) {
  return (
    <section className="px-4 py-16 text-center sm:px-6">
      <h1 className="text-4xl font-semibold text-foreground">{block.data.heading}</h1>
      {block.data.subheading && <p className="mt-3 text-lg text-foreground/60">{block.data.subheading}</p>}
    </section>
  );
}
