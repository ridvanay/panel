import { Receipt } from "lucide-react";
import { formatPriceFromCents } from "@/lib/format-price";
import type { ProductTaxRate, TaxRate } from "@/lib/api/types";

/** Backend `lib/tax.ts::roundHalfUp` İLE AYNI half-up (matematiksel) yuvarlama. */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

interface TaxEstimateBoxProps {
  priceLira: string;
  discountPriceLira: string;
  currency: string;
  taxRateId: string;
  taxRates: TaxRate[];
  defaultTaxRate: ProductTaxRate | null;
  pricesIncludeTax: boolean;
}

/**
 * Fiyat alanlarının altında, form state'inden CANLI (API çağırmadan) hesaplanan sessiz bilgi
 * kutusu — `.claude` görev notu §2 (bağlayıcı). `lib/tax.ts::computeTaxBreakdown`'ın TEK satırlık
 * (bu ürün) izdüşümü; sunucu hesabının YERİNE GEÇMEZ, yalnızca ön izlemedir.
 */
export function TaxEstimateBox({
  priceLira,
  discountPriceLira,
  currency,
  taxRateId,
  taxRates,
  defaultTaxRate,
  pricesIncludeTax,
}: TaxEstimateBoxProps) {
  const effectivePriceLira = discountPriceLira.trim() || priceLira.trim();
  const priceNum = Number(effectivePriceLira);
  if (!effectivePriceLira || Number.isNaN(priceNum) || priceNum <= 0) return null;

  const ratePercent = taxRateId ? (taxRates.find((r) => r.id === taxRateId)?.ratePercent ?? null) : (defaultTaxRate?.ratePercent ?? null);

  const amountCents = Math.round(priceNum * 100);

  if (!ratePercent || ratePercent <= 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-foreground/60">
        <Receipt className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{formatPriceFromCents(amountCents, currency)} · KDV uygulanmıyor</span>
      </div>
    );
  }

  let netCents: number;
  let taxCents: number;
  let grossCents: number;
  if (pricesIncludeTax) {
    grossCents = amountCents;
    taxCents = roundHalfUp((grossCents * ratePercent) / (100 + ratePercent));
    netCents = grossCents - taxCents;
  } else {
    netCents = amountCents;
    taxCents = roundHalfUp((netCents * ratePercent) / 100);
    grossCents = netCents + taxCents;
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-foreground/60">
      <Receipt className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {pricesIncludeTax ? (
        <span>
          {formatPriceFromCents(grossCents, currency)} (KDV Dahil) · Net: {formatPriceFromCents(netCents, currency)} · KDV (%
          {ratePercent}): {formatPriceFromCents(taxCents, currency)}
        </span>
      ) : (
        <span>
          {formatPriceFromCents(netCents, currency)} (KDV Hariç) · KDV eklenecek (%{ratePercent}): {formatPriceFromCents(taxCents, currency)} ·
          Toplam: {formatPriceFromCents(grossCents, currency)}
        </span>
      )}
    </div>
  );
}
