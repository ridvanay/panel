/**
 * Ürün kartı/PDP rozet eşikleri — `.claude/design-notes-products-catalog.md` §3.2. Sabit
 * eşikler `product-purchase-panel.tsx::LOW_STOCK_THRESHOLD` ile AYNI desende (basit dışa
 * aktarılmış sabit) tanımlanır; mağaza verisine göre AYARLANABİLİR.
 */

/** `publishedAt` bu kadar gün içindeyse "Yeni" rozeti gösterilir (architect'in verdiği eşik). */
export const NEW_BADGE_MAX_AGE_DAYS = 14;

/** `salesCount` bu değere eşit/üstündeyse "Çok Satan" rozeti gösterilir (ui-designer önerisi). */
export const BESTSELLER_BADGE_THRESHOLD = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isNewProduct(publishedAt: string | null, now: Date = new Date()): boolean {
  if (!publishedAt) return false;
  const publishedTime = new Date(publishedAt).getTime();
  if (Number.isNaN(publishedTime)) return false;
  return now.getTime() - publishedTime <= NEW_BADGE_MAX_AGE_DAYS * DAY_MS;
}

export function isBestsellerProduct(salesCount: number): boolean {
  return salesCount >= BESTSELLER_BADGE_THRESHOLD;
}
