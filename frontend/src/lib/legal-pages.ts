import type { SitePage } from "@/lib/api/types";

/**
 * PDP "İade & Garanti" sekmesi uydurma hukuki metin YAZAMAZ — mevcut `Page.isLegalDocument`
 * sayfalarına bağlantı verir (`.claude/architect-scope-products-catalog.md` §4.2). Şemada
 * hukuki belgenin "türünü" (iade/gizlilik/mesafeli satış...) ayıran bir alan YOKTUR — bu yüzden
 * başlık/slug üzerinde bir anahtar kelime sezgisi kullanılır (Türkçe UI zorunluluğu,
 * `.claude/CLAUDE.md`); eşleşme yoksa yayınlanmış herhangi bir hukuki belgeye, o da yoksa
 * `null`'a düşülür (bileşen linki GÖSTERMEZ, uydurma bir hedefe YÖNLENDİRMEZ).
 */
export function resolveReturnsPolicyPage(pages: SitePage[]): Pick<SitePage, "title" | "slug"> | null {
  const legalPages = pages.filter((page) => page.isLegalDocument);
  if (legalPages.length === 0) return null;

  const keywordMatch = legalPages.find((page) => /iade|garanti/i.test(page.title) || /iade|garanti/i.test(page.slug));
  return keywordMatch ?? legalPages[0];
}
