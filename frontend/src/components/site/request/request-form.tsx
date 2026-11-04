"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, ArrowRight, Check, Info, Loader2, Pencil, Search } from "lucide-react";
import { ApiClientError } from "@/lib/api/error";
import {
  CONTACT_LANGUAGES,
  CONTACT_LANGUAGE_NATIVE_NAMES,
  PREFERRED_CONTACT_CHANNELS,
  submitConsultationRequest,
  type ConsultationRequestBody,
  type ContactLanguage,
  type PreferredContactChannel,
} from "@/lib/api/consultation-requests";
import { COUNTRY_DIAL_CODES, dialCodeFor } from "@/lib/country-codes";
import { countryName } from "@/lib/country-display";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import type { RequestStrings } from "@/lib/i18n/site-dictionaries/en/request";
import type { ServiceGroupId } from "@/lib/service-groups";
import { cn } from "@/lib/utils";
import { RequestServicePicker, type RequestServiceGroup } from "./request-service-picker";
import { RequestSuccess } from "./request-success";

export type { RequestServiceGroup } from "./request-service-picker";

/** Talep formu mesaj üst sınırı. */
export const REQUEST_MESSAGE_MAX = 1000;
export const PHONE_PATTERN = /^[+0-9 ()-]{6,20}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOTAL_STEPS = 4;

interface FormValues {
  website: string;
  service: string;
  flexible: boolean;
  dateFrom: string;
  dateTo: string;
  country: string;
  contactLanguage: string;
  needsInterpreter: boolean;
  fullName: string;
  email: string;
  dial: string;
  phone: string;
  channel: PreferredContactChannel;
  message: string;
  contactConsent: boolean;
  healthDataConsent: boolean;
}

/** Adım başına doğrulanan alanlar. */
const STEP_FIELDS: (keyof FormValues)[][] = [
  ["service"],
  ["country", "dateFrom", "dateTo", "contactLanguage"],
  ["fullName", "email", "dial", "phone", "channel", "message"],
  ["contactConsent", "healthDataConsent"],
];

/** Ulusal numara + çağrı kodu → backend telefon biçimi (`+49 1511234567`); numara `+` ile başlıyorsa olduğu gibi. */
export function composePhone(dial: string, phone: string): string {
  const national = phone.trim();
  if (!national) return "";
  if (national.startsWith("+")) return national;
  return dial ? `+${dial} ${national}` : national;
}

/**
 * Doğrulama kuralları (backend ile aynı): hizmet ya da paket zorunlu; iletişim izni zorunlu; mesaj doluysa sağlık
 * verisi açık rızası zorunlu; bitiş tarihi başlangıçtan önce olamaz; WhatsApp/telefon kanalı için numara gerekir.
 */
export function buildRequestSchema(t: RequestStrings, hasPackage: boolean) {
  return z
    .object({
      website: z.string(),
      service: z.string(),
      flexible: z.boolean(),
      dateFrom: z.string(),
      dateTo: z.string(),
      country: z.string(),
      contactLanguage: z.string(),
      needsInterpreter: z.boolean(),
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
      const add = (path: keyof FormValues, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
      if (!hasPackage && !v.service) add("service", t.required);
      if (!v.country) add("country", t.required);
      if (!v.fullName.trim()) add("fullName", t.required);
      const email = v.email.trim();
      if (!email) add("email", t.required);
      else if (!EMAIL_PATTERN.test(email)) add("email", t.invalidEmail);
      const phone = composePhone(v.dial, v.phone);
      if (phone && !PHONE_PATTERN.test(phone)) add("phone", t.invalidPhone);
      else if (!phone && v.channel !== "email") add("phone", t.channelPhoneNeeded);
      if (!v.flexible && v.dateFrom && v.dateTo && v.dateTo < v.dateFrom) add("dateTo", t.dateRangeInvalid);
      if (v.message.trim() && !v.healthDataConsent) add("healthDataConsent", t.healthConsentRequired);
      if (!v.contactConsent) add("contactConsent", t.consentContactRequired);
    });
}

const inputClass =
  "h-11 w-full rounded-[var(--site-radius)] border border-border bg-background px-3 text-base outline-none transition-all duration-300 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)] disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger md:text-sm";

const primaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] bg-[var(--site-button)] px-6 text-sm font-semibold text-[var(--site-button-text)] transition-all duration-300 motion-reduce:transition-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)] disabled:opacity-60";
const secondaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] border border-[var(--site-primary)] px-5 text-sm font-semibold text-[var(--site-primary)] transition-colors duration-300 motion-reduce:transition-none hover:bg-[var(--site-primary)]/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]";

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

