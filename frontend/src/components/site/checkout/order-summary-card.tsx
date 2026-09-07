"use client";

import Link from "next/link";
import { AlertCircle, Lock, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FreeShippingProgress } from "@/components/site/free-shipping-progress";
import { LegalConsentSection } from "./legal-consent-section";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { formatPriceFromCents } from "@/lib/format-price";
import type { Cart, SitePage } from "@/lib/api/types";

/**
 * Ürün satırları + ara toplam/kargo/toplam bloğu — hem tam Sipariş Özeti kartında hem mobil
 * "peek" Accordion'unda (`.claude/design-notes-checkout-redesign.md` §2) BİREBİR aynı görünmesi
 * için TEK bir yerde tutulur; para matematiği TEKRARLANMAZ, doğrudan `cart.*`'tan okunur.
 * `cart.shipping.configured === false` ise kargo satırı hiç render edilmez.
 */
export function OrderSummaryLines({ cart, className }: { cart: Cart; className?: string }) {
  const currency = cart.currency ?? "TRY";

  return (
    <div className={className}>
      {cart.shipping.configured && (
        <FreeShippingProgress shipping={cart.shipping} subtotalCents={cart.subtotalCents} currency={currency} className="mb-4" />
      )}

      <div>
        {cart.items.map((item) => (
          <div key={item.id} className="flex gap-3 border-b border-border/60 py-3 first:pt-0 last:border-0 last:pb-0">
            {item.product.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- ürün görseli medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil
              <img
                src={item.product.coverImageUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded-[var(--site-radius)] object-cover"
                loading="lazy"
              />
            ) : (
              <div className="h-16 w-16 shrink-0 rounded-[var(--site-radius)] bg-muted" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{item.product.title}</p>
              {item.variantLabel && <p className="text-xs text-foreground/60">{item.variantLabel}</p>}
              <p className="text-xs text-foreground/60">Adet: {item.quantity}</p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-foreground">
              {formatPriceFromCents(item.lineTotalCents, currency)}
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between text-sm text-foreground/70">
          <span>Ara Toplam</span>
          <span>{formatPriceFromCents(cart.subtotalCents, currency)}</span>
        </div>
        {cart.shipping.configured && (
          <div className="flex items-center justify-between text-sm text-foreground/70">
            <span>Kargo</span>
            <span className={cart.shipping.feeCents === 0 ? "font-medium text-success" : undefined}>
              {cart.shipping.feeCents === 0 ? "Ücretsiz" : formatPriceFromCents(cart.shipping.feeCents, currency)}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border pt-2 text-foreground">
          <span className="text-base font-semibold">Toplam</span>
          <span className="text-lg font-bold">{formatPriceFromCents(cart.totalCents, currency)}</span>
        </div>
      </div>
    </div>
  );
}

interface OrderSummaryCardProps {
  cart: Cart;
  submitError: string | null;
  isSubmitting: boolean;
  distanceSalesPage: Pick<SitePage, "title" | "slug"> | null;
  onOpenPreliminaryModal: () => void;
  className?: string;
}

/**
 * Sağ sütun kartı (`.claude/design-notes-checkout-redesign.md` §5) — hata `Alert`'i başlığın
 * hemen altında, `LegalConsentSection` toplam bloğunun altında bir ayraçla, CTA en altta.
 * CTA `disabled` EDİLMEZ (eksik onay 422/RHF doğrulamasıyla checkbox altında gösterilir).
 */
export function OrderSummaryCard({
  cart,
  submitError,
  isSubmitting,
  distanceSalesPage,
  onOpenPreliminaryModal,
  className,
}: OrderSummaryCardProps) {
  const localize = useLocalizePath();

  return (
    <Card className={className}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Sipariş Özeti</h2>
        <Link href={localize("/cart")} className="text-sm text-primary hover:underline">
          Sepeti düzenle
        </Link>
      </div>

      {submitError && (
        <Alert variant="error" className="mb-4">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {submitError}
          </span>
        </Alert>
      )}

      <OrderSummaryLines cart={cart} />

      <LegalConsentSection distanceSalesPage={distanceSalesPage} onOpenPreliminaryModal={onOpenPreliminaryModal} />

      <Button type="submit" size="lg" loading={isSubmitting} className="mt-4 w-full rounded-[var(--site-radius)]">
        <Lock className="h-4 w-4" />
        Güvenli Ödemeye Geç
      </Button>
      <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-foreground/50">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        256-bit SSL ile şifrelenmiş güvenli ödeme
      </p>
    </Card>
  );
}
