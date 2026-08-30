import { cn } from "@/lib/utils";
import type { BlockChrome, CustomHtmlBlock } from "@/lib/page-builder/types";
import { RichContentWithShortcodes } from "./rich-content-with-shortcodes";

/**
 * `text-block.tsx` ile BİREBİR AYNI güvenlik deseni: `data.html` backend'de DB'ye yazılmadan
 * ÖNCE `lib/html-sanitize.ts::sanitizeCustomHtmlBlock` ile temizlenmiştir (bkz.
 * `modules/pages/lib/sanitize-blocks.ts`) — burada İKİNCİ bir sanitizasyon YAPILMAZ, tek
 * temizleme yoluna güvenilir (dosya başlığındaki "tek yazar" ilkesi). `[slider id="…"]` kısa
 * kod ayrıştırması (`splitSliderShortcodes`, bkz. architect §9.2.3) SANİTİZASYON DEĞİLDİR —
 * salt sanitize edilmiş çıktıyı bölen bir işlemdir, ikinci bir sanitizasyon yolu AÇMAZ.
 */
export function CustomHtmlBlockView({ block, chrome }: { block: CustomHtmlBlock; chrome: BlockChrome }) {
  return <RichContentWithShortcodes html={block.data.html} className={cn(chrome === "page" && "px-4 py-8 sm:px-6")} />;
}
