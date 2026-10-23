import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ContentCounts } from "@/lib/api/types";
import type { ContentListFilter } from "./types";

interface ContentListTabsProps {
  value: ContentListFilter;
  onValueChange: (value: ContentListFilter) => void;
  counts: ContentCounts;
}

/**
 * WP-tarzı filtre sekmeleri (Tümü/Yayınlanmış/Taslak/Çöp). Yalnızca filtre state'i
 * taşır — `TabsContent` render ETMEZ, gerçek liste çağıran tarafta render edilir.
 * Sayaçlar her zaman `meta.counts`'tan gelir, client-side hesaplanmaz.
 */
export function ContentListTabs({ value, onValueChange, counts }: ContentListTabsProps) {
  return (
    <Tabs value={value} onValueChange={(v) => onValueChange(v as ContentListFilter)}>
      <TabsList variant="line" className="h-auto max-w-full flex-wrap justify-start gap-1">
        <TabsTrigger className="h-7 flex-none px-2" value="all">
          Tümü <span className="ml-1 tabular-nums text-foreground/70">({counts.all})</span>
        </TabsTrigger>
        <TabsTrigger className="h-7 flex-none px-2" value="published">
          Yayında <span className="ml-1 tabular-nums text-foreground/70">({counts.published})</span>
        </TabsTrigger>
        <TabsTrigger className="h-7 flex-none px-2" value="draft">
          Taslak <span className="ml-1 tabular-nums text-foreground/70">({counts.draft})</span>
        </TabsTrigger>
        <TabsTrigger className="h-7 flex-none px-2" value="trashed">
          Çöp <span className="ml-1 tabular-nums text-foreground/70">({counts.trashed})</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
