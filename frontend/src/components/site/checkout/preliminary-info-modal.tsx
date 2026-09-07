"use client";

import { ExternalLink, FileText } from "lucide-react";
import { useFormContext, useWatch } from "react-hook-form";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { formatPriceFromCents } from "@/lib/format-price";
import type { Cart, SitePage } from "@/lib/api/types";
import type { CheckoutFormValues } from "./checkout-schema";

interface PreliminaryInfoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cart: Cart;
  preliminaryInfoPage: Pick<SitePage, "title" | "slug"> | null;
}

/**
 * `.claude/design-notes-checkout-redesign.md` §6 — dinamik "makbuz" listesi frontend'in ürettiği
 * bir özet paneldir (§3.6 mimari kararı); tam sözleşme metni GÖMÜLMEZ, admin `Page` içeriğine
 * bağlantı verilir (`preliminaryInfoPage === null` ise bağlantı kartı HİÇ render edilmez).
 */
export function PreliminaryInfoModal({ open, onOpenChange, cart, preliminaryInfoPage }: PreliminaryInfoModalProps) {
  const { control } = useFormContext<CheckoutFormValues>();
  const localize = useLocalizePath();
  const currency = cart.currency ?? "TRY";

  const fullName = useWatch({ control, name: "shippingAddress.fullName" });
  const city = useWatch({ control, name: "shippingAddress.city" });
  const district = useWatch({ control, name: "shippingAddress.district" });
  const addressLine1 = useWatch({ control, name: "shippingAddress.addressLine1" });
  const billingType = useWatch({ control, name: "billing.billingType" });

  const addressOneLine = [addressLine1, district, city].filter(Boolean).join(", ") || "—";
  const shippingLabel = !cart.shipping.configured
    ? "—"
    : cart.shipping.feeCents === 0
      ? "Ücretsiz"
      : formatPriceFromCents(cart.shipping.feeCents, currency);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ön Bilgilendirme Özeti</DialogTitle>
          <DialogDescription>Onayınız öncesinde sipariş bilgilerinizi gözden geçirin.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-1 overflow-y-auto text-sm">
          <div className="flex justify-between border-b border-border/60 py-1.5">
            <span className="text-foreground/60">Alıcı</span>
            <span className="text-foreground">{fullName || "—"}</span>
          </div>
          <div className="flex justify-between border-b border-border/60 py-1.5">
            <span className="text-foreground/60">Teslimat Adresi</span>
            <span className="text-right text-foreground">{addressOneLine}</span>
          </div>
          <div className="flex justify-between border-b border-border/60 py-1.5">
            <span className="text-foreground/60">Fatura Tipi</span>
            <span className="text-foreground">{billingType === "CORPORATE" ? "Kurumsal" : "Bireysel"}</span>
          </div>
          <div className="flex justify-between border-b border-border/60 py-1.5">
            <span className="text-foreground/60">Kargo</span>
            <span className="text-foreground">{shippingLabel}</span>
          </div>
          <div className="flex justify-between py-1.5 font-semibold">
            <span>Toplam</span>
            <span>{formatPriceFromCents(cart.totalCents, currency)}</span>
          </div>
        </div>

        {preliminaryInfoPage && (
          <a
            href={localize(`/${preliminaryInfoPage.slug}`)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-[var(--site-radius)] border border-border p-3 transition-colors hover:border-primary/40"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--site-radius)] bg-accent/10 text-accent">
              <FileText className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{preliminaryInfoPage.title}</span>
            <ExternalLink className="h-4 w-4 shrink-0 text-foreground/40" />
          </a>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Kapat</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
