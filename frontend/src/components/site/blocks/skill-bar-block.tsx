import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { BlockChrome, SkillBarBlock } from "@/lib/page-builder/types";

/** `globals.css::pb-skillbar-fill` — animasyonlu dolma efekti (saf CSS, JS YOK). `color`
 *  verilmezse site temasının `--site-primary`si kullanılır (bkz. `types.ts::SkillBarItem`). */
export function SkillBarBlockView({ block, chrome }: { block: SkillBarBlock; chrome: BlockChrome }) {
  const items = block.data.items;

  return (
    <section className={cn(chrome === "page" && "px-4 py-8 sm:px-6")}>
      <div className="mx-auto max-w-2xl space-y-5">
        {items.map((item) => (
          <div key={item.id}>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="font-medium text-foreground">{item.label}</span>
              <span className="text-foreground/60">%{item.percent}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={item.percent} aria-valuemin={0} aria-valuemax={100} aria-label={item.label}>
              <div
                className="pb-skillbar-fill h-full rounded-full"
                style={{ "--pb-skill-percent": `${item.percent}%`, backgroundColor: item.color ?? "var(--site-primary)" } as CSSProperties}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