/** Backend `details.<alan>` anahtarları → form alanı ve hata verdiği adım. */
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
  preferredContactChannel: "channel",
  message: "message",
  contactConsent: "contactConsent",
  healthDataConsent: "healthDataConsent",
};

function stepOfField(field: keyof FormValues): number {
  const index = STEP_FIELDS.findIndex((fields) => fields.includes(field));
  return index === -1 ? 0 : index;
}

const UNIQUE_DIAL_CODES = Array.from(new Set(COUNTRY_DIAL_CODES.map(([, dial]) => dial))).sort((a, b) => Number(a) - Number(b));

/**
 * Paket AJ — 4 adımlı talep formu (Service → Timing & preferences → Your details → Review & consent). Gönderim
 * `POST /consultation-requests` (backend, rıza, honeypot ve bildirimler değişmedi); girilenler adımlar arasında
 * korunur. İleride (AI İş 3) takvim adımı `STEP_FIELDS` + bir adım bölümüyle eklenebilir.
 */
export function RequestForm({
  lang,
  strings: t,
  groups,
  groupTitles,
  initialService,
  initialMessage = null,
  pkg,
  privacyHref,
  consentHref,
  homeHref,
  servicesHref,
  contactHref,
  findTreatmentHref = "/find-your-treatment",
  vipHref = null,
  guidesHref = null,
  whatsappHref = null,
}: {
  lang: string;
  strings: RequestStrings;
  groups: RequestServiceGroup[];
  groupTitles: Record<ServiceGroupId, string>;
  initialService: string | null;
  /** VIP sayfasından gelen `?topic=` notu; mesaj alanını ön-doldurur. */
  initialMessage?: string | null;
  pkg: { slug: string; title: string } | null;
  privacyHref: string | null;
  consentHref: string | null;
  homeHref: string;
  servicesHref: string;
  contactHref: string;
  /** `null` = "Find your treatment" bağlantısı gizli (Paket AK). */
  findTreatmentHref?: string | null;
  vipHref?: string | null;
  guidesHref?: string | null;
  whatsappHref?: string | null;
}) {
  const intlLocale = contentLocaleToIntl(lang);
  const hasPackage = Boolean(pkg);
  const schema = useMemo(() => buildRequestSchema(t, hasPackage), [t, hasPackage]);
  const [step, setStep] = useState(0);
  const [requestNumber, setRequestNumber] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [countryQuery, setCountryQuery] = useState("");
  const [dialTouched, setDialTouched] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const defaultContactLanguage: ContactLanguage = (CONTACT_LANGUAGES as readonly string[]).includes(lang) ? (lang as ContactLanguage) : "en";

  const {
    register,
    handleSubmit,
    control,
    setError,
    setValue,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      website: "",
      service: initialService ?? "",
      flexible: false,
      dateFrom: "",
      dateTo: "",
      country: "",
      contactLanguage: defaultContactLanguage,
      needsInterpreter: false,
      fullName: "",
      email: "",
      dial: "",
      phone: "",
      channel: "email",
      message: initialMessage ?? "",
      contactConsent: false,
      healthDataConsent: false,
    },
  });
  const values = useWatch({ control });
  const message = values.message ?? "";
  const service = values.service ?? "";
  const flexible = Boolean(values.flexible);

  // Ülke adları ICU'ya bağlı; liste yalnızca tarayıcıda oluşturulur (hidrasyon uyuşmazlığını önler).
  const isClient = useSyncExternalStore(subscribeNever, () => true, () => false);
  const countries = useMemo(
    () => (isClient ? COUNTRY_DIAL_CODES.map(([code]) => ({ code, name: countryName(code, intlLocale) })).sort((a, b) => a.name.localeCompare(b.name, intlLocale)) : []),
    [intlLocale, isClient]
  );
  const countryNeedle = countryQuery.trim().toLocaleLowerCase(intlLocale);
  const filteredCountries = useMemo(() => {
    if (!countryNeedle) return countries;
    const list = countries.filter((c) => c.name.toLocaleLowerCase(intlLocale).includes(countryNeedle));
    // Seçili ülke arama sonucunda yoksa bile seçili kalsın (kontrollü değer kaybolmasın).
    const selected = countries.find((c) => c.code === values.country);
    return selected && !list.some((c) => c.code === selected.code) ? [selected, ...list] : list;
  }, [countries, countryNeedle, intlLocale, values.country]);

  // Adım değişince başlığa odaklan (ekran okuyucu + klavye); ilk çizimde odak çalma.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const allServices = useMemo(() => groups.flatMap((g) => [{ slug: g.slug, name: g.name }, ...g.children]), [groups]);
  const serviceName = allServices.find((s) => s.slug === service)?.name ?? "";

  const goToStep = (next: number) => {
    setSubmitError(null);
    setStep(Math.min(Math.max(next, 0), TOTAL_STEPS - 1));
  };

  const goNext = async () => {
    const ok = await trigger(STEP_FIELDS[step], { shouldFocus: true });
    if (ok) goToStep(step + 1);
  };

  const onSubmit = handleSubmit(
    async (v) => {
      setSubmitError(null);
      const phone = composePhone(v.dial, v.phone);
      const body: ConsultationRequestBody = {
        serviceSlug: v.service || null,
        packageSlug: pkg?.slug ?? null,
        preferredFrom: v.flexible ? null : v.dateFrom || null,
        preferredTo: v.flexible ? null : v.dateTo || null,
        country: v.country,
        contactLanguage: v.contactLanguage as ContactLanguage,
        needsInterpreter: v.needsInterpreter,
        fullName: v.fullName.trim(),
        email: v.email.trim(),
        phone: phone || null,
        preferredContactChannel: v.channel,
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
          let firstStep: number | null = null;
          for (const [key, messages] of Object.entries(err.details)) {
            const field = SERVER_FIELD_MAP[key];
            if (!field) continue;
            setError(field, { message: messages[0] || t.required });
            const fieldStep = stepOfField(field);
            firstStep = firstStep === null ? fieldStep : Math.min(firstStep, fieldStep);
          }
          if (firstStep !== null) setStep(firstStep);
          setSubmitError(firstStep !== null ? t.errorFields : t.errorGeneric);
          return;
        }
        setSubmitError(t.errorGeneric);
      }
    },
    // Son adımda doğrulama başarısız: hatası olan en erken adıma dön.
    (invalid) => {
      const first = Object.keys(invalid).map((k) => stepOfField(k as keyof FormValues));
      if (first.length > 0) setStep(Math.min(...first));
      setSubmitError(t.errorFields);
    }
  );

  if (requestNumber !== null) {
    return (
      <RequestSuccess
        strings={t}
        requestNumber={requestNumber}
        homeHref={homeHref}
        servicesHref={servicesHref}
        vipHref={vipHref}
        guidesHref={guidesHref}
        whatsappHref={whatsappHref}
      />
    );
  }

  const noServices = groups.length === 0 && !pkg;
  const stepTitles = [t.step1Title, t.step2Title, t.step3Title, t.step4Title];
  const stepLabel = t.stepOf.replace("{current}", String(step + 1)).replace("{total}", String(TOTAL_STEPS));
  const channelLabels: Record<PreferredContactChannel, string> = { email: t.channelEmail, whatsapp: t.channelWhatsapp, phone: t.channelPhone };
  const cardClass = "rounded-xl border border-border bg-surface p-5 sm:p-8";
  const selectedCountry = countries.find((c) => c.code === values.country)?.name ?? "";
  const reviewPhone = composePhone(values.dial ?? "", values.phone ?? "");
  const reviewDates = flexible
    ? t.flexible
    : values.dateFrom || values.dateTo
      ? [values.dateFrom, values.dateTo].filter(Boolean).join(" → ")
      : t.reviewNotProvided;

  const reviewRows: { label: string; value: string; step: number }[] = [
    ...(pkg ? [{ label: t.packageLabel, value: pkg.title, step: 0 }] : []),
    { label: t.serviceLabel, value: serviceName || t.reviewNotProvided, step: 0 },
    { label: t.datesLabel, value: reviewDates, step: 1 },
    { label: t.countryLabel, value: selectedCountry || t.reviewNotProvided, step: 1 },
    { label: t.contactLanguageLabel, value: CONTACT_LANGUAGE_NATIVE_NAMES[(values.contactLanguage as ContactLanguage) ?? "en"] ?? values.contactLanguage ?? "", step: 1 },
    { label: t.interpreterLabel, value: values.needsInterpreter ? t.interpreterYes : t.interpreterNo, step: 1 },
    { label: t.fullNameLabel, value: (values.fullName ?? "").trim() || t.reviewNotProvided, step: 2 },
    { label: t.emailLabel, value: (values.email ?? "").trim() || t.reviewNotProvided, step: 2 },
    { label: t.phoneLabel, value: reviewPhone || t.reviewNotProvided, step: 2 },
    { label: t.preferredChannelLabel, value: channelLabels[values.channel ?? "email"], step: 2 },
    ...(message.trim() ? [{ label: t.messageLabel, value: message.trim(), step: 2 }] : []),
  ];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (step < TOTAL_STEPS - 1) void goNext();
        else void onSubmit();
      }}
      noValidate
      aria-label={t.formAria}
      className="space-y-5"
      data-testid="request-form"
    >
      {/* Honeypot: insanlara görünmez ve odaklanılamaz; botlar doldurur. */}
      <div aria-hidden="true" className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" tabIndex={-1} autoComplete="off" {...register("website")} data-testid="request-website" />
        </label>
      </div>

      {/* İlerleme göstergesi — mobilde yapışkan. */}
      <nav
        aria-label={t.progressAria}
        className="z-20 rounded-xl border border-border bg-surface/95 px-4 py-3 backdrop-blur max-lg:sticky max-lg:top-16"
        data-testid="request-progress"
      >
        <ol className="flex items-center gap-2">
          {stepTitles.map((title, index) => {
            const done = index < step;
            const current = index === step;
            return (
              <li key={title} className={cn("flex items-center gap-2", index < TOTAL_STEPS - 1 && "flex-1")} aria-current={current ? "step" : undefined}>
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors duration-300 motion-reduce:transition-none",
                    done && "border-[var(--site-primary)] bg-[var(--site-primary)] text-white",
                    current && "border-[var(--site-primary)] text-[var(--site-primary)] ring-2 ring-[var(--site-primary)]/25",
                    !done && !current && "border-border text-foreground/60"
                  )}
                >
                  {done ? <Check className="size-4" aria-hidden="true" /> : index + 1}
                </span>
                <span className={cn("text-sm font-medium", current ? "text-foreground" : "hidden text-foreground/70 xl:inline")}>{title}</span>
                {index < TOTAL_STEPS - 1 && <span aria-hidden="true" className={cn("h-px flex-1", done ? "bg-[var(--site-primary)]" : "bg-border")} />}
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-foreground/70 lg:hidden">{stepLabel}</p>
        <p className="sr-only" aria-live="polite" role="status" data-testid="request-step-status">
          {stepLabel}: {stepTitles[step]}
        </p>
      </nav>

      <section aria-labelledby="request-step-title" className={cardClass} data-testid={`request-step-${step + 1}`}>
        <h2 id="request-step-title" ref={headingRef} tabIndex={-1} className="mb-5 font-heading text-xl font-semibold tracking-tight text-foreground outline-none sm:text-2xl">
          {stepTitles[step]}
        </h2>

        {step === 0 && (
          <div className="space-y-5">
            {pkg ? (
              <div className="rounded-[var(--site-radius)] border border-[var(--site-primary)]/30 bg-[var(--site-primary)]/5 p-4 text-sm" data-testid="request-package">
                <span className="block text-xs font-semibold text-foreground/70">{t.packageLabel}</span>
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
              <RequestServicePicker
                strings={t}
                groups={groups}
                groupTitles={groupTitles}
                value={service}
                onChange={(slug) => setValue("service", slug, { shouldValidate: Boolean(errors.service), shouldDirty: true })}
                error={errors.service?.message}
                findTreatmentHref={findTreatmentHref}
              />
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6">
            <fieldset className="space-y-3 text-sm">
              <legend className="font-semibold text-foreground">{t.datesLabel}</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs text-foreground/70">{t.dateFromLabel}</span>
                  <input type="date" disabled={flexible} className={inputClass} aria-invalid={Boolean(errors.dateFrom)} {...register("dateFrom")} data-testid="request-date-from" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-foreground/70">{t.dateToLabel}</span>
                  <input type="date" disabled={flexible} min={values.dateFrom || undefined} className={inputClass} aria-invalid={Boolean(errors.dateTo)} {...register("dateTo")} data-testid="request-date-to" />
                </label>
              </div>
              <label className="inline-flex min-h-11 items-center gap-2">
                <input type="checkbox" className="size-4 accent-[var(--site-primary)]" {...register("flexible")} data-testid="request-flexible" />
                {t.flexible}
              </label>
              {(errors.dateFrom?.message || errors.dateTo?.message) && (
                <span role="alert" className="block text-xs text-danger">
                  {errors.dateTo?.message ?? errors.dateFrom?.message}
                </span>
              )}
            </fieldset>

            <div className="space-y-2">
              <Field label={t.countryLabel} htmlFor="request-country" error={errors.country?.message}>
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
                    data-testid="request-country-search"
                  />
                </div>
                <select
                  id="request-country"
                  autoComplete="country"
                  aria-invalid={Boolean(errors.country)}
                  aria-describedby={errors.country ? "request-country-error" : undefined}
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
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t.contactLanguageLabel} htmlFor="request-contact-language" error={errors.contactLanguage?.message}>
                <select id="request-contact-language" className={inputClass} {...register("contactLanguage")}>
                  {CONTACT_LANGUAGES.map((code) => (
                    <option key={code} value={code}>
                      {CONTACT_LANGUAGE_NATIVE_NAMES[code]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="space-y-1.5 text-sm">
                <span id="request-interpreter-label" className="block font-semibold text-foreground">
                  {t.interpreterLabel}
                </span>
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-labelledby="request-interpreter-label"
                    aria-describedby="request-interpreter-hint"
                    className="peer sr-only"
                    {...register("needsInterpreter")}
                    data-testid="request-interpreter"
                  />
                  <span
                    aria-hidden="true"
                    className="relative h-6 w-11 shrink-0 rounded-full bg-foreground/25 transition-colors duration-300 motion-reduce:transition-none after:absolute after:start-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-all after:duration-300 motion-reduce:after:transition-none peer-checked:bg-[var(--site-primary)] peer-checked:after:translate-x-5 rtl:peer-checked:after:-translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--site-primary)] peer-focus-visible:ring-offset-2"
                  />
                  <span>{values.needsInterpreter ? t.interpreterYes : t.interpreterNo}</span>
                </label>
                <p id="request-interpreter-hint" className="text-xs text-foreground/70">
                  {t.interpreterHint}
                </p>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
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

            <div className="grid gap-5 sm:grid-cols-2">
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
              <div className="space-y-1.5 text-sm">
                <label htmlFor="request-phone" className="block font-semibold text-foreground">
                  {t.phoneLabel}
                </label>
                <div className="flex gap-2">
                  <select
                    aria-label={t.dialCodeLabel}
                    dir="ltr"
                    className={cn(inputClass, "w-24 shrink-0 px-2")}
                    {...register("dial", { onChange: () => setDialTouched(true) })}
                    data-testid="request-dial"
                  >
                    <option value="">+</option>
                    {UNIQUE_DIAL_CODES.map((dial) => (
                      <option key={dial} value={dial}>
                        +{dial}
                      </option>
                    ))}
                  </select>
                  <input
                    id="request-phone"
                    type="tel"
                    dir="ltr"
                    autoComplete="tel-national"
                    aria-invalid={Boolean(errors.phone)}
                    aria-describedby={errors.phone ? "request-phone-error" : undefined}
                    className={inputClass}
                    {...register("phone")}
                  />
                </div>
                {errors.phone?.message && (
                  <span id="request-phone-error" role="alert" className="block text-xs text-danger">
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
                    <input type="radio" value={channel} className="peer sr-only" {...register("channel")} data-testid={`request-channel-${channel}`} />
                    <span className="flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--site-radius)] border border-border bg-background px-4 text-sm font-medium transition-all duration-300 motion-reduce:transition-none hover:border-[var(--site-primary)]/50 peer-checked:border-[var(--site-primary)] peer-checked:bg-[var(--site-primary)]/5 peer-checked:text-[var(--site-primary)] peer-checked:ring-1 peer-checked:ring-[var(--site-primary)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--site-primary)] peer-focus-visible:ring-offset-2">
                      {channelLabels[channel]}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="space-y-1.5 text-sm">
              <label htmlFor="request-message" className="block font-semibold text-foreground">
                {t.messageLabel}
              </label>
              <textarea
                id="request-message"
                rows={4}
                maxLength={REQUEST_MESSAGE_MAX}
                aria-describedby="request-message-notice"
                aria-invalid={Boolean(errors.message)}
                className="w-full rounded-[var(--site-radius)] border border-border bg-background px-3 py-2 text-base outline-none transition-all duration-300 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)] aria-[invalid=true]:border-danger md:text-sm"
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
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <p className="text-sm text-foreground/70">{t.reviewHint}</p>
            <dl className="divide-y divide-border rounded-[var(--site-radius)] border border-border bg-background text-sm" data-testid="request-review">
              {reviewRows.map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <dt className="text-xs text-foreground/70">{row.label}</dt>
                    <dd className="mt-0.5 break-words font-medium text-foreground">{row.value}</dd>
                  </div>
                  <button
                    type="button"
                    onClick={() => goToStep(row.step)}
                    aria-label={`${t.reviewEdit}: ${row.label}`}
                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-[var(--site-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--site-primary)]"
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                    {t.reviewEdit}
                  </button>
                </div>
              ))}
            </dl>

            <div className="space-y-4 rounded-[var(--site-radius)] border border-border bg-background p-4 text-sm">
              <div>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[var(--site-primary)]"
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
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[var(--site-primary)]"
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
                {(errors.healthDataConsent?.message || (message.trim().length > 0 && !values.healthDataConsent)) && (
                  <span role="alert" className="mt-1 block text-xs font-medium text-danger" data-testid="request-consent-health-error">
                    {errors.healthDataConsent?.message ?? t.healthConsentRequired}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {submitError && (
          <p role="alert" className="mt-5 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" data-testid="request-error">
            {submitError}
          </p>
        )}

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          {step > 0 ? (
            <button type="button" onClick={() => goToStep(step - 1)} className={secondaryButton} data-testid="request-back">
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
              {t.back}
            </button>
          ) : (
            <span />
          )}
          {/* Ayrı key: React aynı <button> düğümünü yeniden kullanırsa tıklama sırasında type="submit" olur ve son adıma geçer geçmez form gönderilir. */}
          {step < TOTAL_STEPS - 1 ? (
            <button key="next" type="button" onClick={() => void goNext()} disabled={noServices} className={primaryButton} data-testid="request-next">
              {t.next}
              <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
            </button>
          ) : (
            <button key="submit" type="submit" disabled={isSubmitting || noServices} className={primaryButton} data-testid="request-submit">
              {isSubmitting && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {isSubmitting ? t.submitting : t.submit}
            </button>
          )}
        </div>
      </section>
    </form>
  );
}

