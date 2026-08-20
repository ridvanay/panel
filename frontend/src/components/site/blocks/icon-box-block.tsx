import Link from "next/link";
import { cn } from "@/lib/utils";
import { resolveIcon } from "@/lib/page-builder/icon-options";
import type { BlockChrome, IconBoxBlock } from "@/lib/page-builder/types";

/** `button-block.tsx`deki AYNI `react-hooks/static-components` yanlış-pozitifi kaçınma deseni. */
function iconGlyph(name: string, className: string) {
  const Icon = resolveIcon(name);
  return <Icon className={className} aria-hidden />;
}

export function IconBoxBlockView({ block, chrome }: { block: IconBoxBlock; chrome: BlockChrome }) {
  const content = (
    <div className="space-y-3 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        {iconGlyph(block.data.icon, "h-6 w-6")}
      </span>
      <h3 className="text-lg font-semibold text-foreground">{block.data.heading}</h3>
      {block.data.description && <p className="text-sm text-foreground/70">{block.data.description}</p>}
    </div>
  );

  return (
    <section className={cn(chrome === "page" && "px-4 py-8 sm:px-6")}>
      {block.data.href ? (
        <Link href={block.data.href} className="block transition-opacity hover:opacity-80">
          {content}
        </Link>
      ) : (
        content
      )}
    </section>
  );
}
