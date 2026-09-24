"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import * as contactApi from "@/lib/api/contact";
import { ApiClientError } from "@/lib/api/error";
import { COUNTRY_DIAL_CODES, COUNTRY_CODES } from "@/lib/country-codes";
import type { ContactMethod, ContactPageLocale, ContactPageSubmissionRequest } from "@/lib/api/types";
import type { ContactStrings } from "@/lib/i18n/site-dictionaries";
import { cn } from "@/lib/utils";

/**
 * `/contact` formu. Gönderim TARAYICIDAN doğrudan API'ye (`POST /contact/page-submissions`)
 * yapılır — Next.js sunucusu aracı değildir, backend rate limiti gerçek ziyaretçi IP'sine işler.
 *
 * Doğrulama hem burada hem sunucuda; hata alanın altında (`aria-describedby`), gönderimde ilk
 * hatalı alana odaklanılır. Hata durumunda girilen veri KORUNUR. Onay metinleri sunucudan gelir
 * (gösterilen = saklanan). Spam: gizli `website` alanı + imzalı zaman damgası; damga alındıktan
 * sonra en az 3,2 sn geçmeden istek gönderilmez (sunucu 3 sn'den hızlı gönderimi sessizce SPAM
 * sayar — gerçek bir ziyaretçinin buna takılmaması için).
 */

const MIN_TOKEN_AGE_MS = 3_200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9 ()-]{4,20}$/;

type FieldName =
  | "fullName"
  | "email"
  | "phoneCountry"
  | "phoneNumber"
  | "country"
  | "treatment"
  | "contactMethod"
  | "message"
  | "noticeAccepted"
  | "explicitConsent";

/** Odak sırası — DOM sırasıyla aynı. */
const FIELD_ORDER: FieldName[] = [
  "fullName",
  "email",
  "phoneCountry",
  "phoneNumber",
  "country",
  "treatment",
  "explicitConsent",
  "contactMethod",
  "message",
  "noticeAccepted",
];

interface FormValues {
  fullName: string;
  email: string;
  phoneCountry: string;
  phoneNumber: string;
  country: string;
  treatment: string;
  contactMethod: ContactMethod;
  message: string;
  noticeAccepted: boolean;
  explicitConsent: boolean;
  website: string;
}

export interface ContactPageFormProps {
  dict: ContactStrings;
  locale: ContactPageLocale;
  /** Intl ülke adları için dil (ör. "tr", "en"). */
  displayLocale: string;
  consent: { notice: string; explicit: string; privacyLinkLabel: string };
  privacyHref: string | null;
  treatments: { slug: string; name: string }[];
  treatmentNotSure: string;
  responseTime: string;
  defaultPhoneCountry: string;
  /** Damga alındıktan sonra gönderim öncesi asgari bekleme — yalnızca testlerde değiştirilir. */
  minTokenAgeMs?: number;
}

function emptyValues(defaultPhoneCountry: string): FormValues {
  return {
    fullName: "",
    email: "",
    phoneCountry: defaultPhoneCountry,
    phoneNumber: "",
    country: "",
    treatment: "",
    contactMethod: "email",
    message: "",
    noticeAccepted: false,
    explicitConsent: false,
    website: "",
  };
}

function isSpecialtyTreatment(value: string, notSure: string) {
  return value !== "" && value !== notSure;
}

export function validateContactPage(values: FormValues, dict: ContactStrings, notSure: string): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {};
  const name = values.fullName.trim();
  if (name.length < 2) errors.fullName = dict.errorRequired;
  else if (name.length > 120) errors.fullName = dict.errorTooLong;

  const email = values.email.trim();
  if (!email) errors.email = dict.errorRequired;
  else if (email.length > 254 || !EMAIL_PATTERN.test(email)) errors.email = dict.errorInvalidEmail;

  const phone = values.phoneNumber.trim();
  if (phone && (!PHONE_PATTERN.test(phone) || phone.replace(/\D/g, "").length < 4)) errors.phoneNumber = dict.errorInvalidPhone;
  if (!phone && values.contactMethod !== "email") errors.phoneNumber = dict.errorPhoneRequiredForMethod;
  if (phone && !values.phoneCountry) errors.phoneCountry = dict.errorPhoneCountryRequired;
  if (values.country && !COUNTRY_CODES.has(values.country)) errors.country = dict.errorInvalidCountry;

  const message = values.message.trim();
  if (!message) errors.message = dict.errorRequired;
  else if (message.length > 3000) errors.message = dict.errorTooLong;

  if (!values.noticeAccepted) errors.noticeAccepted = dict.errorNoticeRequired;
  if (isSpecialtyTreatment(values.treatment, notSure) && !values.explicitConsent) {
    errors.explicitConsent = dict.errorExplicitConsentRequired;
  }
  return errors;
}

