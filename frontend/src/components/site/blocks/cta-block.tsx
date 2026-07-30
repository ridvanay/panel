import { LinkButton } from "@/components/ui/link-button";
import type { CtaBlock } from "@/lib/page-builder/types";

export function CtaBlockView({ block }: { block: CtaBlock }) {
  return (
    <section className="px-4 py-16 text-center sm:px-6">
      <h2 className="text-2xl font-semibold text-foreground">{block.data.heading}</h2>
      <LinkButton href={block.data.buttonHref} className="mt-4 inline-flex">
        {block.data.buttonLabel}
      </LinkButton>
    </section>
  );
}
