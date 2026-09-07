"use client";

import Link from "next/link";
import { useFormContext } from "react-hook-form";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useLocalizePath } from "@/context/locale-alternates-context";
import type { SitePage } from "@/lib/api/types";
import type { CheckoutFormValues } from "./checkout-schema";

interface ShippingAddressSectionProps {
  /** `.claude/compliance-notes-checkout-redesign.md` §3 (RELEASE ENGELLEYİCİ) — `null` ise not
   *  yine gösterilir, yalnızca link atlanır (`resolveReturnsPolicyPage` felsefesiyle AYNI). */
  kvkkNoticePage: Pick<SitePage, "title" | "slug"> | null;
}

/**
 * Kart 2 — Teslimat Adresi (`.claude/design-notes-checkout-redesign.md` §3). Alan sırası ve
 * `id`'ler §5.2'deki Zod yollarıyla BİREBİR — 422 `error.details` eşlemesi bunlara bağlıdır.
 * `country` formda GÖSTERİLMEZ (backend `"TR"` varsayılanı, v1 tek ülke).
 */
export function ShippingAddressSection({ kvkkNoticePage }: ShippingAddressSectionProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext<CheckoutFormValues>();
  const localize = useLocalizePath();
  const err = errors.shippingAddress;

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          2
        </span>
        <h2 className="text-base font-semibold text-foreground">Teslimat Adresi</h2>
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="shippingAddress.fullName" label="Ad Soyad" error={err?.fullName?.message} required>
            {(inputProps) => <Input {...inputProps} autoComplete="name" {...register("shippingAddress.fullName")} />}
          </Field>
          <Field id="shippingAddress.phone" label="Telefon" error={err?.phone?.message} required>
            {(inputProps) => <Input {...inputProps} type="tel" autoComplete="tel" {...register("shippingAddress.phone")} />}
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="shippingAddress.city" label="İl" error={err?.city?.message} required>
            {(inputProps) => <Input {...inputProps} autoComplete="address-level1" {...register("shippingAddress.city")} />}
          </Field>
          <Field id="shippingAddress.district" label="İlçe" error={err?.district?.message} required>
            {(inputProps) => <Input {...inputProps} autoComplete="address-level2" {...register("shippingAddress.district")} />}
          </Field>
        </div>
        <Field id="shippingAddress.neighborhood" label="Mahalle">
          {(inputProps) => <Input {...inputProps} {...register("shippingAddress.neighborhood")} />}
        </Field>
        <Field id="shippingAddress.addressLine1" label="Adres Satırı" error={err?.addressLine1?.message} required>
          {(inputProps) => <Input {...inputProps} autoComplete="address-line1" {...register("shippingAddress.addressLine1")} />}
        </Field>
        <Field id="shippingAddress.addressLine2" label="Adres Satırı 2" hint="Opsiyonel.">
          {(inputProps) => <Input {...inputProps} autoComplete="address-line2" {...register("shippingAddress.addressLine2")} />}
        </Field>
        <div className="sm:max-w-[200px]">
          <Field id="shippingAddress.postalCode" label="Posta Kodu" error={err?.postalCode?.message}>
            {(inputProps) => (
              <Input {...inputProps} inputMode="numeric" maxLength={5} autoComplete="postal-code" {...register("shippingAddress.postalCode")} />
            )}
          </Field>
        </div>

        {/* KVKK Aydınlatma Metni notu — `.claude/compliance-notes-checkout-redesign.md` §3.
            Mesafeli Satış Sözleşmesi/Ön Bilgilendirme Formu onaylarının (`legal-consent-section.tsx`)
            YERİNE GEÇMEZ, ayrı bir hukuki konudur; ikisi de gereklidir. */}
        <p className="text-xs text-foreground/60">
          Bu formda paylaştığınız bilgiler KVKK kapsamında işlenir.{" "}
          {kvkkNoticePage ? (
            <Link href={localize(`/${kvkkNoticePage.slug}`)} target="_blank" className="text-primary underline-offset-4 hover:underline">
              KVKK Aydınlatma Metni
            </Link>
          ) : (
            "KVKK Aydınlatma Metni"
          )}
          {"'"}ni inceleyebilirsiniz.
        </p>
      </div>
    </Card>
  );
}
