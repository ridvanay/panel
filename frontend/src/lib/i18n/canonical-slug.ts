import { permanentRedirect } from "next/navigation";
import { withLocalePrefix } from "./site-path";
import type { ContentLocalization, Locale } from "@/lib/api/types";

/**
 * `.claude/architect-scope-i18n.md` §12.2 — bir istek, o dilin KENDİ (güzel) slug'ından FARKLI
 * bir slug ile gelirse (ör. `/en/<TR-kanonik-slug>` — backend'in `ContentSlug` fallback zinciri
 * içeriği YİNE DE bulur, bkz. `/pages/{slug}` açıklaması: "(1) ContentSlug(locale,slug) tam
 * eşleşme, (2) varsayılan dildeki kanonik slug"), içerik doğru gösterilir AMA URL o dilin kendi
 * slug'ı DEĞİLSE aynı içerik iki farklı URL'de (duplicate content, SEO riski) erişilebilir kalır.
 * Bu, `/tr/...` → `/...` prefix kuralıyla AYNI ailedendir (§4), yalnızca slug düzeyinde.
 *
 * Next.js Server Component'lerden yalnızca `redirect()` (307) veya `permanentRedirect()` (308)
 * üretilebilir — ham 301 YOKTUR (bkz. `node_modules/next/dist/docs/.../functions/redirect.md`:
 * "If you'd like to return a 308 (Permanent) HTTP redirect instead of 307 (Temporary)..."). 308,
 * 301'in metodu koruyan modern eşdeğeridir ve arama motorları tarafından AYNI şekilde "kalıcı
 * yönlendirme" sinyali olarak yorumlanır — bu proxy.ts'teki `NextResponse.redirect(url, 301)`
 * ile AYNI NİYETİ taşır, yalnızca üretim katmanı (proxy vs. sayfa bileşeni) farklı olduğu için
 * kullanılabilir status kodu farklıdır.
 *
 * Bu fonksiyon proxy'de DEĞİL sayfa bileşeninde çağrılır çünkü "bu dildeki doğru slug nedir?"
 * sorusu içerik verisine (`localizations`) bağlıdır — proxy katmanı bunu bilmez (§4.3'teki
 * prefix kuralının aksine, o tamamen slug'dan bağımsızdır).
 */
export function redirectToCanonicalSlug(options: {
  requestedSlug: string;
  activeLocale: string;
  localizations: ContentLocalization[];
  locales: Locale[];
  /** İçerik türünün URL öneki (`""` Page, `"/blog"`, `"/products"`, `"/portfolio"`). */
  pathPrefix: string;
}): void {
  const { requestedSlug, activeLocale, localizations, locales, pathPrefix } = options;
  const defaultLocale = locales.find((l) => l.isDefault);
  if (!defaultLocale) return;

  const ownLocalization = localizations.find((l) => l.locale === activeLocale);
  // Eşleşme yoksa VEYA istenen slug zaten bu dilin kendi slug'ıysa — yönlendirme GEREKMEZ.
  if (!ownLocalization || ownLocalization.slug === requestedSlug) return;

  const canonicalPath = withLocalePrefix(`${pathPrefix}/${ownLocalization.slug}`, activeLocale, defaultLocale.code);
  permanentRedirect(canonicalPath);
}
