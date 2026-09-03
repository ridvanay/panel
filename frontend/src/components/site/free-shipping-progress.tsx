import { CheckCircle2 } from "lucide-react";
import type { CartShipping } from "@/lib/api/types";
import { formatPriceFromCents } from "@/lib/format-price";
import { cn } from "@/lib/utils";

interface FreeShippingProgressProps {
  shipping: CartShipping;
  /** Genişlik oranı için — `remainingCents` ile BİRLİKTE kullanılır, kendisi para HESAPLAMAZ. */
  subtotalCents: number;
  currency: string;
  className?: string;
}

/**
 * `.claude/design-notes-ecommerce-storefront.md` §5 — `cart.shipping` PROP olarak alınır,
 * `configured === false` iken HİÇ render edilmez, `remainingCents` SUNUCUDAN gelen değerdir.
 * Sepet çekmecesinin (`cart-drawer.tsx`) İÇİNDE kullanılan AYRI bir bileşendir.
 */
export function FreeShippingProgress({ shipping, subtotalCents, currency, className }: FreeShippingProgressProps) {
  if (!shipping.configured) return null;

  const remaining = shipping.remainingCents;
  const widthPercent =
    shipping.isFree || remaining === null || remaining <= 0
      ? 100
      : Math.min(100, (subtotalCents / (subtotalCents + remaining)) * 100);

  return (
    <div className={className}>
      <p
        className={cn(
          "mb-1.5 flex items-center gap-1 text-sm",
          shipping.isFree ? "font-medium text-success" : "text-foreground"
        )}
        aria-live="polite"
      >
        {shipping.isFree ? (
          <>
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            Ücretsiz kargo kazandınız!
          </>
        ) : (
          remaining !== null && `Ücretsiz kargoya son ${formatPriceFromCents(remaining, currency)}!`
        )}
      </p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            shipping.isFree ? "bg-success" : "bg-[var(--site-primary)]"
          )}
          style={{ width: `${widthPercent}%` }}
        />
      </div>
    </div>
  );
}
