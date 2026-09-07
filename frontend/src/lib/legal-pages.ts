import { apiFetch } from "@/lib/api/client";
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

/**
 * Checkout "Mesafeli Satış Sözleşmesi" onay satırı için — `resolveReturnsPolicyPage` ile BİREBİR
 * aynı anahtar kelime sezgisi felsefesi (`.claude/architect-scope-checkout-redesign.md` §3.6/§6.2).
 */
export function resolveDistanceSalesPage(pages: SitePage[]): Pick<SitePage, "title" | "slug"> | null {
  const legalPages = pages.filter((page) => page.isLegalDocument);
  if (legalPages.length === 0) return null;

  const keywordMatch = legalPages.find(
    (page) => /mesafeli|satış sözleşmesi/i.test(page.title) || /mesafeli|satis-sozlesmesi/i.test(page.slug)
  );
  return keywordMatch ?? legalPages[0];
}

/**
 * Checkout "Ön Bilgilendirme Formu" onay satırı için — `resolveReturnsPolicyPage` ile BİREBİR
 * aynı anahtar kelime sezgisi felsefesi.
 */
export function resolvePreliminaryInfoPage(pages: SitePage[]): Pick<SitePage, "title" | "slug"> | null {
  const legalPages = pages.filter((page) => page.isLegalDocument);
  if (legalPages.length === 0) return null;

  const keywordMatch = legalPages.find(
    (page) => /ön bilgilendirme|on bilgilendirme/i.test(page.title) || /on-bilgilendirme|onbilgilendirme/i.test(page.slug)
  );
  return keywordMatch ?? legalPages[0];
}

/**
 * Checkout kişisel veri toplayan bölümlerindeki (teslimat adresi/fatura) KVKK Aydınlatma Metni
 * notu için — `resolveReturnsPolicyPage` ile BİREBİR aynı anahtar kelime sezgisi felsefesi.
 * `.claude/compliance-notes-checkout-redesign.md` §3 (RELEASE ENGELLEYİCİ bulgu) — mesafeli
 * satış/ön bilgilendirme onaylarının (sözleşme onayı) YERİNE GEÇMEZ, ayrı bir hukuki konudur.
 */
export function resolveKvkkNoticePage(pages: SitePage[]): Pick<SitePage, "title" | "slug"> | null {
  const legalPages = pages.filter((page) => page.isLegalDocument);
  if (legalPages.length === 0) return null;

  const keywordMatch = legalPages.find(
    (page) => /kvkk|aydınlatma|gizlilik/i.test(page.title) || /kvkk|aydinlatma|gizlilik/i.test(page.slug)
  );
  return keywordMatch ?? legalPages[0];
}

/**
 * `GET /pages` (public) — checkout `resolveDistanceSalesPage`/`resolvePreliminaryInfoPage`'i
 * beslemek için client bileşenlerinden çağrılır (`fetchPublishedPagesServer`'ın AKSİNE, `/checkout`
 * bütünüyle bir Client Component'tir, sunucu bileşeni sarmalayıcısı YOK — bkz.
 * `.claude/architect-scope-checkout-redesign.md` §6.2). Ağ hatasında sessizce boş dizi döner
 * (link atlanır, checkbox yine render edilir — §3.6).
 */
export async function fetchLegalPagesClient(locale?: string): Promise<SitePage[]> {
  try {
    return await apiFetch<SitePage[]>("/pages", { query: { locale } });
  } catch {
    return [];
  }
}
