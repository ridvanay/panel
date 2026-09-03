/**
 * Fiyat çözümleme — TEK üretim noktası (bkz.
 * `.claude/architect-scope-ecommerce-pro-template.md` §1.5, bağlayıcı karar).
 *
 * `ProductVariant.priceCents`: `null` = ürünün `priceCents` değeri MİRAS ALINIR; dolu ise
 * MUTLAK fiyattır (fark/delta DEĞİL — delta, indirimli fiyatla birleşince negatif tutar
 * üretebilir). `discountPriceCents` AYNI mantıkla, AMA BAĞIMSIZ olarak çözülür: varyasyonun
 * kendi `discountPriceCents`'i varsa o kullanılır, yoksa ürününki miras alınır — bu, fiyatın
 * miras alınıp indirimin varyasyona özgü olabildiği (veya tam tersi) durumları da doğru
 * modeller.
 *
 * `resolveUnitPriceCents` ÜÇ tüketicinin (sepete ekleme/fiyat dondurma, sepet DTO'sundaki
 * `currentPriceCents`, checkout'un taze okuması) hepsinin çağırdığı TEK fonksiyondur — üç
 * yerde üç kopya mantık YASAKTIR (bkz. `sliders/shortcode.ts::buildSliderShortcode`'un
 * kaçındığı hatanın ta kendisi, aynı gerekçe).
 */

export interface PriceableProduct {
  priceCents: number;
  discountPriceCents: number | null;
}

export interface PriceableVariant {
  priceCents: number | null;
  discountPriceCents: number | null;
}

export interface ResolvedPrice {
  /** Etkin liste fiyatı — varyasyonun kendi `priceCents`'i varsa o (mutlak), yoksa ürününki. */
  priceCents: number;
  /** Etkin indirim fiyatı — varyasyonun kendi `discountPriceCents`'i varsa o, yoksa ürününki. */
  discountPriceCents: number | null;
}

/**
 * `variant`'ın (ya da `null` ise ürünün) etkin liste/indirim fiyatını, MİRAS/MUTLAK kuralını
 * uygulayarak döner. Yalnızca "hangi fiyat çiftinin geçerli olduğu" sorusuna cevap verir —
 * satılacak TEK sayıyı (indirim varsa o, yoksa liste fiyatı) istiyorsanız
 * `resolveUnitPriceCents`'i kullanın.
 */
export function resolveEffectivePrice(product: PriceableProduct, variant: PriceableVariant | null): ResolvedPrice {
  const priceCents = variant?.priceCents ?? product.priceCents;
  const discountPriceCents = variant?.discountPriceCents ?? product.discountPriceCents;
  return { priceCents, discountPriceCents };
}

/**
 * Satılacak/sepete dondurulacak TEK birim fiyatı (kuruş) — indirim varsa indirim, yoksa liste
 * fiyatı. Sepete ekleme, sepet DTO'su (`currentPriceCents`) ve checkout'un taze okuması BU
 * fonksiyonu çağırır (bkz. dosya başı açıklaması).
 */
export function resolveUnitPriceCents(product: PriceableProduct, variant: PriceableVariant | null): number {
  const { priceCents, discountPriceCents } = resolveEffectivePrice(product, variant);
  return discountPriceCents ?? priceCents;
}
