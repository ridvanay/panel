"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { useWatch } from "react-hook-form";
import { z } from "zod";
import {
  CONTACT_LANGUAGES,
  CONTACT_LANGUAGE_NATIVE_NAMES,
  PREFERRED_CONTACT_CHANNELS,
  type ContactLanguage,
  type PreferredContactChannel,
} from "@/lib/api/consultation-requests";
import { COUNTRY_DIAL_CODES, dialCodeFor } from "@/lib/country-codes";
import { countryName } from "@/lib/country-display";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import type { RequestStrings } from "@/lib/i18n/site-dictionaries/en/request";
import type { ServiceBookingStrings } from "@/lib/i18n/site-dictionaries/en/service-booking";
import { EMAIL_PATTERN, PHONE_PATTERN, REQUEST_MESSAGE_MAX, composePhone } from "@/components/site/request/request-form";
import { cn } from "@/lib/utils";

/** Rıza metni sürümü (sunucu `service-consultation-v1` kaydeder; istemci yalnızca bilgi olarak gönderir). */
export const SERVICE_CONSULTATION_CONSENT_VERSION = "service-consultation-v1";

export interface DetailsFormValues {
  website: string;
  country: string;
  contactLanguage: string;
  needsInterpreter: boolean;
  interpreterLanguage: string;
  fullName: string;
  email: string;
  dial: string;
  phone: string;
  channel: PreferredContactChannel;
  message: string;
  contactConsent: boolean;
  healthDataConsent: boolean;
}

/** Bilgiler adımında doğrulanan alanlar. */
export const DETAILS_STEP_FIELDS: (keyof DetailsFormValues)[] = [
  "country",
  "contactLanguage",
  "interpreterLanguage",
  "fullName",
  "email",
  "dial",
  "phone",
  "channel",
  "message",
  "contactConsent",
  "healthDataConsent",
];

/**
 * AH talep formuyla AYNI kurallar: iletişim izni zorunlu; mesaj doluysa sağlık verisi açık rızası zorunlu;
 * WhatsApp/telefon kanalı için numara gerekir. (Sunucu da aynısını doğrular.)
 */
