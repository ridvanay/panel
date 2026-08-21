import { cn } from "@/lib/utils";
import type { BlockChrome, CustomHtmlBlock } from "@/lib/page-builder/types";

/**
 * `text-block.tsx` ile BİREBİR AYNI güvenlik deseni: `data.html` backend'de DB'ye yazılmadan
 * ÖNCE `lib/html-sanitize.ts::sanitizeCustomHtmlBlock` ile temizlenmiştir (bkz.
 * `modules/pages/lib/sanitize-blocks.ts`) — burada İKİNCİ bir sanitizasyon YAPILMAZ, tek
 * temizleme yoluna güvenilir (dosya başlığındaki "tek yazar" ilkesi).
 */
export function CustomHtmlBlockView({ block, chrome }: { block: CustomHtmlBlock; chrome: BlockChrome }) {
  return (
    <div
      className={cn(chrome === "page" && "px-4 py-8 sm:px-6")}
      dangerouslySetInnerHTML={{ __html: block.data.html }}
    />
  );
}
