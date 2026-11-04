import { cn } from "@/lib/utils";
import type { BlockChrome, CounterBlock } from "@/lib/page-builder/types";
import { metricValue } from "@/lib/page-builder/counter-metrics";
import type { BlockSiteContext } from "./index";

/** Binlik ayracı biçimlendirmesi TEK bir yerde — kullanıcı ayracı elle kurgulamaz
 *  (bkz. `types.ts::CounterItem.value` yorumu). */
const numberFormatter = new Intl.NumberFormat("tr-TR");

function gridColsClass(count: number): string {
  if (count <= 2) return "grid-cols-1 sm:grid-cols-2";
  if (count === 3) return "grid-cols-1 sm:grid-cols-3";
  return "grid-cols-2 md:grid-cols-4";
}

export function CounterBlockView({ block, chrome, siteContext }: { block: CounterBlock; chrome: BlockChrome; siteContext?: BlockSiteContext }) {
  // Paket AK (K2) — `metric` varsa değer canlı veriden gelir; alınamazsa (null/0/hata) öğe GÖSTERİLMEZ.
  // `metric` yoksa elle yazılan değer aynen kullanılır (bugünkü davranış).
  const items = block.data.items.flatMap((item) => {
    if (!item.metric) return [{ item, value: item.value }];
    const live = metricValue(siteContext?.metrics, item.metric);
    return live === null ? [] : [{ item, value: live }];
  });
  if (items.length === 0) return null;

  return (
    <section className={cn(chrome === "page" && "px-4 py-12 sm:px-6")}>
      <div className={cn("mx-auto grid max-w-4xl gap-8 text-center", gridColsClass(items.length))}>
        {items.map(({ item, value }) => (
          <div key={item.id}>
            <p className="text-4xl font-bold text-primary">
              {item.prefix}
              {numberFormatter.format(value)}
              {item.suffix}
            </p>
            <p className="mt-1 text-sm text-foreground/70">{item.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
