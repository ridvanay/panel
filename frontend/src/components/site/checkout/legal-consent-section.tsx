"use client";

import Link from "next/link";
import { Controller, useFormContext } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { useLocalizePath } from "@/context/locale-alternates-context";
import type { SitePage } from "@/lib/api/types";
import type { CheckoutFormValues } from "./checkout-schema";

interface LegalConsentSectionProps {
  distanceSalesPage: Pick<SitePage, "title" | "slug"> | null;
  onOpenPreliminaryModal: () => void;
}

/**
 * `.claude/design-notes-checkout-redesign.md` §6 — kendi `Card`'ını AÇMAZ, `OrderSummaryCard`'ın
 * İÇİNE monte edilir. `Field` sarmalayıcısı KULLANILMAZ (checkbox+link kombinasyonu render-prop
 * şekline uymuyor) — hata metni `Field`'ın stiliyle AYNI sınıflarla manuel tekrarlanır.
 * Sayfa bulunamazsa (`resolve*Page` `null` dönerse) link RENDER EDİLMEZ, metin düz kalır (§3.6).
 * "Özeti görüntüle" linki `preliminary-info-modal.tsx`'i açar — sayfa çözümlemesi/gösterimi o
 * modalin kendi sorumluluğudur, bu bileşen yalnızca tetikleyicidir.
 */
export function LegalConsentSection({ distanceSalesPage, onOpenPreliminaryModal }: LegalConsentSectionProps) {
  const {
    control,
    formState: { errors },
  } = useFormContext<CheckoutFormValues>();
  const localize = useLocalizePath();

  return (
    <div className="space-y-3 border-t border-border/60 pt-4">
      <div>
        <label htmlFor="distanceSalesApproved" className="flex items-start gap-2.5 text-sm text-foreground/80">
          <Controller
            control={control}
            name="distanceSalesApproved"
            render={({ field }) => (
              <Checkbox
                id="distanceSalesApproved"
                className="mt-0.5"
                aria-invalid={errors.distanceSalesApproved ? true : undefined}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <span>
            {distanceSalesPage ? (
              <Link
                href={localize(`/${distanceSalesPage.slug}`)}
                target="_blank"
                className="text-primary underline-offset-4 hover:underline"
              >
                Mesafeli Satış Sözleşmesi
              </Link>
            ) : (
              "Mesafeli Satış Sözleşmesi"
            )}
            {"'"}ni okudum, onaylıyorum.
          </span>
        </label>
        {errors.distanceSalesApproved && (
          <p role="alert" className="pl-6 text-xs text-danger">
            {errors.distanceSalesApproved.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="preliminaryInfoApproved" className="flex items-start gap-2.5 text-sm text-foreground/80">
          <Controller
            control={control}
            name="preliminaryInfoApproved"
            render={({ field }) => (
              <Checkbox
                id="preliminaryInfoApproved"
                className="mt-0.5"
                aria-invalid={errors.preliminaryInfoApproved ? true : undefined}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <span>
            Ön Bilgilendirme Formu&apos;nu okudum, onaylıyorum.{" "}
            <button type="button" onClick={onOpenPreliminaryModal} className="text-primary underline-offset-4 hover:underline">
              (Özeti görüntüle)
            </button>
          </span>
        </label>
        {errors.preliminaryInfoApproved && (
          <p role="alert" className="pl-6 text-xs text-danger">
            {errors.preliminaryInfoApproved.message}
          </p>
        )}
      </div>
    </div>
  );
}
