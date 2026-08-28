import { fetchSliderServer } from "@/lib/api/server-sliders";
import { AdvancedSlider } from "@/components/site/advanced-slider/advanced-slider";
import type { AdvancedSliderBlock, BlockChrome } from "@/lib/page-builder/types";

/**
 * §6.2/§6.4 architect — `data.sliderId` yoksa VEYA slider bulunamıyorsa/silinmişse SESSİZCE
 * `null` (public sayfa asla hata vermez). `chrome` KASITLI OLARAK kullanılmaz — slider her zaman
 * kenardan kenara (full-bleed) bir "hero" yüzeyidir, `hero-block.tsx`teki `chrome==="page"` dolgusu
 * BURADA anlamsızdır (WYSIWYG sitelerin hero alanı sayfa gutter'ına tabi DEĞİLDİR).
 */
export async function AdvancedSliderBlockView({ block }: { block: AdvancedSliderBlock; chrome: BlockChrome }) {
  if (!block.data.sliderId) return null;

  const slider = await fetchSliderServer(block.data.sliderId);
  if (!slider || slider.slides.length === 0) return null;

  return <AdvancedSlider slider={slider} />;
}
