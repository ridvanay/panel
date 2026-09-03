/**
 * İndirim yüzdesi gösterimi — `.claude/design-notes-ecommerce-storefront.md` §3: "%İndirim"
 * (yüzde işareti sayıdan ÖNCE, boşluksuz). Bu SADECE gösterim amaçlı bir yuvarlama, ödeme/
 * sepet/kargo tutarlarını etkileyen bir "para matematiği" DEĞİLDİR — `priceCents`/
 * `discountPriceCents` sunucudan zaten kesinleşmiş olarak gelir.
 */
export function computeDiscountPercent(priceCents: number, discountPriceCents: number): number {
  if (priceCents <= 0) return 0;
  return Math.round((1 - discountPriceCents / priceCents) * 100);
}
