"use client";

import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useRouter } from "next/navigation";
import { AlertTriangle, Minus, Plus, ShoppingCart, X } from "lucide-react";
import { useCart } from "@/context/cart-context";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Alert } from "@/components/ui/alert";
import { FreeShippingProgress } from "@/components/site/free-shipping-progress";
import { formatPriceFromCents } from "@/lib/format-price";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/**
 * Sepet çekmecesi (slide-over) — `.claude/design-notes-ecommerce-storefront.md` §6 BİREBİR.
 * `.site-scope` altında (Portal KULLANILMADAN) render edilir ki `--site-primary`/`--site-radius`
 * gibi marka token'larını miras alsın (Portal `document.body`'e taşırdı ve bu değişkenleri
 * kaybederdi — bkz. `(site)/layout.tsx`teki mount noktası). `fixed` konumlandırma zaten DOM
 * derinliğinden bağımsız tam ekran kaplar; base-ui `<Dialog.Portal>` yine de ZORUNLU (`Popup`
 * portal context'i olmadan fırlatır) — bu yüzden `container` açıkça `.site-scope` DOM
 * düğümüne bağlanır, aksi halde varsayılan `document.body`'e taşınıp marka token'larını
 * kaybederdi.
 */
export function CartDrawer() {
  const { cart, isDrawerOpen, closeDrawer, updateItem, removeItem } = useCart();
  const localize = useLocalizePath();
  const router = useRouter();
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // `document` yalnızca client'ta mevcut (SSR/hydration uyumu) — Portal hedefi mount sonrası
    // BİR KEZ senkronize edilir (theme-toggle.tsx/i18n-context.tsx'teki AYNI desen).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalContainer(document.querySelector<HTMLElement>(".site-scope"));
  }, []);

  const itemCount = cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const isEmpty = !cart || cart.items.length === 0;

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

  function handleCheckout() {
    closeDrawer();
    router.push(localize("/checkout"));
  }

  return (
    <DialogPrimitive.Root open={isDrawerOpen} onOpenChange={(next) => !next && closeDrawer()}>
      <DialogPrimitive.Portal container={portalContainer}>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-black/40 transition-opacity duration-150 data-closed:opacity-0 data-open:opacity-100" />
        <DialogPrimitive.Popup
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-xl outline-none transition-transform duration-300 ease-out data-closed:translate-x-full data-open:translate-x-0 sm:max-w-[420px]"
          aria-label="Sepetiniz"
        >
          <DialogPrimitive.Title className="sr-only">{`Sepetiniz (${itemCount})`}</DialogPrimitive.Title>

          <div className="flex shrink-0 items-center justify-between border-b border-border p-4">
            <h2 className="text-base font-semibold text-foreground">Sepetiniz ({itemCount})</h2>
            <DialogPrimitive.Close aria-label="Sepeti kapat" render={<Button type="button" variant="ghost" size="icon-sm" />}>
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {cart && cart.shipping.configured && (
            <div className="shrink-0 border-b border-border p-4">
              <FreeShippingProgress shipping={cart.shipping} subtotalCents={cart.subtotalCents} currency={cart.currency ?? "TRY"} />
            </div>
          )}

          {error && (
            <div className="shrink-0 px-4 pt-3">
              <Alert variant="error">
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {error}
                </span>
              </Alert>
            </div>
          )}

          {isEmpty ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <ShoppingCart className="h-12 w-12 text-foreground/20" aria-hidden="true" />
              <p className="text-base font-medium text-foreground">Sepetiniz boş</p>
              <p className="text-sm text-foreground/60">Ürünlere göz atıp favorilerinizi ekleyin.</p>
              <LinkButton href={localize("/products")} className="rounded-[var(--site-radius)]" onClick={closeDrawer}>
                Alışverişe Başla
              </LinkButton>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto">
                {cart.items.map((item) => {
                  const isMutating = mutatingId === item.id;
                  return (
                    <div key={item.id} className="flex gap-3 border-b border-border/60 p-4">
                      {item.product.coverImageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element -- ürün görseli medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil
                        <img
                          src={item.product.coverImageUrl}
                          alt=""
                          className="h-16 w-16 shrink-0 rounded-[var(--site-radius)] object-cover"
                          loading="lazy"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{item.product.title}</p>
                        {item.variantLabel && <p className="text-xs text-foreground/60">{item.variantLabel}</p>}
                        <div className="mt-2 flex items-center gap-1.5">
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
                          <span className="w-6 text-center text-sm font-medium text-foreground" aria-live="polite">
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
                      </div>
                      <div className="flex shrink-0 flex-col items-end justify-between">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`"${item.product.title}" ürününü sepetten kaldır`}
                          loading={isMutating}
                          onClick={() => handleRemove(item.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                        <span className="text-sm font-semibold text-foreground">
                          {formatPriceFromCents(item.lineTotalCents, cart.currency ?? "TRY")}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="shrink-0 space-y-2 border-t border-border p-4">
                <div className="flex items-center justify-between text-sm text-foreground/70">
                  <span>Ara Toplam</span>
                  <span>{formatPriceFromCents(cart.subtotalCents, cart.currency ?? "TRY")}</span>
                </div>
                {cart.shipping.configured && (
                  <div className="flex items-center justify-between text-sm text-foreground/70">
                    <span>Kargo</span>
                    <span>
                      {cart.shipping.feeCents === 0
                        ? "Ücretsiz"
                        : formatPriceFromCents(cart.shipping.feeCents, cart.currency ?? "TRY")}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between text-base font-semibold text-foreground">
                  <span>Toplam</span>
                  <span>{formatPriceFromCents(cart.totalCents, cart.currency ?? "TRY")}</span>
                </div>
                <Button type="button" className="w-full rounded-[var(--site-radius)]" onClick={handleCheckout}>
                  Ödemeye Geç
                </Button>
              </div>
            </>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
