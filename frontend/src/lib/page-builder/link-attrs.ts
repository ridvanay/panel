import { canonicalSitePath } from "@/lib/i18n/physicians-path";

/**
 * Sayfa oluşturucu bloklarının opsiyonel `href` alanı için bağlantı öznitelikleri (Paket A3).
 * `href` backend'de `SafeHrefSchema`'dan geçmiştir (yalnızca `/…` veya http(s) mutlak). Mutlak
 * (dış) bağlantı yeni sekmede ve `rel="noopener noreferrer"` ile açılır; site içi bağlantı aynı sekmede.
 */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

export function linkAttrs(href: string): { href: string; target?: "_blank"; rel?: string } {
  return isExternalHref(href) ? { href, target: "_blank", rel: "noopener noreferrer" } : { href: canonicalSitePath(href) };
}
