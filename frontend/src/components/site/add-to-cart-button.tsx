"use client";

import { useState } from "react";
import { Check, ShoppingCart } from "lucide-react";
import { useCart } from "@/context/cart-context";
import { Button, type buttonVariants } from "@/components/ui/button";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

interface AddToCartButtonProps {
  productId: string;
  /** Ürünün varyasyonu varsa satılabilir birimi belirtir — yoksa `undefined` bırakılır. */
  variantId?: string | null;
  stockQuantity: number;
  /** Varsayılan `1` — PDP adet seçicisi (`quantity-selector.tsx`) bunu değiştirir. */
  quantity?: number;
  /**
   * Dıştan zorlanan devre dışı bırakma — varyasyonlu üründe hiçbir eksen seçilmediğinde
   * (`.claude/design-notes-ecommerce-storefront.md` §2). `stockQuantity`'den BAĞIMSIZDIR:
   * bu `true` iken buton her zaman "Sepete Ekle" yazar, "Tükendi" YAZMAZ (asıl neden seçim
   * eksikliğidir, stok değil).
   */
  disabled?: boolean;
  /** `disabled` iken butonun altında gösterilen ipucu (ör. "Devam etmek için Beden seçin."). */
  disabledHint?: string;
  /** Sepete ekleme başarıyla tamamlanınca çağrılır (ör. sepet çekmecesini açmak için). */
  onAdded?: () => void;
  /** Varsayılan `Button`'ın kendi varsayılanı — PDP `"lg"` verir (`.claude/design-notes-products-catalog.md` §4.3), kart varsayılanı bırakır. */
  size?: VariantProps<typeof buttonVariants>["size"];
  className?: string;
}

/** Ürün detay sayfasındaki/kartındaki "Sepete Ekle" — sunucu bileşenlerinden çağrıldığı için ayrı bir istemci alt bileşeni. */
export function AddToCartButton({
  productId,
  variantId,
  stockQuantity,
  quantity = 1,
  disabled = false,
  disabledHint,
  onAdded,
  size,
  className,
}: AddToCartButtonProps) {
  const { addItem } = useCart();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSoldOut = !disabled && stockQuantity <= 0;
  const isDisabled = disabled || isSoldOut;

  async function handleClick() {
    if (isDisabled) return;
    setError(null);
    setAdding(true);
    try {
      await addItem(productId, quantity, variantId);
      setAdded(true);
      onAdded?.();
      setTimeout(() => setAdded(false), 2000);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Button
        onClick={handleClick}
        disabled={isDisabled}
        loading={adding}
        size={size}
        aria-label={isSoldOut ? "Tükendi" : "Sepete ekle"}
        className={cn("rounded-[var(--site-radius)]", className)}
      >
        {isSoldOut ? (
          "Tükendi"
        ) : added ? (
          <>
            <Check className="h-4 w-4" />
            Sepete eklendi
          </>
        ) : (
          <>
            <ShoppingCart className="h-4 w-4" />
            Sepete Ekle
          </>
        )}
      </Button>
      {disabled && disabledHint && <p className="text-xs text-foreground/60">{disabledHint}</p>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
