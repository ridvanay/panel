"use client";

import { useState } from "react";
import { Check, ShoppingCart } from "lucide-react";
import { useCart } from "@/context/cart-context";
import { Button } from "@/components/ui/button";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

interface AddToCartButtonProps {
  productId: string;
  stockQuantity: number;
}

/** Ürün detay sayfasındaki "Sepete Ekle" — `product-card.tsx`/`page.tsx` sunucu bileşen olduğu için ayrı bir istemci alt bileşeni. */
export function AddToCartButton({ productId, stockQuantity }: AddToCartButtonProps) {
  const { addItem } = useCart();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const soldOut = stockQuantity === 0;

  async function handleClick() {
    setError(null);
    setAdding(true);
    try {
      await addItem(productId, 1);
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="mt-6 space-y-2">
      <Button onClick={handleClick} disabled={soldOut} loading={adding} aria-label={soldOut ? "Tükendi" : "Sepete ekle"}>
        {soldOut ? (
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
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
