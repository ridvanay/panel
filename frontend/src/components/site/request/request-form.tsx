"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CircleCheck, Info } from "lucide-react";
import { ApiClientError } from "@/lib/api/error";
import {
  CONTACT_LANGUAGES,
  CONTACT_LANGUAGE_NATIVE_NAMES,
  submitConsultationRequest,
  type ConsultationRequestBody,
  type ContactLanguage,
} from "@/lib/api/consultation-requests";
import { COUNTRY_DIAL_CODES } from "@/lib/country-codes";
import { countryName } from "@/lib/country-display";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import type { RequestStrings } from "@/lib/i18n/site-dictionaries/en/request";
import { cn } from "@/lib/utils";

/** Talep formu mesaj üst sınırı. */
export const REQUEST_MESSAGE_MAX = 1000;
const PHONE_PATTERN = /^[+0-9 ()-]{6,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RequestServiceGroup {
  slug: string;
  name: string;
  children: { slug: string; name: string }[];
}

interface FormValues {
  website: string;
  service: string;
  dateFrom: string;
  dateTo: string;
  country: string;
  contactLanguage: string;
  needsInterpreter: "yes" | "no";
  fullName: string;
  email: string;
  phone: string;
  message: string;
  contactConsent: boolean;
  healthDataConsent: boolean;
}

/**
 * Doğrulama kuralları (backend ile aynı): hizmet ya da paket zorunlu; iletişim izni zorunlu; mesaj doluysa sağlık
 * verisi açık rızası zorunlu; bitiş tarihi başlangıçtan önce olamaz.
 */
export function buildRequestSchema(t: RequestStrings, hasPackage: boolean) {
  return z
    .object({
      website: z.string(),
      service: z.string(),
      dateFrom: z.string(),
      dateTo: z.string(),
      country: z.string(),
      contactLanguage: z.string(),
      needsInterpreter: z.enum(["yes", "no"]),
      fullName: z.string(),
      email: z.string(),
      phone: z.string(),
      message: z.string().max(REQUEST_MESSAGE_MAX),
      contactConsent: z.boolean(),
      healthDataConsent: z.boolean(),
    })
    .superRefine((v, ctx) => {
      const add = (path: keyof FormValues, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
      if (!hasPackage && !v.service) add("service", t.required);
      if (!v.country) add("country", t.required);
      if (!v.fullName.trim()) add("fullName", t.required);
      const email = v.email.trim();
      if (!email) add("email", t.required);
      else if (!EMAIL_PATTERN.test(email)) add("email", t.invalidEmail);
      const phone = v.phone.trim();
      if (phone && !PHONE_PATTERN.test(phone)) add("phone", t.invalidPhone);
      if (v.dateFrom && v.dateTo && v.dateTo < v.dateFrom) add("dateTo", t.dateRangeInvalid);
      if (v.message.trim() && !v.healthDataConsent) add("healthDataConsent", t.healthConsentRequired);
      if (!v.contactConsent) add("contactConsent", t.consentContactRequired);
    });
}

const inputClass =
  "h-11 w-full rounded-[var(--site-radius)] border border-border bg-background px-3 text-base outline-none transition-all duration-300 focus-visible:ring-2 focus-visible:ring-[var(--site-primary)] aria-[invalid=true]:border-danger md:text-sm";

function Field({ label, error, htmlFor, children }: { label: string; error?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 text-sm">
      <label htmlFor={htmlFor} className="block font-semibold text-foreground">
        {label}
      </label>
      {children}
      {error && (
        <span id={`${htmlFor}-error`} role="alert" className="block text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

function subscribeNever(): () => void {
  return () => {};
}

/** Backend `details.<alan>` anahtarları → form alanı. */
const SERVER_FIELD_MAP: Record<string, keyof FormValues> = {
  serviceSlug: "service",
  packageSlug: "service",
  preferredFrom: "dateFrom",
  preferredTo: "dateTo",
  country: "country",
  contactLanguage: "contactLanguage",
  fullName: "fullName",
  email: "email",
  phone: "phone",
  message: "message",
  contactConsent: "contactConsent",
  healthDataConsent: "healthDataConsent",
};

/**
 * Paket AH — bölüm bazlı talep formu (randevu/ödeme yerine). Gönderim `POST /consultation-requests`; başarı
 * ekranı aynı sayfada (talep numarası gösterilir). Honeypot `website`, 422 alan hataları ve 429 mesajı desteklenir.
 */
export function RequestForm({
  lang,
  strings: t,
  groups,
  initialService,
  pkg,
  privacyHref,
  consentHref,
  homeHref,
  servicesHref,
  contactHref,
}: {
  lang: string;
  strings: RequestStrings;
  groups: RequestServiceGroup[];
  initialService: string | null;
  pkg: { slug: string; title: string } | null;
  privacyHref: string | null;
  consentHref: string | null;
  homeHref: string;
  servicesHref: string;
  contactHref: string;
}) {
  const intlLocale = contentLocaleToIntl(lang);
  const hasPackage = Boolean(pkg);
  const schema = useMemo(() => buildRequestSchema(t, hasPackage), [t, hasPackage]);
  const [requestNumber, setRequestNumber] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const defaultContactLanguage: ContactLanguage = (CONTACT_LANGUAGES as readonly string[]).includes(lang) ? (lang as ContactLanguage) : "en";

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      website: "",
      service: initialService ?? "",
      dateFrom: "",
      dateTo: "",
      country: "",
      contactLanguage: defaultContactLanguage,
      needsInterpreter: "no",
      fullName: "",
      email: "",
      phone: "",
      message: "",
      contactConsent: false,
      healthDataConsent: false,
    },
  });
  const [message, healthDataConsent, dateFrom] = useWatch({ control, name: ["message", "healthDataConsent", "dateFrom"] });

  // Ülke adları ICU'ya bağlı; liste yalnızca tarayıcıda oluşturulur (hidrasyon uyuşmazlığını önler).
  const isClient = useSyncExternalStore(subscribeNever, () => true, () => false);
  const countries = useMemo(
    () => (isClient ? COUNTRY_DIAL_CODES.map(([code]) => ({ code, name: countryName(code, intlLocale) })).sort((a, b) => a.name.localeCompare(b.name, intlLocale)) : []),
    [intlLocale, isClient]
  );

  const onSubmit = handleSubmit(async (v) => {
    setSubmitError(null);
    const body: ConsultationRequestBody = {
      serviceSlug: v.service || null,
      packageSlug: pkg?.slug ?? null,
      preferredFrom: v.dateFrom || null,
      preferredTo: v.dateTo || null,
      country: v.country,
      contactLanguage: v.contactLanguage as ContactLanguage,
      needsInterpreter: v.needsInterpreter === "yes",
      fullName: v.fullName.trim(),
      email: v.email.trim(),
      phone: v.phone.trim() || null,
      message: v.message.trim() || null,
      contactConsent: v.contactConsent,
      healthDataConsent: v.healthDataConsent && v.message.trim().length > 0,
      locale: lang,
      website: v.website,
    };
    try {
      const result = await submitConsultationRequest(body);
      setRequestNumber(result.requestNumber || "");
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 429) {
        setSubmitError(t.errorRateLimit);
        return;
      }
      if (err instanceof ApiClientError && err.details) {
        let mapped = false;
        for (const [key, messages] of Object.entries(err.details)) {
          const field = SERVER_FIELD_MAP[key];
          if (!field) continue;
          setError(field, { message: messages[0] || t.required });
          mapped = true;
        }
        setSubmitError(mapped ? t.errorFields : t.errorGeneric);
        return;
      }
      setSubmitError(t.errorGeneric);
    }
  });

  if (requestNumber !== null) {
    return (
      <section aria-labelledby="request-success-title" className="rounded-[var(--site-radius)] border border-border bg-surface p-6 sm:p-8" data-testid="request-success">
        <div role="status">
          <h2 id="request-success-title" className="flex items-center gap-2 font-heading text-xl font-semibold text-foreground">
            <CircleCheck className="h-6 w-6 shrink-0 text-success" aria-hidden="true" />
            {t.successTitle}
          </h2>
          {requestNumber && (
            <p className="mt-3 text-base font-medium text-foreground" data-testid="request-number">
              {t.successNumber.replace("{number}", requestNumber)}
            </p>
          )}
          <p className="mt-2 text-sm text-foreground/80">{t.successText}</p>
          <p className="mt-1 text-sm text-foreground/70">{t.successEmail}</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={homeHref}
            className="inline-flex min-h-11 items-center rounded-[var(--site-radius)] bg-[var(--site-primary)] px-5 text-sm font-semibold text-white transition-opacity duration-300 hover:opacity-90"
          >
            {t.successHome}
          </Link>
          <Link
            href={servicesHref}
            className="inline-flex min-h-11 items-center rounded-[var(--site-radius)] border border-[var(--site-primary)] px-5 text-sm font-semibold text-[var(--site-primary)] transition-colors duration-300 hover:bg-[var(--site-primary)]/5"
          >
            {t.successServices}
          </Link>
        </div>
      </section>
    );
  }

  const noServices = groups.length === 0 && !pkg;

  return (
    <form onSubmit={onSubmit} noValidate aria-label={t.formAria} className="space-y-5 rounded-[var(--site-radius)] border border-border bg-surface p-4 sm:p-6" data-testid="request-form">
      {/* Honeypot: insanlara görünmez ve odaklanılamaz; botlar doldurur. */}
      <div aria-hidden="true" className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" tabIndex={-1} autoComplete="off" {...register("website")} data-testid="request-website" />
        </label>
      </div>

      {pkg ? (
        <div className="rounded-[var(--site-radius)] border border-[var(--site-primary)]/30 bg-[var(--site-primary)]/5 p-3 text-sm" data-testid="request-package">
          <span className="block text-xs font-semibold uppercase tracking-wide text-foreground/70">{t.packageLabel}</span>
          <span className="font-semibold text-foreground">{pkg.title}</span>
        </div>
      ) : null}

      {noServices ? (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-foreground" data-testid="request-services-unavailable">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            {t.servicesUnavailable}{" "}
            <Link href={contactHref} className="font-semibold underline">
              {t.contactPageLink}
            </Link>
          </p>
        </div>
      ) : (
        <Field label={t.serviceLabel} htmlFor="request-service" error={errors.service?.message}>
          <select
            id="request-service"
            aria-invalid={Boolean(errors.service)}
            aria-describedby={errors.service ? "request-service-error" : undefined}
            className={inputClass}
            {...register("service")}
          >
            <option value="">{t.servicePlaceholder}</option>
            {groups.map((group) =>
              group.children.length > 0 ? (
                <optgroup key={group.slug} label={group.name}>
                  <option value={group.slug}>{t.serviceGeneralOption.replace("{service}", group.name)}</option>
                  {group.children.map((child) => (
                    <option key={child.slug} value={child.slug}>
                      {child.name}
                    </option>
                  ))}
                </optgroup>
              ) : (
                <option key={group.slug} value={group.slug}>
                  {group.name}
                </option>
              )
            )}
          </select>
        </Field>
      )}

      <fieldset className="space-y-1 text-sm">
        <legend className="font-semibold text-foreground">{t.datesLabel}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-foreground/70">{t.dateFromLabel}</span>
            <input type="date" className={inputClass} aria-invalid={Boolean(errors.dateFrom)} {...register("dateFrom")} data-testid="request-date-from" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-foreground/70">{t.dateToLabel}</span>
            <input type="date" min={dateFrom || undefined} className={inputClass} aria-invalid={Boolean(errors.dateTo)} {...register("dateTo")} data-testid="request-date-to" />
          </label>
        </div>
        {(errors.dateFrom?.message || errors.dateTo?.message) && (
          <span role="alert" className="block text-xs text-danger">
            {errors.dateTo?.message ?? errors.dateFrom?.message}
          </span>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.countryLabel} htmlFor="request-country" error={errors.country?.message}>
          <select
            id="request-country"
            autoComplete="country"
            aria-invalid={Boolean(errors.country)}
            aria-describedby={errors.country ? "request-country-error" : undefined}
            className={inputClass}
            {...register("country")}
          >
            <option value="">{t.countryPlaceholder}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.contactLanguageLabel} htmlFor="request-contact-language" error={errors.contactLanguage?.message}>
          <select id="request-contact-language" className={inputClass} {...register("contactLanguage")}>
            {CONTACT_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {CONTACT_LANGUAGE_NATIVE_NAMES[code]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset className="space-y-2 text-sm">
        <legend className="font-semibold text-foreground">{t.interpreterLabel}</legend>
        <div className="flex gap-6">
          <label className="inline-flex min-h-11 items-center gap-2">
            <input type="radio" value="yes" className="h-4 w-4 accent-[var(--site-primary)]" {...register("needsInterpreter")} data-testid="request-interpreter-yes" />
            {t.interpreterYes}
          </label>
          <label className="inline-flex min-h-11 items-center gap-2">
            <input type="radio" value="no" className="h-4 w-4 accent-[var(--site-primary)]" {...register("needsInterpreter")} data-testid="request-interpreter-no" />
            {t.interpreterNo}
          </label>
        </div>
      </fieldset>

      <Field label={t.fullNameLabel} htmlFor="request-full-name" error={errors.fullName?.message}>
        <input
          id="request-full-name"
          type="text"
          autoComplete="name"
          aria-invalid={Boolean(errors.fullName)}
          aria-describedby={errors.fullName ? "request-full-name-error" : undefined}
          className={inputClass}
          {...register("fullName")}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.emailLabel} htmlFor="request-email" error={errors.email?.message}>
          <input
            id="request-email"
            type="email"
            dir="ltr"
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "request-email-error" : undefined}
            className={inputClass}
            {...register("email")}
          />
        </Field>
        <Field label={t.phoneLabel} htmlFor="request-phone" error={errors.phone?.message}>
          <input
            id="request-phone"
            type="tel"
            dir="ltr"
            autoComplete="tel"
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={errors.phone ? "request-phone-error" : undefined}
            className={inputClass}
            {...register("phone")}
          />
        </Field>
      </div>

      <div className="space-y-1 text-sm">
        <label htmlFor="request-message" className="block font-semibold text-foreground">
          {t.messageLabel}
        </label>
        <textarea
          id="request-message"
          rows={4}
          maxLength={REQUEST_MESSAGE_MAX}
          aria-describedby="request-message-notice"
          aria-invalid={Boolean(errors.message)}
          className="w-full rounded-[var(--site-radius)] border border-border bg-background px-3 py-2 text-base outline-none transition-all duration-300 focus-visible:ring-2 focus-visible:ring-[var(--site-primary)] aria-[invalid=true]:border-danger md:text-sm"
          {...register("message")}
        />
        <div className="flex items-start justify-between gap-3 text-xs text-foreground/70">
          <p id="request-message-notice" data-testid="request-message-notice">
            {t.messageNotice}
          </p>
          <p aria-live="off" className="shrink-0" data-testid="request-message-counter">
            {t.messageCounter.replace("{n}", String(message.length)).replace("{max}", String(REQUEST_MESSAGE_MAX))}
          </p>
        </div>
        {errors.message?.message && (
          <span role="alert" className="block text-xs text-danger">
            {errors.message.message}
          </span>
        )}
      </div>

      <div className="space-y-3 rounded-[var(--site-radius)] border border-border bg-background p-3 text-sm">
        <div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[var(--site-primary)]"
              aria-invalid={Boolean(errors.contactConsent)}
              {...register("contactConsent")}
              data-testid="request-consent-contact"
            />
            <span>
              {t.consentContact}{" "}
              {privacyHref && (
                <Link href={privacyHref} target="_blank" className="font-medium text-[var(--site-link,var(--site-primary))] underline">
                  {t.privacyNoticeLink}
                </Link>
              )}
            </span>
          </label>
          {errors.contactConsent?.message && (
            <span role="alert" className="mt-1 block text-xs text-danger" data-testid="request-consent-contact-error">
              {errors.contactConsent.message}
            </span>
          )}
        </div>
        <div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[var(--site-primary)]"
              aria-invalid={Boolean(errors.healthDataConsent)}
              {...register("healthDataConsent")}
              data-testid="request-consent-health"
            />
            <span>
              {t.consentHealth}{" "}
              {consentHref && (
                <Link href={consentHref} target="_blank" className="font-medium text-[var(--site-link,var(--site-primary))] underline">
                  {t.consentHealthLink}
                </Link>
              )}
            </span>
          </label>
          {(errors.healthDataConsent?.message || (message.trim().length > 0 && !healthDataConsent)) && (
            <span role="alert" className="mt-1 block text-xs font-medium text-warning" data-testid="request-consent-health-error">
              {errors.healthDataConsent?.message ?? t.healthConsentRequired}
            </span>
          )}
        </div>
      </div>

      {submitError && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" data-testid="request-error">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting || noServices}
        className={cn(
          "inline-flex min-h-11 w-full items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-primary)] px-6 text-sm font-semibold text-white transition-all duration-300 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)] disabled:opacity-60 sm:w-auto"
        )}
        data-testid="request-submit"
      >
        {isSubmitting ? t.submitting : t.submit}
      </button>
    </form>
  );
}
