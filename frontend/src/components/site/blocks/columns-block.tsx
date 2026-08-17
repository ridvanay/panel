import { cn } from "@/lib/utils";
import type { ColumnsBlock, PageBlockGap, PageColumnVerticalAlign } from "@/lib/page-builder/types";
import { BlockRenderer } from "./index";

/**
 * §10.17.5 — mimar kararı: tek bir kırılma noktası (`md` = 768px), sınıf iskeleti editör
 * önizlemesiyle (bkz. components/admin/page-builder/builder-canvas.tsx) BİREBİR aynı olmalıdır
 * (WYSIWYG). `grid-cols-1` tabanı sayesinde mobilde sütunlar otomatik alt alta düşer.
 */
function gridClasses(block: ColumnsBlock): string {
  const { columnCount, ratio } = block.data;
  if (columnCount === 3) return "grid grid-cols-1 md:grid-cols-3";
  if (ratio === "2-1" || ratio === "1-2") return "grid grid-cols-1 md:grid-cols-3";
  return "grid grid-cols-1 md:grid-cols-2";
}

/** §10.16/§10.17'deki AYNI 0/8/16/32 boşluk ölçeği (bkz. design-notes). */
const GAP_CLASS: Record<PageBlockGap, string> = { none: "gap-0", sm: "gap-2", md: "gap-4", lg: "gap-8" };
const ALIGN_CLASS: Record<PageColumnVerticalAlign, string> = { top: "items-start", center: "items-center", bottom: "items-end" };

export function ColumnsBlockView({ block }: { block: ColumnsBlock }) {
  const { ratio, gap, verticalAlign, columns } = block.data;

  return (
    <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
      <div className={cn(gridClasses(block), GAP_CLASS[gap], ALIGN_CLASS[verticalAlign])}>
        {columns.map((column, index) => {
          const spanFirst = ratio === "2-1" && index === 0;
          const spanSecond = ratio === "1-2" && index === 1;
          return (
            <div key={column.id} className={cn("min-w-0", (spanFirst || spanSecond) && "md:col-span-2")}>
              <BlockRenderer blocks={column.blocks} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
