"use client";

import { useEffect } from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { CheckoutFormValues } from "./checkout-schema";

const SEGMENT_LABEL_CLASSES =
  "relative flex h-[calc(100%-1px)] flex-1 cursor-pointer items-center justify-center rounded-md text-sm font-medium transition-all peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50";

/**
 * Kart 3 — Fatura Bilgileri (`.claude/design-notes-checkout-redesign.md` §4). DOM sırası:
 * "aynı adres" checkbox → (kapalıysa) fatura adresi 7 alanı → Bireysel/Kurumsal segmented
 * control → (seçime göre) koşullu alanlar. Bu, dokümandaki "kullanıcı önce aynı mı değil mi
 * kararını verir, sonra fatura TİPİNİ seçer" mantıksal akış sırasıdır.
 */
export function BillingSection() {
  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = useFormContext<CheckoutFormValues>();

  const billingType = useWatch({ control, name: "billing.billingType" });
  const sameAsShipping = useWatch({ control, name: "billing.sameAsShipping" });
  const isIndividual = billingType === "INDIVIDUAL";
  const isCorporate = billingType === "CORPORATE";
  const billingErr = errors.billing;
  const addrErr = billingErr?.address;

  // Fatura tipi değişince KARŞI TARAFIN alanlarını temizle — §5.2 Kural 2/3 ("yasak" alanlar)
  // hiçbir zaman DOLU submit edilmesin (bkz. `checkout-schema.ts::buildCheckoutRequest` zaten bu
  // alanları göndermiyor, bu yalnızca form state'ini/olası zod uyarısını temiz tutar).
  useEffect(() => {
    if (isIndividual) {
      setValue("billing.companyName", "");
      setValue("billing.taxOffice", "");
      setValue("billing.taxNumber", "");
    } else if (isCorporate) {
      setValue("billing.nationalId", "");
    }
  }, [isIndividual, isCorporate, setValue]);

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          3
        </span>
        <h2 className="text-base font-semibold text-foreground">Fatura Bilgileri</h2>
      </div>

      <Controller
        control={control}
        name="billing.sameAsShipping"
        render={({ field }) => (
          <label htmlFor="billing.sameAsShipping" className="mb-5 flex items-center gap-2.5 text-sm font-medium text-foreground">
            <Checkbox id="billing.sameAsShipping" checked={field.value} onCheckedChange={field.onChange} />
            Fatura adresim teslimat adresimle aynı
          </label>
        )}
      />

      {sameAsShipping === false && (
        <div className="mb-5 space-y-4 animate-in fade-in-0 slide-in-from-top-1 duration-200">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="billing.address.fullName" label="Ad Soyad" error={addrErr?.fullName?.message} required>
              {(inputProps) => <Input {...inputProps} autoComplete="name" {...register("billing.address.fullName")} />}
            </Field>
            <Field id="billing.address.phone" label="Telefon" error={addrErr?.phone?.message} required>
              {(inputProps) => <Input {...inputProps} type="tel" autoComplete="tel" {...register("billing.address.phone")} />}
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="billing.address.city" label="İl" error={addrErr?.city?.message} required>
              {(inputProps) => <Input {...inputProps} autoComplete="address-level1" {...register("billing.address.city")} />}
            </Field>
            <Field id="billing.address.district" label="İlçe" error={addrErr?.district?.message} required>
              {(inputProps) => <Input {...inputProps} autoComplete="address-level2" {...register("billing.address.district")} />}
            </Field>
          </div>
          <Field id="billing.address.neighborhood" label="Mahalle">
            {(inputProps) => <Input {...inputProps} {...register("billing.address.neighborhood")} />}
          </Field>
          <Field id="billing.address.addressLine1" label="Adres Satırı" error={addrErr?.addressLine1?.message} required>
            {(inputProps) => <Input {...inputProps} autoComplete="address-line1" {...register("billing.address.addressLine1")} />}
          </Field>
          <Field id="billing.address.addressLine2" label="Adres Satırı 2" hint="Opsiyonel.">
            {(inputProps) => <Input {...inputProps} autoComplete="address-line2" {...register("billing.address.addressLine2")} />}
          </Field>
          <div className="sm:max-w-[200px]">
            <Field id="billing.address.postalCode" label="Posta Kodu" error={addrErr?.postalCode?.message}>
              {(inputProps) => (
                <Input
                  {...inputProps}
                  inputMode="numeric"
                  maxLength={5}
                  autoComplete="postal-code"
                  {...register("billing.address.postalCode")}
                />
              )}
            </Field>
          </div>
        </div>
      )}

      <div role="radiogroup" aria-label="Fatura Tipi" className="flex h-8 w-full items-center rounded-lg bg-muted p-[3px]">
        <label
          className={cn(SEGMENT_LABEL_CLASSES, isIndividual ? "bg-background text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground")}
        >
          <input type="radio" value="INDIVIDUAL" className="peer sr-only" {...register("billing.billingType")} />
          Bireysel
        </label>
        <label
          className={cn(SEGMENT_LABEL_CLASSES, isCorporate ? "bg-background text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground")}
        >
          <input type="radio" value="CORPORATE" className="peer sr-only" {...register("billing.billingType")} />
          Kurumsal
        </label>
      </div>

      {isCorporate && (
        <div className="mt-4 space-y-4 rounded-lg border border-border/60 bg-surface-muted/50 p-4 animate-in fade-in-0 slide-in-from-top-1 duration-200">
          <Field id="billing.companyName" label="Firma Unvanı" error={billingErr?.companyName?.message} required>
            {(inputProps) => <Input {...inputProps} {...register("billing.companyName")} />}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="billing.taxOffice" label="Vergi Dairesi" hint="Opsiyonel.">
              {(inputProps) => <Input {...inputProps} {...register("billing.taxOffice")} />}
            </Field>
            <Field id="billing.taxNumber" label="Vergi No" error={billingErr?.taxNumber?.message} required>
              {(inputProps) => <Input {...inputProps} inputMode="numeric" maxLength={10} {...register("billing.taxNumber")} />}
            </Field>
          </div>
        </div>
      )}

      {isIndividual && (
        <div className="mt-4 animate-in fade-in-0 slide-in-from-top-1 duration-200">
          {/* Amaç şeffaflığı — `.claude/compliance-notes-checkout-redesign.md` §1 madde 1 (KVKK
              m.10 "açık ve anlaşılır" şartı): alanın NEDEN istendiği + zorunlu OLMADIĞI açıkça
              belirtilir; §3'teki genel KVKK Aydınlatma Metni notunun YERİNE GEÇMEZ, onunla BİRLİKTE. */}
          <Field
            id="billing.nationalId"
            label="T.C. Kimlik No"
            hint="Bireysel fatura üzerinde T.C. Kimlik No gösterilmesini istiyorsanız girin. Bu alan zorunlu değildir."
            error={billingErr?.nationalId?.message}
          >
            {(inputProps) => <Input {...inputProps} inputMode="numeric" maxLength={11} {...register("billing.nationalId")} />}
          </Field>
        </div>
      )}
    </Card>
  );
}
