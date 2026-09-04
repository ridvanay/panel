import { Truck } from "lucide-react";

interface ProductShippingNoticeProps {
  shippingEstimatedDaysMin: number | null;
  shippingEstimatedDaysMax: number | null;
}

/**
 * `.claude/architect-scope-products-catalog.md` §2.5 — İKİSİ de `null` iken bileşen HİÇ render
 * edilmez: sabit bir teslimat süresi metni mağaza sahibinin vermediği bir TİCARİ TAAHHÜTTÜR.
 */
export function ProductShippingNotice({ shippingEstimatedDaysMin, shippingEstimatedDaysMax }: ProductShippingNoticeProps) {
  if (shippingEstimatedDaysMin === null || shippingEstimatedDaysMax === null) return null;

  const label =
    shippingEstimatedDaysMin === shippingEstimatedDaysMax
      ? `${shippingEstimatedDaysMin} iş günü içinde kargoda`
      : `${shippingEstimatedDaysMin}-${shippingEstimatedDaysMax} iş günü içinde kargoda`;

  return (
    <div className="mt-4 flex items-center gap-1.5 text-sm text-foreground/70">
      <Truck className="h-4 w-4 text-foreground/50" aria-hidden="true" />
      {label}
    </div>
  );
}
