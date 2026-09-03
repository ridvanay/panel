"use client";

import { useEffect, useState, type RefObject } from "react";
import { toast } from "sonner";
import { ShoppingCart } from "lucide-react";
import { useCart } from "@/context/cart-context";
import { Button } from "@/components/ui/button";
import { COOKIE_BANNER_VISIBILITY_EVENT } from "@/components/site/cookie-consent-banner";
import { formatPriceFromCents } from "@/lib/format-price";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { cn } from "@/lib/utils";

interface StickyAddToCartBarProps {
  /** İzlenen statik "Sepete Ekle" bölümü — bu, viewport'tan çıkınca bar görünür olur. */
  targetRef: RefObject<HTMLElement | null>;
  priceCents: number;
  discountPriceCents: number | null;
  currency: string;
  productId: string;
  variantId?: string | null;
  stockQuantity: number;
  /** Varyasyonlu üründe hiçbir seçim yapılmamışsa `true` — buton "Seçenek Seç" olur, disabled OLMAZ. */
  needsSelection: boolean;
  onAdded?: () => void;
}

/**
 * `.claude/design-notes-ecommerce-storefront.md` §7 BİREBİR — yalnızca `lg:hidden`,
 * `fixed bottom-0 z-40` (çerez bandının `z-50`'sinin ALTINDA, bilinçli öncelik). Çerez bandı
 * açıkken (`back-to-top-button.tsx`'teki AYNI olay/desen) kendini yukarı öteler.
 */
export function StickyAddToCartBar({
  targetRef,
  priceCents,
  discountPriceCents,
  currency,
  productId,
  variantId,
  stockQuantity,
  needsSelection,
  onAdded,
}: StickyAddToCartBarProps) {
  const { addItem } = useCart();
  const [visible, setVisible] = useState(false);
  const [cookieBannerVisible, setCookieBannerVisible] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting), { threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [targetRef]);

  useEffect(() => {
    function handleVisibility(event: Event) {
      setCookieBannerVisible((event as CustomEvent<{ visible: boolean }>).detail.visible);
    }
    window.addEventListener(COOKIE_BANNER_VISIBILITY_EVENT, handleVisibility);
    return () => window.removeEventListener(COOKIE_BANNER_VISIBILITY_EVENT, handleVisibility);
  }, []);

  function handleNeedsSelectionClick() {
    targetRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function handleAdd() {
    setAdding(true);
    try {
      await addItem(productId, 1, variantId);
      onAdded?.();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  const isSoldOut = !needsSelection && stockQuantity <= 0;

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "fixed inset-x-0 z-40 h-16 border-t border-border bg-surface/95 shadow-[0_-2px_12px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-transform duration-300 lg:hidden",
        cookieBannerVisible ? "bottom-[72px] sm:bottom-16" : "bottom-0",
        visible ? "translate-y-0" : "pointer-events-none translate-y-full"
      )}
    >
      <div className="flex h-full items-center gap-3 px-4">
        <div className="min-w-0 text-base font-semibold text-foreground">
          {discountPriceCents !== null ? (
            <>
              <span className="mr-1.5 text-xs font-normal text-foreground/40 line-through">
                {formatPriceFromCents(priceCents, currency)}
              </span>
              {formatPriceFromCents(discountPriceCents, currency)}
            </>
          ) : (
            formatPriceFromCents(priceCents, currency)
          )}
        </div>
        <div className="flex-1" />
        {needsSelection ? (
          <Button type="button" size="lg" className="rounded-[var(--site-radius)]" onClick={handleNeedsSelectionClick}>
            <ShoppingCart className="h-4 w-4" />
            Seçenek Seç
          </Button>
        ) : (
          <Button
            type="button"
            size="lg"
            className="rounded-[var(--site-radius)]"
            disabled={isSoldOut}
            loading={adding}
            aria-label={isSoldOut ? "Tükendi" : "Sepete ekle"}
            onClick={handleAdd}
          >
            {isSoldOut ? (
              "Tükendi"
            ) : (
              <>
                <ShoppingCart className="h-4 w-4" />
                Sepete Ekle
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
