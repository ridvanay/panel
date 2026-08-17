"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Controller, useForm, type FieldValues } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import * as contactApi from "@/lib/api/contact";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { ContactFormField, PublicContactForm } from "@/lib/api/types";

/** design-notes §Ek — public form alan çerçevesi, `--site-*` tokenleri (admin `--primary` DEĞİL). */
const FIELD_CLASSES =
  "w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground transition-colors placeholder:text-foreground/40 focus-visible:border-[var(--site-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)]/30";
const FIELD_ERROR_CLASSES = "border-danger ring-2 ring-danger/20";

function buildSchema(fields: ContactFormField[], consentRequired: boolean) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    let str: z.ZodString = z.string();
    if (field.type === "EMAIL") str = str.email("Geçerli bir e-posta adresi girin.");
    if (field.maxLength) str = str.max(field.maxLength, `En fazla ${field.maxLength} karakter olmalı.`);
    shape[field.key] = field.required ? str.min(1, "Bu alan zorunludur.") : str.optional().or(z.literal(""));
  }
  shape.consent = consentRequired
    ? z.literal(true, { message: "Devam etmek için onay kutusunu işaretleyin" })
    : z.boolean().optional();
  // Honeypot — CSS ile gizli, botlar doldurur; backend zaten kontrol ediyor, istemci sadece taşır.
  shape.website = z.string().optional();
  return z.object(shape);
}

function FormField({ field, register, error }: { field: ContactFormField; register: ReturnType<typeof useForm>["register"]; error?: string }) {
  const describedById = error ? `${field.key}-error` : field.helpText ? `${field.key}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={field.key} className="block text-sm font-medium text-foreground">
        {field.label}
        {field.required && <span className="text-danger"> *</span>}
      </label>

      {field.type === "TEXTAREA" ? (
        <textarea
          id={field.key}
          rows={4}
          placeholder={field.placeholder ?? undefined}
          aria-describedby={describedById}
          aria-invalid={error ? true : undefined}
          className={`${FIELD_CLASSES} ${error ? FIELD_ERROR_CLASSES : ""}`}
          {...register(field.key)}
        />
      ) : field.type === "SELECT" ? (
        <select
          id={field.key}
          aria-describedby={describedById}
          aria-invalid={error ? true : undefined}
          className={`${FIELD_CLASSES} ${error ? FIELD_ERROR_CLASSES : ""}`}
          {...register(field.key)}
        >
          <option value="">Seçiniz</option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={field.key}
          type={field.type === "EMAIL" ? "email" : field.type === "PHONE" ? "tel" : "text"}
          placeholder={field.placeholder ?? undefined}
          maxLength={field.maxLength ?? undefined}
          aria-describedby={describedById}
          aria-invalid={error ? true : undefined}
          className={`${FIELD_CLASSES} ${error ? FIELD_ERROR_CLASSES : ""}`}
          {...register(field.key)}
        />
      )}

      {error ? (
        <p id={`${field.key}-error`} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : (
        field.helpText && (
          <p id={`${field.key}-hint`} className="text-xs text-foreground/50">
            {field.helpText}
          </p>
        )
      )}
    </div>
  );
}

export function ContactFormClient({ form }: { form: PublicContactForm }) {
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const schema = useMemo(() => buildSchema(form.fields, form.consentRequired), [form.fields, form.consentRequired]);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FieldValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      ...Object.fromEntries(form.fields.map((f) => [f.key, ""])),
      consent: false,
      website: "",
    },
  });

  async function onSubmit(values: FieldValues) {
    setSubmitError(null);
    const { consent, website, ...rest } = values as Record<string, unknown>;
    try {
      const result = await contactApi.submitContactForm({
        values: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, String(v ?? "")])),
        consent: Boolean(consent),
        website: typeof website === "string" ? website : "",
      });
      // `successMessage` (`ContactForm.successMessage`) `PublicContactForm`'da BULUNMAZ — bu
      // yüzden gönderim yanıtındaki `message` (backend'de aynı değer) kullanılır (§10.16.8).
      setSuccessMessage(result.message);
    } catch (err) {
      setSubmitError(friendlyErrorMessage(err));
    }
  }

  if (successMessage) {
    return (
      <div className="rounded-lg border border-success/20 bg-success/10 p-4 text-sm text-success" role="status">
        {successMessage}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="mx-auto max-w-xl space-y-5">
      {form.fields.map((field) => (
        <FormField key={field.key} field={field} register={register} error={errors[field.key]?.message as string | undefined} />
      ))}

      {/* Honeypot — CSS ile gizli, tabindex=-1, autocomplete=off (§10.16.9). */}
      <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
        <label htmlFor="website">Web siteniz</label>
        <input id="website" type="text" tabIndex={-1} autoComplete="off" {...register("website")} />
      </div>

      {form.consentRequired && (
        <div className={errors.consent ? "rounded ring-2 ring-danger/30" : undefined}>
          {errors.consent && (
            <p role="alert" className="mb-1.5 text-xs text-danger">
              Devam etmek için onay kutusunu işaretleyin
            </p>
          )}
          <div className="flex items-start gap-2">
            <Controller
              control={control}
              name="consent"
              render={({ field }) => (
                <Checkbox id="consent" className="mt-0.5" checked={Boolean(field.value)} onCheckedChange={field.onChange} />
              )}
            />
            <label htmlFor="consent" className="text-sm leading-snug text-foreground/80">
              {form.consentText}{" "}
              {form.consentLegalPage && (
                <Link
                  href={`/${form.consentLegalPage.slug}`}
                  className="font-medium text-[var(--site-primary)] underline underline-offset-2 hover:opacity-80"
                >
                  Aydınlatma Metni
                </Link>
              )}
              {"'"}ni okudum, onaylıyorum.
            </label>
          </div>
        </div>
      )}

      {submitError && (
        <p role="alert" className="text-sm font-medium text-danger">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--site-button)] px-5 py-2.5 text-sm font-medium text-[var(--site-button-text)] transition-all hover:opacity-85 disabled:pointer-events-none disabled:opacity-50"
      >
        {isSubmitting && <Spinner className="h-4 w-4" />}
        {isSubmitting ? "Gönderiliyor…" : form.submitLabel}
      </button>
    </form>
  );
}
