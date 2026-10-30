/**
 * Paket W — eşleştirme sihirbazı arama normalleştirmesi. ÖN YÜZDE BİREBİR KOPYASI VAR
 * (`frontend/src/lib/matcher/text.ts`); ikisi aynı kalmalı (testler aynı örnekleri sabitler).
 *
 * Kurallar: büyük/küçük harf ve aksan duyarsız; Türkçe İ/ı kuralı (İ→i, I→i, ı→i — "MİDE", "mıde",
 * "mide" aynı); Almanca ß→ss; Arapça hareke/tatvil atılır ve elif/ye/te-merbuta varyantları birleşir;
 * Rusça ё→е (birleşik işaret olarak düşer). Noktalama boşluğa çevrilir.
 */
export function foldTerm(value: string): string {
  return value
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/ß/g, "ss")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Serbest metinde terim geçiyor mu (kelime sınırına saygılı; terim ve metin önceden `foldTerm`'den
 * geçmiş olmalı). Çok kısa terimler (< 3 harf) yanlış alarm üretmesin diye eşleşmez.
 */
export function textContainsTerm(foldedText: string, foldedTerm: string): boolean {
  if (foldedTerm.length < 3) return false;
  return ` ${foldedText} `.includes(` ${foldedTerm} `) || (foldedTerm.includes(" ") && foldedText.includes(foldedTerm));
}

/**
 * Otomatik tamamlama puanı: 0 = eşleşme yok; tam eşleşme > kelime başı > içerir. `query` ve `term`
 * katlanmış (folded) olmalı.
 */
export function matchScore(foldedQuery: string, foldedTerm: string): number {
  if (!foldedQuery || !foldedTerm) return 0;
  if (foldedTerm === foldedQuery) return 3;
  if (foldedTerm.startsWith(foldedQuery) || foldedTerm.includes(` ${foldedQuery}`)) return 2;
  if (foldedQuery.length >= 3 && foldedTerm.includes(foldedQuery)) return 1;
  return 0;
}
