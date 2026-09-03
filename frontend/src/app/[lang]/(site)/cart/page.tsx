"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useCart } from "@/context/cart-context";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { FreeShippingProgress } from "@/components/site/free-shipping-progress";
import { formatPriceFromCents } from "@/lib/format-price";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

export default function CartPage() {
  const { cart, loading, updateItem, removeItem, refetch } = useCart();
  const router = useRouter();
  const localize = useLocalizePath();
  const [error, setError] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  async function handleQuantityChange(itemId: string, nextQuantity: number) {
    if (nextQuantity < 1 || nextQuantity > 99) return;
    setError(null);
    setMutatingId(itemId);
    try {
      await updateItem(itemId, nextQuantity);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setMutatingId(null);
    }
  }

  async function handleRemove(itemId: string) {
    setError(null);
    setMutatingId(itemId);
    try {
      await removeItem(itemId);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setMutatingId(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="flex justify-center">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      </div>
    );
  }

  if (!cart) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-16 sm:px-6">
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Sepetiniz yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.
          </span>
        </Alert>
        <Button variant="outline" onClick={() => refetch()}>
          Tekrar dene
        </Button>
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <EmptyState
          icon={ShoppingCart}
          title="Sepetiniz boş"
          description="Alışverişe başlamak için ürünlere göz atın."
          action={<LinkButton href={localize("/products")}>Ürünlere göz at</LinkButton>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold text-foreground">Sepetim</h1>

      {cart.shipping.configured && (
        <FreeShippingProgress shipping={cart.shipping} subtotalCents={cart.subtotalCents} currency={cart.currency ?? "TRY"} />
      )}

      {error && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </span>
        </Alert>
      )}

      <Card className="divide-y divide-border p-0">
        {cart.items.map((item) => {
          const priceChanged = item.frozenUnitPriceCents !== item.currentPriceCents;
          const isMutating = mutatingId === item.id;
          return (
            <div key={item.id} className="flex flex-wrap items-center gap-4 p-4">
              {item.product.coverImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- ürün görseli medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil
                <img
                  src={item.product.coverImageUrl}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded-md object-cover"
                  loading="lazy"
                />
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{item.product.title}</p>
                {item.variantLabel && <p className="text-xs text-foreground/60">{item.variantLabel}</p>}
                <p className="mt-0.5 text-sm text-foreground/60">
                  {formatPriceFromCents(item.frozenUnitPriceCents, cart.currency ?? "TRY")}
                </p>
                {priceChanged && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Fiyat güncellendi: yeni fiyat {formatPriceFromCents(item.currentPriceCents, cart.currency ?? "TRY")}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Adedi azalt"
                  disabled={isMutating || item.quantity <= 1}
                  onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="w-8 text-center text-sm font-medium text-foreground" aria-live="polite">
                  {item.quantity}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Adedi artır"
                  disabled={isMutating || item.quantity >= 99 || item.quantity >= item.product.stockQuantity}
                  onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="w-24 shrink-0 text-right text-sm font-semibold text-foreground">
                {formatPriceFromCents(item.lineTotalCents, cart.currency ?? "TRY")}
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`"${item.product.title}" ürününü sepetten kaldır`}
                loading={isMutating}
                onClick={() => handleRemove(item.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </Card>

      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground/70">Ara Toplam</span>
          <span className="text-base font-medium text-foreground">
            {formatPriceFromCents(cart.subtotalCents, cart.currency ?? "TRY")}
          </span>
        </div>
        {cart.shipping.configured && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground/70">Kargo</span>
            <span className="text-base font-medium text-foreground">
              {cart.shipping.feeCents === 0 ? "Ücretsiz" : formatPriceFromCents(cart.shipping.feeCents, cart.currency ?? "TRY")}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-sm font-medium text-foreground/70">Toplam</span>
          <span className="text-xl font-semibold text-foreground">
            {formatPriceFromCents(cart.totalCents, cart.currency ?? "TRY")}
          </span>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => router.push(localize("/checkout"))}>Ödemeye Geç</Button>
      </div>
    </div>
  );
}
