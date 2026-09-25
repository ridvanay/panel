import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/env";
import { FALLBACK_LOCALES, fetchLocalesServer } from "@/lib/api/server-locales";
import { withBuildTimeFallback } from "@/lib/api/server-fetch";
import { withLocalePrefix } from "@/lib/i18n/site-path";

/**
 * `/products` facet/sayfalama sorgu dizeleri (`?minPrice=`, `?category=`, `?page=2` vb.)
 * KASITLI OLARAK burada `disallow` EDİLMEZ — `.claude/architect-scope-products-catalog.md` §5.6
 * kararı `robots: noindex, follow` meta etiketiyle uygulanıyor (`products/page.tsx::generateMetadata`).
 * Google'ın kendi rehberi: `robots.txt` ile engellenen bir URL TARANAMAZ, dolayısıyla
 * içindeki `noindex` meta etiketi de HİÇ görülmez — link başka yerden keşfedilirse Google URL'i
 * yine de (snippet'siz) indeksleyebilir. Doğru sıralama: TARAMAYA izin ver, `noindex` etiketiyle
 * indekslemeyi engelle. İkisini birden (disallow + noindex) kullanmak SEO açısından ÇELİŞKİLİDİR.
 *
 * Görev (2026-09-16) — `/patient/*` (hasta portalı, `(site)/patient/**`) ve `/doctor/*` (hekim
 * konsolu, `(doctor)/doctor/**`) kimlik doğrulamalı, PII taşıyan panellerdir; herkese açık arama
 * indeksine girmemeli. `disallow: "/doctor/"` (SONUNDA `/`) KASITLIDIR — `disallow: "/doctor"`
 * (eğik çizgisiz) `/doctors` (public doktor ızgarası) ile AYNI ön ekten başlayacağı için onu da
 * YANLIŞLIKLA bloklardı; robots.txt eşleşmesi düz ÖN EK karşılaştırmasıdır, `/doctor/` 8. karakterde
 * (`/`) `/doctors`'un 8. karakteriyle (`s`) uyuşmadığından `/doctors*` HİÇ etkilenmez.
 *
 * `next/dist/docs/.../file-conventions/01-metadata/robots.md` `Robots` tipi `disallow`i düz
 * `string | string[]` olarak tanımlıyor — Next'e özgü bir "glob"/wildcard desteği YOK (bu saf bir
 * metin alanı, Next onu olduğu gibi robots.txt'ye yazar). `*` joker karaktere büyük tarayıcıların
 * (Google/Bing) kendi robots.txt yorumlayıcı UZANTISI olarak destek vermesi bu tipin bir garantisi
 * DEĞİL — bu yüzden EN GÜVENİLİR yol (tüm tarayıcılarla uyumlu) her aktif locale için AYRI, düz
 * bir `disallow` satırı ÜRETMEKTİR (`GET /locales`'ten dinamik, sabit bir dil listesi KODA
 * GÖMÜLMEZ — `.claude/architect-scope-i18n.md` §4.3 ile AYNI ilke). Varsayılan dilin kendisi zaten
 * prefix'siz `/patient/`/`/doctor/` satırlarıyla kapsanır, döngüde TEKRAR EDİLMEZ.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const locales = await withBuildTimeFallback(() => fetchLocalesServer(), FALLBACK_LOCALES);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? locales[0]?.code ?? "tr";

  const disallow = ["/admin", "/dashboard", "/patient/", "/doctor/"];
  for (const locale of locales) {
    if (!locale.enabled || locale.code === defaultLocaleCode) continue;
    disallow.push(withLocalePrefix("/patient/", locale.code, defaultLocaleCode));
    disallow.push(withLocalePrefix("/doctor/", locale.code, defaultLocaleCode));
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow,
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