/** Sunucu hata kodu → sözlük mesajı (sunucu metni gösterilmez; dil tutarlılığı). */
function serverErrorMessage(field: FieldName, code: string, dict: ContactStrings): string {
  if (field === "noticeAccepted") return dict.errorNoticeRequired;
  if (field === "explicitConsent") return dict.errorExplicitConsentRequired;
  switch (code) {
    case "invalid_email":
      return dict.errorInvalidEmail;
    case "invalid_phone":
      return dict.errorInvalidPhone;
    case "phone_required_for_method":
      return dict.errorPhoneRequiredForMethod;
    case "invalid_country":
      return dict.errorInvalidCountry;
    case "too_long":
      return dict.errorTooLong;
    case "invalid_treatment":
      return dict.errorInvalidTreatment;
    default:
      return field === "phoneCountry" ? dict.errorPhoneCountryRequired : dict.errorRequired;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const INPUT_CLASS =
  "block w-full rounded-xl border border-border bg-surface px-4 text-base text-foreground placeholder:text-foreground/45 transition-colors focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/25 aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20";

/** Onay metnindeki gizlilik bağlantısı etiketini gerçek bir bağlantıya çevirir. */
function withPrivacyLink(text: string, label: string, href: string | null): ReactNode {
  const index = href ? text.indexOf(label) : -1;
  if (!href || index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <Link href={href} target="_blank" rel="noopener" className="font-medium text-primary underline underline-offset-2">
        {label}
      </Link>
      {text.slice(index + label.length)}
    </>
  );
}

export function ContactPageForm({
  dict,
  locale,
  displayLocale,
  consent,
  privacyHref,
  treatments,
  treatmentNotSure,
  responseTime,
  defaultPhoneCountry,
  minTokenAgeMs = MIN_TOKEN_AGE_MS,
}: ContactPageFormProps) {
  const idBase = useId();
  const id = (name: string) => `${idBase}-${name}`;
  const [values, setValues] = useState<FormValues>(() => emptyValues(defaultPhoneCountry));
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const tokenRef = useRef<{ token: string; fetchedAt: number } | null>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);
  const fieldRefs = useRef<Partial<Record<FieldName, HTMLElement | null>>>({});

  const countries = useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([displayLocale], { type: "region" });
    } catch {
      names = null;
    }
    return COUNTRY_DIAL_CODES.map(([code, dial]) => ({ code, dial, name: names?.of(code) ?? code })).sort((a, b) =>
      a.name.localeCompare(b.name, displayLocale)
    );
  }, [displayLocale]);

  const fetchToken = useCallback(async () => {
    const { token } = await contactApi.getContactPageToken();
    tokenRef.current = { token, fetchedAt: Date.now() };
    return tokenRef.current;
  }, []);

  useEffect(() => {
    fetchToken().catch(() => {
      tokenRef.current = null;
    });
  }, [fetchToken]);

  useEffect(() => {
    if (done) successHeadingRef.current?.focus();
  }, [done]);

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      // Tedavi değişince açık rıza sıfırlanır — varsayılan işaretsiz, her seçim için ayrı rıza.
      if (key === "treatment") next.explicitConsent = false;
      return next;
    });
    if (errors[key as FieldName]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function focusFirstError(found: Partial<Record<FieldName, string>>) {
    const first = FIELD_ORDER.find((name) => found[name]);
    if (first) fieldRefs.current[first]?.focus();
  }

  async function send(attempt = 0): Promise<void> {
    const current = tokenRef.current ?? (await fetchToken());
    const elapsed = Date.now() - current.fetchedAt;
    if (elapsed < minTokenAgeMs) await wait(minTokenAgeMs - elapsed);

    const treatmentIsSpecialty = isSpecialtyTreatment(values.treatment, treatmentNotSure);
    const body: ContactPageSubmissionRequest = {
      token: current.token,
      website: values.website,
      locale,
      fullName: values.fullName.trim(),
      email: values.email.trim(),
      contactMethod: values.contactMethod,
      message: values.message.trim(),
      noticeAccepted: values.noticeAccepted,
      ...(values.phoneNumber.trim() ? { phoneNumber: values.phoneNumber.trim(), phoneCountry: values.phoneCountry } : {}),
      ...(values.country ? { country: values.country } : {}),
      ...(values.treatment ? { treatment: values.treatment } : {}),
      ...(treatmentIsSpecialty ? { explicitConsent: values.explicitConsent } : {}),
    };

    try {
      await contactApi.submitContactPage(body);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "CONTACT_FORM_TOKEN_INVALID" && attempt === 0) {
        tokenRef.current = null;
        await fetchToken();
        return send(1);
      }
      throw err;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const found = validateContactPage(values, dict, treatmentNotSure);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setFormError(dict.errorSummary);
      focusFirstError(found);
      return;
    }

    setSubmitting(true);
    try {
      await send();
      setDone(true);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 422 && err.details && err.code !== "CONTACT_FORM_TOKEN_INVALID") {
        const mapped: Partial<Record<FieldName, string>> = {};
        for (const [key, codes] of Object.entries(err.details)) {
          if ((FIELD_ORDER as string[]).includes(key)) mapped[key as FieldName] = serverErrorMessage(key as FieldName, codes[0] ?? "", dict);
        }
        setErrors(mapped);
        setFormError(dict.errorSummary);
        focusFirstError(mapped);
      } else if (err instanceof ApiClientError && err.status === 429) {
        setFormError(dict.errorRateLimited);
      } else if (err instanceof ApiClientError && err.code === "CONTACT_FORM_TOKEN_INVALID") {
        setFormError(dict.errorFormExpired);
      } else {
        setFormError(dict.errorGeneric);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setValues(emptyValues(defaultPhoneCountry));
    setErrors({});
    setFormError(null);
    setDone(false);
    tokenRef.current = null;
    fetchToken().catch(() => undefined);
  }

  if (done) {
    return (
      <div role="status" className="flex flex-col items-start gap-4 py-6">
        <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
        <h2 ref={successHeadingRef} tabIndex={-1} className="text-2xl font-semibold text-foreground outline-none">
          {dict.successTitle}
        </h2>
        <p className="text-base leading-relaxed text-[var(--about-body-text)]">{dict.successBody}</p>
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center rounded-full border border-primary px-5 text-base font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
        >
          {dict.sendAnother}
        </button>
      </div>
    );
  }

  const describedBy = (name: FieldName, ...extra: (string | false)[]) =>
    [errors[name] ? id(`${name}-error`) : false, ...extra].filter(Boolean).join(" ") || undefined;
  const errorText = (name: FieldName) =>
    errors[name] ? (
      <p id={id(`${name}-error`)} className="mt-1.5 text-sm text-danger">
        {errors[name]}
      </p>
    ) : null;
  const requiredStar = (
    <span className="text-danger" aria-hidden="true">
      {" "}
      *
    </span>
  );
  const labelClass = "block text-sm font-semibold text-foreground";
  const showExplicit = isSpecialtyTreatment(values.treatment, treatmentNotSure);

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5" aria-describedby={formError ? id("form-error") : undefined}>
      {formError && (
        <div id={id("form-error")} role="alert" className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {formError}
        </div>
      )}

      {/* Honeypot — insanlar görmez/doldurmaz; ekran okuyucudan ve sekme sırasından gizli. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label htmlFor={id("website")}>Website</label>
        <input id={id("website")} name="website" type="text" tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => update("website", e.target.value)} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={id("fullName")} className={labelClass}>
            {dict.fullNameLabel}
            {requiredStar}
          </label>
          <input
            ref={(el) => {
              fieldRefs.current.fullName = el;
            }}
            id={id("fullName")}
            name="name"
            type="text"
            autoComplete="name"
            required
            aria-required="true"
            aria-invalid={errors.fullName ? true : undefined}
            aria-describedby={describedBy("fullName")}
            maxLength={120}
            value={values.fullName}
            onChange={(e) => update("fullName", e.target.value)}
            className={cn(INPUT_CLASS, "mt-2 h-12")}
          />
          {errorText("fullName")}
        </div>

        <div>
          <label htmlFor={id("email")} className={labelClass}>
            {dict.emailLabel}
            {requiredStar}
          </label>
          <input
            ref={(el) => {
              fieldRefs.current.email = el;
            }}
            id={id("email")}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            aria-required="true"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={describedBy("email")}
            maxLength={254}
            value={values.email}
            onChange={(e) => update("email", e.target.value)}
            className={cn(INPUT_CLASS, "mt-2 h-12")}
          />
          {errorText("email")}
        </div>
      </div>

      <fieldset>
        <legend className={labelClass}>{dict.phoneLabel}</legend>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
          <div>
            <label htmlFor={id("phoneCountry")} className="sr-only">
              {dict.phoneCountryLabel}
            </label>
            <select
              ref={(el) => {
                fieldRefs.current.phoneCountry = el;
              }}
              id={id("phoneCountry")}
              name="tel-country-code"
              autoComplete="tel-country-code"
              aria-invalid={errors.phoneCountry ? true : undefined}
              aria-describedby={describedBy("phoneCountry")}
              value={values.phoneCountry}
              onChange={(e) => update("phoneCountry", e.target.value)}
              className={cn(INPUT_CLASS, "h-12 pr-8")}
            >
              <option value="">{dict.phoneCountryLabel}</option>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name} (+{country.dial})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={id("phoneNumber")} className="sr-only">
              {dict.phoneNumberLabel}
            </label>
            <input
              ref={(el) => {
                fieldRefs.current.phoneNumber = el;
              }}
              id={id("phoneNumber")}
              name="tel-national"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              aria-invalid={errors.phoneNumber ? true : undefined}
              aria-describedby={describedBy("phoneNumber")}
              maxLength={20}
              value={values.phoneNumber}
              onChange={(e) => update("phoneNumber", e.target.value)}
              className={cn(INPUT_CLASS, "h-12")}
            />
          </div>
        </div>
        {errorText("phoneCountry")}
        {errorText("phoneNumber")}
      </fieldset>

      <div>
        <label htmlFor={id("country")} className={labelClass}>
          {dict.countryLabel}
        </label>
        <select
          ref={(el) => {
            fieldRefs.current.country = el;
          }}
          id={id("country")}
          name="country"
          autoComplete="country"
          aria-invalid={errors.country ? true : undefined}
          aria-describedby={describedBy("country")}
          value={values.country}
          onChange={(e) => update("country", e.target.value)}
          className={cn(INPUT_CLASS, "mt-2 h-12 pr-8")}
        >
          <option value="">{dict.countryPlaceholder}</option>
          {countries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
        {errorText("country")}
      </div>

      {treatments.length > 0 && (
        <div>
          <label htmlFor={id("treatment")} className={labelClass}>
            {dict.treatmentLabel}
          </label>
          <select
            ref={(el) => {
              fieldRefs.current.treatment = el;
            }}
            id={id("treatment")}
            name="treatment"
            aria-invalid={errors.treatment ? true : undefined}
            aria-describedby={describedBy("treatment", id("treatment-help"))}
            value={values.treatment}
            onChange={(e) => update("treatment", e.target.value)}
            className={cn(INPUT_CLASS, "mt-2 h-12 pr-8")}
          >
            <option value="">{dict.treatmentPlaceholder}</option>
            {treatments.map((treatment) => (
              <option key={treatment.slug} value={treatment.slug}>
                {treatment.name}
              </option>
            ))}
            <option value={treatmentNotSure}>{dict.treatmentNotSure}</option>
          </select>
          <p id={id("treatment-help")} className="mt-1.5 text-sm text-[var(--about-muted-text)]">
            {dict.treatmentHelp}
          </p>
          {errorText("treatment")}

          {showExplicit && (
            <div className="mt-3 rounded-xl border border-border bg-[color-mix(in_oklch,var(--site-primary)_5%,var(--site-surface))] p-3">
              <label htmlFor={id("explicitConsent")} className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-foreground">
                <input
                  ref={(el) => {
                    fieldRefs.current.explicitConsent = el;
                  }}
                  id={id("explicitConsent")}
                  type="checkbox"
                  required
                  aria-required="true"
                  aria-invalid={errors.explicitConsent ? true : undefined}
                  aria-describedby={describedBy("explicitConsent")}
                  checked={values.explicitConsent}
                  onChange={(e) => update("explicitConsent", e.target.checked)}
                  className="mt-0.5 size-5 shrink-0 accent-[var(--site-primary)]"
                />
                <span>
                  {withPrivacyLink(consent.explicit, consent.privacyLinkLabel, privacyHref)}
                  {requiredStar}
                </span>
              </label>
              {errorText("explicitConsent")}
            </div>
          )}
        </div>
      )}

      <fieldset aria-describedby={describedBy("contactMethod", id("whatsapp-note"))}>
        <legend className={labelClass}>{dict.contactMethodLabel}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {(
            [
              ["email", dict.methodEmail],
              ["phone", dict.methodPhone],
              ["whatsapp", dict.methodWhatsapp],
            ] as const
          ).map(([method, label], index) => (
            <label
              key={method}
              htmlFor={id(`method-${method}`)}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 text-base transition-colors",
                values.contactMethod === method
                  ? "border-primary bg-[color-mix(in_oklch,var(--site-primary)_8%,var(--site-surface))] font-semibold text-foreground"
                  : "border-border bg-surface text-foreground hover:border-primary/50"
              )}
            >
              <input
                ref={
                  index === 0
                    ? (el) => {
                        fieldRefs.current.contactMethod = el;
                      }
                    : undefined
                }
                id={id(`method-${method}`)}
                type="radio"
                name="contactMethod"
                value={method}
                checked={values.contactMethod === method}
                onChange={() => update("contactMethod", method)}
                className="size-4 shrink-0 accent-[var(--site-primary)]"
              />
              {label}
            </label>
          ))}
        </div>
        <p id={id("whatsapp-note")} className="mt-2 text-xs leading-relaxed text-[var(--about-muted-text)]">
          {dict.whatsappNote}
        </p>
      </fieldset>

      <div>
        <label htmlFor={id("message")} className={labelClass}>
          {dict.messageLabel}
          {requiredStar}
        </label>
        <textarea
          ref={(el) => {
            fieldRefs.current.message = el;
          }}
          id={id("message")}
          name="message"
          required
          aria-required="true"
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={describedBy("message", id("message-help"))}
          rows={5}
          maxLength={3000}
          value={values.message}
          onChange={(e) => update("message", e.target.value)}
          className={cn(INPUT_CLASS, "mt-2 min-h-32 resize-y py-3")}
        />
        <p id={id("message-help")} className="mt-1.5 text-sm text-[var(--about-muted-text)]">
          {dict.messageHelp}
        </p>
        {errorText("message")}
      </div>

      <div>
        <label htmlFor={id("noticeAccepted")} className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-foreground">
          <input
            ref={(el) => {
              fieldRefs.current.noticeAccepted = el;
            }}
            id={id("noticeAccepted")}
            type="checkbox"
            required
            aria-required="true"
            aria-invalid={errors.noticeAccepted ? true : undefined}
            aria-describedby={describedBy("noticeAccepted")}
            checked={values.noticeAccepted}
            onChange={(e) => update("noticeAccepted", e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-[var(--site-primary)]"
          />
          <span>
            {withPrivacyLink(consent.notice, consent.privacyLinkLabel, privacyHref)}
            {requiredStar}
          </span>
        </label>
        {errorText("noticeAccepted")}
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={submitting}
          aria-disabled={submitting}
          className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-primary px-7 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-70"
        >
          {submitting ? dict.sending : dict.submit}
        </button>
        {responseTime && <p className="text-sm text-[var(--about-muted-text)]">{responseTime}</p>}
      </div>
    </form>
  );
}
