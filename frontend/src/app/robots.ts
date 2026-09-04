import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/env";

/**
 * `/products` facet/sayfalama sorgu dizeleri (`?minPrice=`, `?category=`, `?page=2` vb.)
 * KASITLI OLARAK burada `disallow` EDİLMEZ — `.claude/architect-scope-products-catalog.md` §5.6
 * kararı `robots: noindex, follow` meta etiketiyle uygulanıyor (`products/page.tsx::generateMetadata`).
 * Google'ın kendi rehberi: `robots.txt` ile engellenen bir URL TARANAMAZ, dolayısıyla
 * içindeki `noindex` meta etiketi de HİÇ görülmez — link başka yerden keşfedilirse Google URL'i
 * yine de (snippet'siz) indeksleyebilir. Doğru sıralama: TARAMAYA izin ver, `noindex` etiketiyle
 * indekslemeyi engelle. İkisini birden (disallow + noindex) kullanmak SEO açısından ÇELİŞKİLİDİR.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/dashboard"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
