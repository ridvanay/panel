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

export interface PriceColumnsInput {
  priceCents: number;
  discountPriceCents: number | null;
}

export interface DerivedPriceColumns {
  effectivePriceCents: number;
  discountPercent: number;
}

/**
 * `Product.effectivePriceCents`/`Product.discountPercent` — katalog sıralama/filtreleme
 * kolonlarının TEK üretim noktası (bkz. `.claude/architect-scope-products-catalog.md` §2.3/§2.4,
 * bağlayıcı karar). `effectivePriceCents = discountPriceCents ?? priceCents`,
 * `discountPercent = round((1 - discountPriceCents/priceCents) * 100)` (indirim yoksa veya
 * `priceCents <= 0` ise `0`).
 *
 * ÇAĞRILMASI ZORUNLU 5 yazma yeri (biri atlanırsa katalog SESSİZCE yanlış sıralar):
 * 1. `modules/products/products.routes.ts` — `POST /admin/products`
 * 2. `modules/products/products.routes.ts` — `PATCH /admin/products/:productId` (fiyat/indirim gövdede varsa)
 * 3. `modules/demo-templates/importer.ts` — `tx.product.create`
 * 4. `modules/import/import.worker.ts` — CSV içe aktarma (`writeProduct`, create VE overwrite dalları)
 * (`PATCH /admin/products/:productId/stock` HARİÇTİR — fiyat değişmez, bkz. §2.4 madde 3.)
 */
export function derivePriceColumns(input: PriceColumnsInput): DerivedPriceColumns {
  const { priceCents, discountPriceCents } = input;
  const effectivePriceCents = discountPriceCents ?? priceCents;

  if (discountPriceCents === null || discountPriceCents === undefined || priceCents <= 0) {
    return { effectivePriceCents, discountPercent: 0 };
  }

  const discountPercent = Math.round((1 - discountPriceCents / priceCents) * 100);
  return { effectivePriceCents, discountPercent };
}
