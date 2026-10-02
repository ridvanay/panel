import { HomeJourney } from "@/components/site/home/home-journey";
import { homeStrings as enHomeStrings } from "@/lib/i18n/site-dictionaries/en/home";
import { homeStrings as trHomeStrings } from "@/lib/i18n/site-dictionaries/tr/home";
import type { JourneyMapBlock } from "@/lib/page-builder/types";
import type { BlockSiteContext } from "./index";

/**
 * Page-builder sarmalayıcısı — görsel/animasyon kodu `home-journey.tsx::HomeJourney`'DE TEKTİR
 * (`home-page` şablonunun sabit bölümüyle PAYLAŞILIR, kopyalanmaz). `stepLabel`/`istanbulLabel`
 * sabit UI metinleri `specialty-cards-block.tsx` İLE AYNI desenle `siteContext.lang`'a göre
 * EN/TR sözlüğünden seçilir (yeni bir çeviri YAZILMAZ, var olan `home` sözlüğü yeniden kullanılır).
 */
export function JourneyMapBlockView({ block, siteContext }: { block: JourneyMapBlock; siteContext?: BlockSiteContext }) {
  const dict = siteContext?.lang === "tr" ? trHomeStrings : siteContext?.defaultLocaleCode === "tr" ? trHomeStrings : enHomeStrings;
  return <HomeJourney journey={block.data} stepLabel={dict.stepLabel} istanbulLabel={dict.journeyIstanbulLabel} />;
}