export function buildDetailsSchema(t: RequestStrings) {
  return z
    .object({
      website: z.string(),
      country: z.string(),
      contactLanguage: z.string(),
      needsInterpreter: z.boolean(),
      interpreterLanguage: z.string(),
      fullName: z.string(),
      email: z.string(),
      dial: z.string(),
      phone: z.string(),
      channel: z.enum(PREFERRED_CONTACT_CHANNELS),
      message: z.string().max(REQUEST_MESSAGE_MAX),
      contactConsent: z.boolean(),
      healthDataConsent: z.boolean(),
    })
    .superRefine((v, ctx) => {
      const add = (path: keyof DetailsFormValues, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
      if (!v.country) add("country", t.required);
      if (!v.fullName.trim()) add("fullName", t.required);
      const email = v.email.trim();
      if (!email) add("email", t.required);
      else if (!EMAIL_PATTERN.test(email)) add("email", t.invalidEmail);
      const phone = composePhone(v.dial, v.phone);
      if (phone && !PHONE_PATTERN.test(phone)) add("phone", t.invalidPhone);
      else if (!phone && v.channel !== "email") add("phone", t.channelPhoneNeeded);
      if (v.message.trim() && !v.healthDataConsent) add("healthDataConsent", t.healthConsentRequired);
      if (!v.contactConsent) add("contactConsent", t.consentContactRequired);
    });
}

const inputClass =
  "h-11 w-full rounded-[var(--site-radius)] border border-border bg-background px-3 text-base outline-none transition-all duration-300 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)] disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger md:text-sm";

function Field({ label, error, htmlFor, children }: { label: string; error?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 text-sm">
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

const UNIQUE_DIAL_CODES = Array.from(new Set(COUNTRY_DIAL_CODES.map(([, dial]) => dial))).sort((a, b) => Number(a) - Number(b));

/**
 * Bilgiler + rıza adımı. Alanlar ve kurallar AH talep formuyla aynıdır (metinler `dict.request`ten gelir); hizmet
 * görüşmesine özgü: tercüman dili, "ayrıntılı sağlık bilgisi paylaşmayın" uyarısı ve aracı kuruluş/tıbbi muayene notu.
 */
export function ServiceBookingDetailsStep({
  form,
  strings: s,
  requestStrings: t,
  lang,
  privacyHref,
  consentHref,
}: {
  form: UseFormReturn<DetailsFormValues>;
  strings: ServiceBookingStrings;
  requestStrings: RequestStrings;
  lang: string;
  privacyHref: string | null;
  consentHref: string | null;
}) {
  const intlLocale = contentLocaleToIntl(lang);
  const {
    register,
    setValue,
    control,
    formState: { errors },
  } = form;
  const values = useWatch({ control });
  const message = values.message ?? "";
  const [countryQuery, setCountryQuery] = useState("");
  const [dialTouched, setDialTouched] = useState(false);

  const isClient = useSyncExternalStore(subscribeNever, () => true, () => false);
  const countries = useMemo(
    () => (isClient ? COUNTRY_DIAL_CODES.map(([code]) => ({ code, name: countryName(code, intlLocale) })).sort((a, b) => a.name.localeCompare(b.name, intlLocale)) : []),
    [intlLocale, isClient]
  );
  const countryNeedle = countryQuery.trim().toLocaleLowerCase(intlLocale);
  const filteredCountries = useMemo(() => {
    if (!countryNeedle) return countries;
    const list = countries.filter((c) => c.name.toLocaleLowerCase(intlLocale).includes(countryNeedle));
    const selected = countries.find((c) => c.code === values.country);
    return selected && !list.some((c) => c.code === selected.code) ? [selected, ...list] : list;
  }, [countries, countryNeedle, intlLocale, values.country]);

  const channelLabels: Record<PreferredContactChannel, string> = { email: t.channelEmail, whatsapp: t.channelWhatsapp, phone: t.channelPhone };

  return (
    <div className="space-y-6" data-testid="service-booking-details">
      <p className="text-sm text-foreground/70">{s.detailsHint}</p>

      {/* Honeypot: insanlara görünmez ve odaklanılamaz; botlar doldurur. */}
      <div aria-hidden="true" className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" tabIndex={-1} autoComplete="off" {...register("website")} data-testid="booking-website" />
        </label>
      </div>

      <Field label={t.fullNameLabel} htmlFor="booking-full-name" error={errors.fullName?.message}>
        <input
          id="booking-full-name"
          type="text"
          autoComplete="name"
          aria-invalid={Boolean(errors.fullName)}
          aria-describedby={errors.fullName ? "booking-full-name-error" : undefined}
          className={inputClass}
          {...register("fullName")}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t.emailLabel} htmlFor="booking-email" error={errors.email?.message}>
          <input
            id="booking-email"
            type="email"
            dir="ltr"
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "booking-email-error" : undefined}
            className={inputClass}
            {...register("email")}
          />
        </Field>
        <div className="space-y-1.5 text-sm">
          <label htmlFor="booking-phone" className="block font-semibold text-foreground">
            {t.phoneLabel}
          </label>
          <div className="flex gap-2">
            <select
              aria-label={t.dialCodeLabel}
              dir="ltr"
              className={cn(inputClass, "w-24 shrink-0 px-2")}
              {...register("dial", { onChange: () => setDialTouched(true) })}
              data-testid="booking-dial"
            >
              <option value="">+</option>
              {UNIQUE_DIAL_CODES.map((dial) => (
                <option key={dial} value={dial}>
                  +{dial}
                </option>
              ))}
            </select>
            <input
              id="booking-phone"
              type="tel"
              dir="ltr"
              autoComplete="tel-national"
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? "booking-phone-error" : undefined}
              className={inputClass}
              {...register("phone")}
            />
          </div>
          {errors.phone?.message && (
            <span id="booking-phone-error" role="alert" className="block text-xs text-danger">
              {errors.phone.message}
            </span>
          )}
        </div>
      </div>

      <fieldset className="space-y-2 text-sm">
        <legend className="font-semibold text-foreground">{t.preferredChannelLabel}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {PREFERRED_CONTACT_CHANNELS.map((channel) => (
            <label key={channel} className="block">
              <input type="radio" value={channel} className="peer sr-only" {...register("channel")} data-testid={`booking-channel-${channel}`} />
              <span className="flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--site-radius)] border border-border bg-background px-4 text-sm font-medium transition-all duration-300 motion-reduce:transition-none hover:border-[var(--site-primary)]/50 peer-checked:border-[var(--site-primary)] peer-checked:bg-[var(--site-primary)]/5 peer-checked:text-[var(--site-primary)] peer-checked:ring-1 peer-checked:ring-[var(--site-primary)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--site-primary)] peer-focus-visible:ring-offset-2">
                {channelLabels[channel]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label={t.countryLabel} htmlFor="booking-country" error={errors.country?.message}>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-foreground/50" aria-hidden="true" />
          <input
            type="search"
            value={countryQuery}
            onChange={(e) => setCountryQuery(e.target.value)}
            placeholder={t.countrySearchPlaceholder}
            aria-label={t.countrySearchPlaceholder}
            autoComplete="off"
            className={cn(inputClass, "ps-10")}
            data-testid="booking-country-search"
          />
        </div>
        <select
          id="booking-country"
          autoComplete="country"
          aria-invalid={Boolean(errors.country)}
          aria-describedby={errors.country ? "booking-country-error" : undefined}
          className={inputClass}
          {...register("country", {
            onChange: (e: { target: { value: string } }) => {
              if (!dialTouched) setValue("dial", dialCodeFor(e.target.value) ?? "");
            },
          })}
        >
          <option value="">{t.countryPlaceholder}</option>
          {filteredCountries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t.contactLanguageLabel} htmlFor="booking-contact-language" error={errors.contactLanguage?.message}>
          <select id="booking-contact-language" className={inputClass} {...register("contactLanguage")}>
            {CONTACT_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {CONTACT_LANGUAGE_NATIVE_NAMES[code]}
              </option>
            ))}
          </select>
        </Field>
        <div className="space-y-1.5 text-sm">
          <span id="booking-interpreter-label" className="block font-semibold text-foreground">
            {t.interpreterLabel}
          </span>
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              role="switch"
              aria-labelledby="booking-interpreter-label"
              aria-describedby="booking-interpreter-hint"
              className="peer sr-only"
              {...register("needsInterpreter")}
              data-testid="booking-interpreter"
            />
            <span
              aria-hidden="true"
              className="relative h-6 w-11 shrink-0 rounded-full bg-foreground/25 transition-colors duration-300 motion-reduce:transition-none after:absolute after:start-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-all after:duration-300 motion-reduce:after:transition-none peer-checked:bg-[var(--site-primary)] peer-checked:after:translate-x-5 rtl:peer-checked:after:-translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--site-primary)] peer-focus-visible:ring-offset-2"
            />
            <span>{values.needsInterpreter ? t.interpreterYes : t.interpreterNo}</span>
          </label>
          <p id="booking-interpreter-hint" className="text-xs text-foreground/70">
            {t.interpreterHint}
          </p>
        </div>
      </div>

      {values.needsInterpreter && (
        <Field label={s.interpreterLanguageLabel} htmlFor="booking-interpreter-language" error={errors.interpreterLanguage?.message}>
          <select id="booking-interpreter-language" className={inputClass} {...register("interpreterLanguage")} data-testid="booking-interpreter-language">
            {CONTACT_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {CONTACT_LANGUAGE_NATIVE_NAMES[code as ContactLanguage]}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="space-y-1.5 text-sm">
        <label htmlFor="booking-message" className="block font-semibold text-foreground">
          {t.messageLabel}
        </label>
        <textarea
          id="booking-message"
          rows={4}
          maxLength={REQUEST_MESSAGE_MAX}
          aria-describedby="booking-message-notice"
          aria-invalid={Boolean(errors.message)}
          className="w-full rounded-[var(--site-radius)] border border-border bg-background px-3 py-2 text-base outline-none transition-all duration-300 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)] aria-[invalid=true]:border-danger md:text-sm"
          {...register("message")}
        />
        <div className="flex items-start justify-between gap-3 text-xs text-foreground/70">
          <p id="booking-message-notice" data-testid="booking-message-notice">
            {t.messageNotice}
          </p>
          <p aria-live="off" className="shrink-0">
            {t.messageCounter.replace("{n}", String(message.length)).replace("{max}", String(REQUEST_MESSAGE_MAX))}
          </p>
        </div>
        {errors.message?.message && (
          <span role="alert" className="block text-xs text-danger">
            {errors.message.message}
          </span>
        )}
      </div>

      <div className="space-y-4 rounded-[var(--site-radius)] border border-border bg-background p-4 text-sm">
        <div>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-[var(--site-primary)]"
              aria-invalid={Boolean(errors.contactConsent)}
              {...register("contactConsent")}
              data-testid="booking-consent-contact"
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
            <span role="alert" className="mt-1 block text-xs text-danger" data-testid="booking-consent-contact-error">
              {errors.contactConsent.message}
            </span>
          )}
        </div>
        <div>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-[var(--site-primary)]"
              aria-invalid={Boolean(errors.healthDataConsent)}
              {...register("healthDataConsent")}
              data-testid="booking-consent-health"
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
          {(errors.healthDataConsent?.message || (message.trim().length > 0 && !values.healthDataConsent)) && (
            <span role="alert" className="mt-1 block text-xs font-medium text-danger" data-testid="booking-consent-health-error">
              {errors.healthDataConsent?.message ?? t.healthConsentRequired}
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-foreground/60" data-testid="booking-medical-note">
        {s.medicalNote}
      </p>
    </div>
  );
}
