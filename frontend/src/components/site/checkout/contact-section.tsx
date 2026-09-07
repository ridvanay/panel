"use client";

import { useFormContext } from "react-hook-form";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { CheckoutFormValues } from "./checkout-schema";

/**
 * Kart 1 — İletişim (`.claude/design-notes-checkout-redesign.md` §3). Telefon BURADA YOK —
 * kontrat telefonu her adres bloğunun kendi `phone` alanı olarak taşıyor; bu kart yalnızca
 * e-posta/ad soyad'tan sorumludur (bugünkü sayfayla birebir aynı kapsam).
 */
export function ContactSection() {
  const {
    register,
    formState: { errors },
  } = useFormContext<CheckoutFormValues>();

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          1
        </span>
        <h2 className="text-base font-semibold text-foreground">İletişim</h2>
      </div>
      <div className="space-y-4">
        <Field id="customerEmail" label="E-posta" error={errors.customerEmail?.message} required>
          {(inputProps) => <Input {...inputProps} type="email" autoComplete="email" {...register("customerEmail")} />}
        </Field>
        <Field id="customerName" label="Ad Soyad" hint="Opsiyonel.">
          {(inputProps) => <Input {...inputProps} autoComplete="name" {...register("customerName")} />}
        </Field>
      </div>
    </Card>
  );
}
