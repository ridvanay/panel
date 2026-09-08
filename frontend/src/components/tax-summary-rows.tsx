import { formatPriceFromCents } from "@/lib/format-price";
import type { TaxSummary } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/** `20` → `"20"`, `7.5` → `"7,5"` — gereksiz `.0` YOK, TR ondalık ayracı `,`. */
function formatRatePercent(ratePercent: number): string {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(ratePercent);
}

interface TaxSummaryRowsProps {
  tax: TaxSummary;
  currency: string;
  className?: string;
  labelClassName?: string;
  valueClassName?: string;
  subRowClassName?: string;
}

/**
 * Sepet/checkout/sipariş özetlerinde ara toplam ile genel toplam ARASINA eklenen KDV satırı/
 * satırları — `.claude` görev notu §3 (bağlayıcı). Tek oran varsa "KDV (%20)" tek satır; birden
 * fazla oran varsa "KDV" başlığı + altına küçük alt satırlar her oran için. `tax.breakdown` boşsa
 * (hiçbir kaleme KDV oranı çözümlenemediyse) HİÇBİR ŞEY render edilmez — mağazanın KDV
 * uygulamadığı senaryoda gereksiz "KDV: 0,00 TL" satırı gösterilmez.
 */
export function TaxSummaryRows({
  tax,
  currency,
  className,
  labelClassName,
  valueClassName,
  subRowClassName,
}: TaxSummaryRowsProps) {
  if (tax.breakdown.length === 0) return null;

  if (tax.breakdown.length === 1) {
    const [entry] = tax.breakdown;
    return (
      <div className={className}>
        <span className={labelClassName}>KDV (%{formatRatePercent(entry.ratePercent)})</span>
        <span className={valueClassName}>{formatPriceFromCents(tax.totalTaxCents, currency)}</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className={className}>
        <span className={labelClassName}>KDV</span>
        <span className={valueClassName}>{formatPriceFromCents(tax.totalTaxCents, currency)}</span>
      </div>
      {tax.breakdown.map((entry) => (
        <div key={entry.ratePercent} className={cn("flex items-center justify-between", subRowClassName)}>
          <span>KDV (%{formatRatePercent(entry.ratePercent)})</span>
          <span>{formatPriceFromCents(entry.taxCents, currency)}</span>
        </div>
      ))}
    </div>
  );
}
