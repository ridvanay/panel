import { SERVER_API_BASE_URL } from "../env";
import type { PublicSlider } from "../sliders/types";

/**
 * `advanced-slider` bloğunun sunucu bileşeni (`components/site/blocks/advanced-slider-block.tsx`)
 * bu ucu çağırır. Slug ile DEĞİL, `sliderId` (uuid) ile — blok `data.sliderId` tutar. Çöpteki/
 * bulunamayan slider → `404` → burada `null`'a düşer, blok public tarafta SESSİZCE hiçbir şey
 * render etmez (`server-portfolio.ts` deseniyle AYNI, bkz. architect §5.1/§6.2).
 */
export async function fetchSliderServer(sliderId: string): Promise<PublicSlider | null> {
  try {
    const res = await fetch(`${SERVER_API_BASE_URL}/sliders/${sliderId}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: PublicSlider };
    return json.data;
  } catch {
    return null;
  }
}
