import { fetchSliderServer } from "@/lib/api/server-sliders";
import { AdvancedSlider } from "@/components/site/advanced-slider/advanced-slider";
import type { AdvancedSliderBlock, BlockChrome } from "@/lib/page-builder/types";

/**
 * §6.2/§6.4 architect — `data.sliderId` yoksa VEYA slider bulunamıyorsa/silinmişse SESSİZCE
 * `null` (public sayfa asla hata vermez). `chrome` artık GERÇEKTEN kullanılır (bkz. §9.1.3
 * matrisi): `AdvancedSlider`'a olduğu gibi geçirilir, sarmalayıcı kararı (yalnızca
 * `widthMode: "boxed"` + `chrome: "page"` iken bir boxed konteyner) bileşenin İÇİNDE verilir —
 * bu bileşen üç yerden tüketildiği için (bu blok, Hero Studio önizlemesi, kısa kod render'ı)
 * sarmalayıcıyı çağıranlara dağıtmak kopya üretirdi.
 */
export async function AdvancedSliderBlockView({ block, chrome }: { block: AdvancedSliderBlock; chrome: BlockChrome }) {
  if (!block.data.sliderId) return null;

  const slider = await fetchSliderServer(block.data.sliderId);
  if (!slider || slider.slides.length === 0) return null;

  return <AdvancedSlider slider={slider} chrome={chrome} />;
}
