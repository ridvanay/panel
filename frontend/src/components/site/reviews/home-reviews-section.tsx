import { fetchFeaturedReviewsServer } from "@/lib/api/server-telehealth";
import { HomeReviewsCarousel } from "@/components/site/reviews/home-reviews-carousel";

/**
 * Paket Y — anasayfa yorum bölümü (sunucu). Veri kaynaklı ve koşulludur: öne çıkan yorum yoksa (ya da uç
 * hata verirse) `null` döner ve bölüm HİÇ görünmez. Admin şablon şemasına alan eklenmez.
 */
export async function HomeReviewsSection({ lang, defaultLocaleCode }: { lang: string; defaultLocaleCode: string }) {
  const data = await fetchFeaturedReviewsServer(lang);
  if (!data || data.items.length === 0) return null;
  return <HomeReviewsCarousel data={data} lang={lang} defaultLocaleCode={defaultLocaleCode} />;
}
