/**
 * Merkezi KDV (vergi) hesabı — `lib/shipping.ts::computeShipping` İLE AYNI desen: TEK yer,
 * sepet DTO'su (cart.routes.ts), checkout (checkout.routes.ts, taze okuma) ve
 * `OrderItem.taxRatePercent`/`taxCents` + `Order.pricesIncludeTax` SNAPSHOT'ları BU dosyayı
 * kullanır. Kargo bu hesaba KATILMAZ (v1 kapsamı dışı, `Order.shippingCents` AYRI kalır).
 */

/** `TaxRate` tablosunun DTO'ya/hesaba yetecek hafif izdüşümü — mapper/hesap katmanı arasında paylaşılır. */
export interface TaxRateLite {
  id: string;
  name: string;
  ratePercent: number;
}

export interface ResolveTaxRateProductInput {
  taxRateId: string | null;
}

export interface ResolveTaxRateSettingsInput {
  defaultTaxRateId: string | null;
}

/**
 * `mappers/index.ts::toCartItemDto/toCartDto`, `checkout.routes.ts`, `products.routes.ts` ORTAK
 * bağlamı — `computeShipping`'in `ShippingSettingsInput`'ü İLE AYNI amaç: tek bir DB okumasından
 * (`SiteSettings` + `defaultTaxRate` relation'ı) türetilip aşağı akışa TAŞINIR, her satırda ayrı
 * ayrı sorgulanmaz.
 */
export interface PriceTaxContext {
  pricesIncludeTax: boolean;
  /** Ürünün KENDİ `taxRateId`'si yoksa kullanılan mağaza varsayılanı — `null` = tanımsız. */
  defaultTaxRate: TaxRateLite | null;
}

/**
 * Ürünün KDV oranını çözer: ürünün KENDİ `taxRateId`'si varsa onu, yoksa mağaza varsayılanını
 * (`SiteSettings.defaultTaxRateId`) döner. İkisi de yoksa/oranlar tablosunda bulunamazsa `null`
 * (KDV hiç hesaplanmaz — `computeTaxBreakdown` bu satırı `ratePercent: 0` gibi ele alır, çağıran
 * taraf `resolveProductTaxRate(...)?.ratePercent ?? 0` deseniyle kullanır).
 */
export function resolveProductTaxRate(
  product: ResolveTaxRateProductInput,
  settings: ResolveTaxRateSettingsInput,
  allRatesById: Map<string, TaxRateLite> | Record<string, TaxRateLite>
): TaxRateLite | null {
  const ratesById = allRatesById instanceof Map ? allRatesById : new Map(Object.entries(allRatesById));
  const effectiveId = product.taxRateId ?? settings.defaultTaxRateId;
  if (!effectiveId) return null;
  return ratesById.get(effectiveId) ?? null;
}

export interface TaxLineInput {
  unitPriceCents: number;
  quantity: number;
  /** `TaxRate.ratePercent` — `resolveProductTaxRate` sonucu `null` ise çağıran taraf `0` geçer. */
  ratePercent: number;
}

export interface TaxBreakdownEntry {
  ratePercent: number;
  /** Bu orana ait satırların NET (KDV hariç) toplamı — dahil/hariç fiyatlandırmada AYNI anlamı taşır. */
  baseCents: number;
  taxCents: number;
}

export interface TaxBreakdownResult {
  /** KDV HARİÇ toplam (kuruş). */
  netCents: number;
  /** Toplam KDV tutarı (kuruş) — FATURA/gösterim amaçlı, `pricesIncludeTax: true` iken toplam
   * tutara AYRICA EKLENMEZ (zaten fiyata dahil). */
  taxCents: number;
  /** KDV DAHİL toplam (kuruş). */
  grossCents: number;
  /** Orana göre gruplanmış döküm — en yüksek orandan en düşüğe sıralı. */
  breakdown: TaxBreakdownEntry[];
}

/** Half-up (matematiksel) yuvarlama — banker's rounding DEĞİL. Girdiler her zaman pozitif. */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/**
 * Satır bazlı KDV hesabı. `options.pricesIncludeTax: true` iken satır tutarı (`unitPriceCents *
 * quantity`) GROSS (KDV dahil) kabul edilir ve KDV `gross * r / (100 + r)` ile GERİ ÇIKARILIR;
 * `false` iken satır tutarı NET kabul edilir ve KDV `net * r / 100` ile ÜZERİNE EKLENİR. Kargo
 * bu hesaba KATILMAZ — çağıran taraf yalnızca ürün satırlarını (`OrderItem`/`CartItem` izdüşümü)
 * geçirir.
 */
export function computeTaxBreakdown(lines: TaxLineInput[], options: { pricesIncludeTax: boolean }): TaxBreakdownResult {
  const byRate = new Map<number, { baseCents: number; taxCents: number }>();
  let netCents = 0;
  let taxCents = 0;
  let grossCents = 0;

  for (const line of lines) {
    const amountCents = line.unitPriceCents * line.quantity;
    const r = line.ratePercent;

    let lineNetCents: number;
    let lineTaxCents: number;
    let lineGrossCents: number;

    if (!r || r <= 0) {
      lineNetCents = amountCents;
      lineTaxCents = 0;
      lineGrossCents = amountCents;
    } else if (options.pricesIncludeTax) {
      lineGrossCents = amountCents;
      lineTaxCents = roundHalfUp((lineGrossCents * r) / (100 + r));
      lineNetCents = lineGrossCents - lineTaxCents;
    } else {
      lineNetCents = amountCents;
      lineTaxCents = roundHalfUp((lineNetCents * r) / 100);
      lineGrossCents = lineNetCents + lineTaxCents;
    }

    netCents += lineNetCents;
    taxCents += lineTaxCents;
    grossCents += lineGrossCents;

    const bucket = byRate.get(r) ?? { baseCents: 0, taxCents: 0 };
    bucket.baseCents += lineNetCents;
    bucket.taxCents += lineTaxCents;
    byRate.set(r, bucket);
  }

  const breakdown: TaxBreakdownEntry[] = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([ratePercent, v]) => ({ ratePercent, baseCents: v.baseCents, taxCents: v.taxCents }));

  return { netCents, taxCents, grossCents, breakdown };
}
