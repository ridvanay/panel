/**
 * §4 Public routing — varsayılan dil prefix'siz, diğerleri prefix'li (bkz.
 * `.claude/architect-scope-i18n.md` §4.1). Site içi bir yolu AKTİF dile göre öneklendirir:
 * `withLocalePrefix("/products", "en", "tr")` → `/en/products`
 * `withLocalePrefix("/products", "tr", "tr")` → `/products` (varsayılan dil prefix ALMAZ)
 *
 * Yalnızca KÖK-GÖRECELİ (`/` ile başlayan) site-içi yollar için kullanılır — mutlak URL'ler
 * (`https://...`, `mailto:`, `tel:`) DOKUNULMADAN döner (harici/admin tanımlı bağlantılar).
 */
export function withLocalePrefix(path: string, activeLocale: string, defaultLocale: string): string {
  if (!path.startsWith("/")) return path;
  if (activeLocale === defaultLocale) return path;
  return `/${activeLocale}${path}`;
}
