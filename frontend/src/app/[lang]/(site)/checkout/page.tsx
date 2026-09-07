"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { FormProvider, useForm, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShoppingCart } from "lucide-react";
import { useCart } from "@/context/cart-context";
import { useAuthOptional } from "@/context/auth-context";
import { useLocalizePath } from "@/context/locale-alternates-context";
import * as checkoutApi from "@/lib/api/checkout";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import {
  fetchLegalPagesClient,
  resolveDistanceSalesPage,
  resolveKvkkNoticePage,
  resolvePreliminaryInfoPage,
} from "@/lib/legal-pages";
import { formatPriceFromCents } from "@/lib/format-price";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ContactSection } from "@/components/site/checkout/contact-section";
import { ShippingAddressSection } from "@/components/site/checkout/shipping-address-section";
import { BillingSection } from "@/components/site/checkout/billing-section";
import { OrderSummaryCard, OrderSummaryLines } from "@/components/site/checkout/order-summary-card";
import { PreliminaryInfoModal } from "@/components/site/checkout/preliminary-info-modal";
import {
  buildCheckoutRequest,
  checkoutFormDefaultValues,
  checkoutFormSchema,
  type CheckoutFormValues,
} from "@/components/site/checkout/checkout-schema";
import type { SitePage } from "@/lib/api/types";

/**
 * `.claude/architect-scope-checkout-redesign.md` §6.2 + `.claude/design-notes-checkout-redesign.md`
 * — 2 sütunlu akış, TEK `<form>` (CTA sağ sütunda ama AYNI form elementi içinde). "Kargo Yöntemi"
 * ayrı bir bölüm DEĞİL (design-notes §0) — kargo bilgisi yalnızca sipariş özetinde bir satır.
 */
export default function CheckoutPage() {
  const { cart, loading } = useCart();
  const auth = useAuthOptional();
  const localize = useLocalizePath();
  const params = useParams<{ lang?: string }>();
  const lang = typeof params?.lang === "string" ? params.lang : undefined;

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [legalPages, setLegalPages] = useState<SitePage[] | null>(null);
  const [preliminaryModalOpen, setPreliminaryModalOpen] = useState(false);

  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutFormSchema),
    defaultValues: checkoutFormDefaultValues,
  });
  const {
    handleSubmit,
    setValue,
    setError,
    getValues,
    formState: { isSubmitting },
  } = form;

  useEffect(() => {
    (async () => {
      const pages = await fetchLegalPagesClient(lang);
      setLegalPages(pages);
    })();
  }, [lang]);

  // Üye kullanıcıda YALNIZCA e-posta/ad soyad ön dolu — telefon `User.phone` YOK, ön doldurulamaz
  // (bkz. `.claude/architect-scope-checkout-redesign.md` §6.2). Kullanıcının kendi girdiği bir
  // değeri EZMEZ (yalnızca alan boşken doldurur).
  useEffect(() => {
    if (auth?.status !== "authenticated" || !auth.user) return;
    if (!getValues("customerEmail")) setValue("customerEmail", auth.user.email);
    if (!getValues("customerName") && auth.user.name) setValue("customerName", auth.user.name);
  }, [auth?.status, auth?.user, getValues, setValue]);

  const distanceSalesPage = useMemo(() => (legalPages ? resolveDistanceSalesPage(legalPages) : null), [legalPages]);
  const preliminaryInfoPage = useMemo(() => (legalPages ? resolvePreliminaryInfoPage(legalPages) : null), [legalPages]);
  const kvkkNoticePage = useMemo(() => (legalPages ? resolveKvkkNoticePage(legalPages) : null), [legalPages]);

  async function onSubmit(values: CheckoutFormValues) {
    setSubmitError(null);
    try {
      const { checkoutUrl } = await checkoutApi.createCheckoutSession(buildCheckoutRequest(values));
      // Harici Stripe domaini — Next.js router DEĞİL, tam sayfa yönlendirme gerekir (bkz.
      // dashboard/[orgId]/billing/page.tsx AYNI patern: `.assign()`, react-compiler'ın dış
      // değişken mutasyonu kuralına takılan `window.location.href = ...` yerine).
      window.location.assign(checkoutUrl);
    } catch (err) {
      if (err instanceof ApiClientError && err.details) {
        // 422 `error.details` anahtarları react-hook-form alan yollarıyla BİREBİR eşleşir
        // (`shippingAddress.postalCode`, `billing.taxNumber`, `billing.address.fullName`, ...).
        for (const [field, messages] of Object.entries(err.details)) {
          if (messages[0]) setError(field as Path<CheckoutFormValues>, { type: "server", message: messages[0] });
        }
      }
      setSubmitError(friendlyErrorMessage(err));
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <div className="flex justify-center">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <EmptyState
          icon={ShoppingCart}
          title="Sepetiniz boş"
          description="Ödemeye geçmeden önce sepetinize ürün ekleyin."
          action={
            <Link href={localize("/products")} className="text-sm font-medium text-primary hover:underline">
              Ürünlere göz at
            </Link>
          }
        />
      </div>
    );
  }

  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  const currency = cart.currency ?? "TRY";

  return (
    <FormProvider {...form}>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground">Ödeme</h1>
          <p className="mt-1 text-sm text-foreground/60">Siparişinizi tamamlamak için bilgilerinizi girin.</p>
        </div>

        {/* Mobil "peek" — masaüstünde sağ sütun zaten görünür, ikinci bir kopya GEREKMEZ. */}
        <div className="mb-6 lg:hidden">
          <Accordion>
            <AccordionItem>
              <AccordionTrigger>
                <span className="flex flex-1 items-center justify-between pr-2">
                  <span>Sipariş Özeti ({itemCount} ürün)</span>
                  <span className="font-semibold text-foreground">{formatPriceFromCents(cart.totalCents, currency)}</span>
                </span>
              </AccordionTrigger>
              <AccordionPanel className="border-t border-border/60 p-4">
                <OrderSummaryLines cart={cart} />
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start lg:gap-10"
        >
          <div className="space-y-6">
            <ContactSection />
            <ShippingAddressSection kvkkNoticePage={kvkkNoticePage} />
            <BillingSection />
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <OrderSummaryCard
              cart={cart}
              submitError={submitError}
              isSubmitting={isSubmitting}
              distanceSalesPage={distanceSalesPage}
              onOpenPreliminaryModal={() => setPreliminaryModalOpen(true)}
            />
          </div>
        </form>

        <PreliminaryInfoModal
          open={preliminaryModalOpen}
          onOpenChange={setPreliminaryModalOpen}
          cart={cart}
          preliminaryInfoPage={preliminaryInfoPage}
        />
      </div>
    </FormProvider>
  );
}
