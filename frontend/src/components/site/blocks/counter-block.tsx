import { cn } from "@/lib/utils";
import type { BlockChrome, CounterBlock } from "@/lib/page-builder/types";

/** Binlik ayracı biçimlendirmesi TEK bir yerde — kullanıcı ayracı elle kurgulamaz
 *  (bkz. `types.ts::CounterItem.value` yorumu). */
const numberFormatter = new Intl.NumberFormat("tr-TR");

function gridColsClass(count: number): string {
  if (count <= 2) return "grid-cols-1 sm:grid-cols-2";
  if (count === 3) return "grid-cols-1 sm:grid-cols-3";
  return "grid-cols-2 md:grid-cols-4";
}

export function CounterBlockView({ block, chrome }: { block: CounterBlock; chrome: BlockChrome }) {
  const items = block.data.items;

  return (
    <section className={cn(chrome === "page" && "px-4 py-12 sm:px-6")}>
      <div className={cn("mx-auto grid max-w-4xl gap-8 text-center", gridColsClass(items.length))}>
        {items.map((item) => (
          <div key={item.id}>
            <p className="text-4xl font-bold text-primary">
              {item.prefix}
              {numberFormatter.format(item.value)}
              {item.suffix}
            </p>
            <p className="mt-1 text-sm text-foreground/70">{item.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
