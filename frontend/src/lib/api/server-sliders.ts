import { sliderCacheTag } from "../cache-tags";
import { fetchServerJson } from "./server-fetch";
import type { PublicSlider } from "../sliders/types";

/**
 * `advanced-slider` bloğunun sunucu bileşeni (`components/site/blocks/advanced-slider-block.tsx`)
 * bu ucu çağırır. Slug ile DEĞİL, `sliderId` (uuid) ile — blok `data.sliderId` tutar. Çöpteki/
 * bulunamayan slider → `404` → burada `null`'a düşer, blok public tarafta SESSİZCE hiçbir şey
 * render etmez (`server-portfolio.ts` deseniyle AYNI, bkz. architect §5.1/§6.2).
 */
export async function fetchSliderServer(sliderId: string, locale?: string): Promise<PublicSlider | null> {
  // Paket O — `?locale=`: slayta o dil için görsel tanımlıysa varsayılan görselin yerine o döner.
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  const json = await fetchServerJson<{ data: PublicSlider }>(`/sliders/${sliderId}${query}`, { tags: [sliderCacheTag(sliderId)] });
  return json?.data ?? null;
}
