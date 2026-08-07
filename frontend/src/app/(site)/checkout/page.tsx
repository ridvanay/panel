"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, CreditCard, ShoppingCart } from "lucide-react";
import { useCart } from "@/context/cart-context";
import * as checkoutApi from "@/lib/api/checkout";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPriceFromCents } from "@/lib/format-price";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const checkoutFormSchema = z.object({
  customerEmail: z.string().min(1, "E-posta gerekli.").email("Geçerli bir e-posta adresi girin."),
  customerName: z.string().optional(),
});

type CheckoutFormValues = z.infer<typeof checkoutFormSchema>;

export default function CheckoutPage() {
  const { cart, loading } = useCart();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutFormSchema),
    defaultValues: { customerEmail: "", customerName: "" },
  });

  async function onSubmit(values: CheckoutFormValues) {
    setSubmitError(null);
    try {
      const { checkoutUrl } = await checkoutApi.createCheckoutSession({
        customerEmail: values.customerEmail,
        customerName: values.customerName?.trim() ? values.customerName.trim() : undefined,
      });
      // Harici Stripe domaini — Next.js router DEĞİL, tam sayfa yönlendirme gerekir (bkz.
      // dashboard/[orgId]/billing/page.tsx AYNI patern: `.assign()`, react-compiler'ın dış
      // değişken mutasyonu kuralına takılan `window.location.href = ...` yerine).
      window.location.assign(checkoutUrl);
    } catch (err) {
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
            <Link href="/products" className="text-sm font-medium text-primary hover:underline">
              Ürünlere göz at
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Ödeme</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Ödeme sayfasına yönlendirilmeden önce iletişim bilgilerinizi girin.
        </p>
      </div>

      <Card className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground/70">Ara Toplam</span>
        <span className="text-xl font-semibold text-foreground">
          {formatPriceFromCents(cart.subtotalCents, cart.currency ?? "TRY")}
        </span>
      </Card>

      {submitError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {submitError}
          </span>
        </Alert>
      )}

      <Card>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Field id="customerEmail" label="E-posta" error={errors.customerEmail?.message} required>
            {(inputProps) => (
              <Input {...inputProps} type="email" autoComplete="email" {...register("customerEmail")} />
            )}
          </Field>
          <Field id="customerName" label="Ad Soyad" hint="Opsiyonel.">
            {(inputProps) => <Input {...inputProps} autoComplete="name" {...register("customerName")} />}
          </Field>
          <Button type="submit" className="w-full" loading={isSubmitting}>
            <CreditCard className="h-4 w-4" />
            Ödemeye Geç
          </Button>
        </form>
      </Card>
    </div>
  );
}
