import { cn } from "@/lib/utils";
import { resolveColumnWidth } from "@/lib/page-builder/columns";
import type { ColumnsBlock, PageBlockGap, PageColumnVerticalAlign } from "@/lib/page-builder/types";
import { BlockRenderer } from "./index";

/** §10.16/§10.17'deki AYNI 0/8/16/32 boşluk ölçeği (bkz. design-notes). */
const GAP_CLASS: Record<PageBlockGap, string> = { none: "gap-0", sm: "gap-2", md: "gap-4", lg: "gap-8" };
const ALIGN_CLASS: Record<PageColumnVerticalAlign, string> = { top: "items-start", center: "items-center", bottom: "items-end" };

/**
 * §10.17.5 v2 — mimar kararı: tek bir kırılma noktası (`md` = 768px). `flex-col` tabanı
 * sayesinde mobilde sütunlar (sayıları ne olursa olsun) otomatik alt alta düşer; `md:` üzerinde
 * `display:grid`e geçilir ve her sütunun göreli genişlik ağırlığı (`width`, varsayılan 1) inline
 * `gridTemplateColumns` (`fr` birimi) ile uygulanır. Bu, editör önizlemesiyle (bkz.
 * components/admin/page-builder/builder-canvas.tsx::ColumnsContainerCard) BİREBİR aynı mantıktır
 * (WYSIWYG) — editördeki tek fark, orada ayrıca EDİTÖRE özgü bir "+" ekleme alanı bulunmasıdır.
 *
 * Eski (v1, sabit `columnCount`/`ratio`) şeklinde kaydedilmiş bir sayfa hâlâ DB'de olabilir —
 * bu alan bir sonraki kayıtta backend tarafından yeni şekle çevrilir (bkz.
 * backend/src/modules/pages/pages.schemas.ts), ama GET yanıtı ARA DÖNEMDE eski şekli
 * döndürebilir (yeniden doğrulanmadan geçer). `resolveColumnWidth` bu durumda `ratio`'yu
 * `width`'e çevirir ki eski bir sayfa dokunulmadan görüntülendiğinde orijinal görsel oran
 * SESSİZCE BOZULMASIN (bkz. columns.ts başlık yorumu).
 */
export function ColumnsBlockView({ block }: { block: ColumnsBlock }) {
  const { gap, verticalAlign, columns } = block.data;
  const template = columns.map((_, i) => `${resolveColumnWidth(block.data, i)}fr`).join(" ");

  return (
    <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
      <div
        className={cn("flex flex-col md:grid", GAP_CLASS[gap], ALIGN_CLASS[verticalAlign])}
        style={{ gridTemplateColumns: template }}
      >
        {columns.map((column) => (
          <div key={column.id} className="min-w-0">
            <BlockRenderer blocks={column.blocks} />
          </div>
        ))}
      </div>
    </div>
  );
}
