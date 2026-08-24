"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertCircle, Heart, ShoppingCart, Trash2 } from "lucide-react";
import * as usersApi from "@/lib/api/users";
import type { WishlistItem } from "@/lib/api/types";
import { useCart } from "@/context/cart-context";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { formatPriceFromCents } from "@/lib/format-price";

/**
 * `WishlistItem.product` (`WishlistItemProduct`) `CartItem.product` ile AYNI hafif DTO'dur —
 * tam `Product` DEĞİLDİR (bkz. openapi `WishlistItemProduct`). Bu yüzden `ProductCard`
 * doğrudan kullanılamaz; aynı görsel/başlık/fiyat kompozisyonu burada, gerçek DTO alanlarıyla
 * (`coverImageUrl` düz string, `excerpt` yok) tekrarlanır (design-notes-customer-portal.md §5).
 */
function WishlistProductCard({
  item,
  onAddToCart,
  onRemove,
  addingToCart,
  removing,
}: {
  item: WishlistItem;
  onAddToCart: () => void;
  onRemove: () => void;
  addingToCart: boolean;
  removing: boolean;
}) {
  const localize = useLocalizePath();
  const { product } = item;
  const soldOut = product.stockQuantity === 0;

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Link href={localize(`/products/${product.slug}`)} className="block transition-colors hover:bg-surface-muted">
        <div className="relative aspect-square w-full bg-surface-muted">
          {product.coverImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- kapak URL'si medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil
            <img src={product.coverImageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          )}
          {soldOut && (
            <span className="absolute right-2 top-2 rounded-full bg-danger px-2 py-0.5 text-xs font-medium text-danger-foreground">
              Tükendi
            </span>
          )}
        </div>
        <div className="p-4">
          <h3 className="text-lg font-semibold text-foreground">{product.title}</h3>
          <p className="mt-2 text-base font-semibold text-foreground">
            {product.discountPriceCents !== null ? (
              <>
                <span className="mr-2 text-sm font-normal text-foreground/40 line-through">
                  {formatPriceFromCents(product.priceCents, product.currency)}
                </span>
                {formatPriceFromCents(product.discountPriceCents, product.currency)}
              </>
            ) : (
              formatPriceFromCents(product.priceCents, product.currency)
            )}
          </p>
        </div>
      </Link>
      <div className="flex items-center gap-2 border-t border-border p-4 pt-3">
        <Button size="sm" className="flex-1" disabled={soldOut} loading={addingToCart} onClick={onAddToCart}>
          <ShoppingCart className="h-4 w-4" />
          {soldOut ? "Tükendi" : "Sepete Ekle"}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Favorilerden çıkar"
          className="text-danger hover:bg-danger/10"
          loading={removing}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * `/hesabim/favorilerim` içerik istemcisi — §customer-portal §2.3, design-notes §5.
 * `products` modülü açık garantisi `favorilerim/page.tsx`'te sağlanır (bu bileşen yalnızca
 * modül açıkken mount edilir), bu yüzden `CartProvider`'ın da (site)/layout.tsx'te var olduğu
 * varsayılır (`useCart` — `useCartOptional` DEĞİL).
 */
export function WishlistClient() {
  const { addItem } = useCart();
  const localize = useLocalizePath();

  const [items, setItems] = useState<WishlistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingProductId, setAddingProductId] = useState<string | null>(null);
  const [removingProductId, setRemovingProductId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(null);
    setError(null);
    try {
      const data = await usersApi.getMyWishlist();
      setItems(data);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleAddToCart(productId: string) {
    setAddingProductId(productId);
    try {
      await addItem(productId, 1);
      toast.success("Ürün sepete eklendi.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setAddingProductId(null);
    }
  }

  async function handleRemove(productId: string) {
    setRemovingProductId(productId);
    try {
      await usersApi.removeFromMyWishlist(productId);
      setItems((prev) => (prev ?? []).filter((item) => item.productId !== productId));
      toast.success("Ürün favorilerden çıkarıldı.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setRemovingProductId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Favori Ürünlerim</h2>
        <p className="mt-1 text-sm text-foreground/60">Beğendiğiniz ürünleri buradan takip edin.</p>
      </div>

      {error && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {!error && items === null && (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-[var(--site-primary)]" />
        </div>
      )}

      {!error && items && items.length === 0 && (
        <EmptyState
          icon={Heart}
          title="Henüz favori ürününüz yok"
          description="Beğendiğiniz ürünleri favorilerinize ekleyin."
          action={
            <Link
              href={localize("/products")}
              className="inline-flex items-center rounded-lg bg-[var(--site-button)] px-4 py-2 text-sm font-medium text-[var(--site-button-text)] transition-all duration-300 hover:opacity-85"
            >
              Ürünlere göz at
            </Link>
          }
        />
      )}

      {!error && items && items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <WishlistProductCard
              key={item.id}
              item={item}
              addingToCart={addingProductId === item.productId}
              removing={removingProductId === item.productId}
              onAddToCart={() => void handleAddToCart(item.productId)}
              onRemove={() => void handleRemove(item.productId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
