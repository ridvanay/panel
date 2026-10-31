"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CircleCheck, Info } from "lucide-react";
import { ApiClientError } from "@/lib/api/error";
import { submitPackageInquiry } from "@/lib/api/packages";
import type { PackageInquiryBody, PackageInquiryResult } from "@/lib/api/types";
import { COUNTRY_DIAL_CODES } from "@/lib/country-codes";
import { countryName } from "@/lib/country-display";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { usePackagesStrings } from "@/lib/i18n/use-packages-strings";
import { useActiveLocaleCode, useLocalizePath } from "@/context/locale-alternates-context";
import { fetchLegalPagesClient, resolveExplicitConsentPage, resolveKvkkNoticePage } from "@/lib/legal-pages";
import type { PackagesStrings } from "@/lib/i18n/site-dictionaries/en/packages";
import { cn } from "@/lib/utils";
import { buildPreferredDates, fill } from "./package-format";

/** Form kök kimliği — "Sizi arayalım" düğmesi (`ContactCta onCallback`) formu bununla bulup odaklar. */
export const PACKAGE_INQUIRY_FORM_ID = "package-inquiry-form";
export const PACKAGE_NOTE_MAX = 500;

/** Formu görünür kılar ve ilk alanına odaklanır (ContactCta `onCallback`). */
export function focusPackageInquiryForm(): void {
  const form = document.getElementById(PACKAGE_INQUIRY_FORM_ID);
  if (!form) return;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  form.querySelector<HTMLInputElement>("input[name='name']")?.focus({ preventScroll: true });
}

const PHONE_PATTERN = /^[+0-9 ()-]{6,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormValues {
  website: string;
  name: string;
  email: string;
  phoneCountry: string;
  phoneNumber: string;
  country: string;
  dateFrom: string;
  dateTo: string;
  travellers: string;
  note: string;
  consentHealth: boolean;
  consentContact: boolean;
}

/**
 * Kurallar: iletişim izni YOKSA hiçbir kişisel alan zorunlu/gönderilmez; izin varsa ad zorunlu, e-posta ya da telefondan
 * biri zorunlu. Not doluyken sağlık bilgisi rızası zorunlu (istemcide uyarılır, sunucu da 422 döner).
 */
export function buildInquirySchema(t: PackagesStrings) {
  return z
    .object({
      website: z.string(),
      name: z.string(),
      email: z.string(),
      phoneCountry: z.string(),
      phoneNumber: z.string(),
      country: z.string(),
      dateFrom: z.string(),
      dateTo: z.string(),
      travellers: z.string().regex(/^\d{1,2}$/, t.required),
      note: z.string().max(PACKAGE_NOTE_MAX),
      consentHealth: z.boolean(),
      consentContact: z.boolean(),
    })
    .superRefine((v, ctx) => {
      const add = (path: keyof FormValues, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
      const travellers = Number(v.travellers);
      if (!Number.isInteger(travellers) || travellers < 1 || travellers > 20) add("travellers", t.required);
      if (v.note.trim() && !v.consentHealth) add("consentHealth", t.noteNeedsConsent);
      if (!v.consentContact) return;
      if (!v.name.trim()) add("name", t.required);
      const email = v.email.trim();
      const phone = v.phoneNumber.trim();
      if (!email && !phone) add("email", t.contactOneRequired);
      if (email && !EMAIL_PATTERN.test(email)) add("email", t.contactOneRequired);
      if (phone && !PHONE_PATTERN.test(phone)) add("phoneNumber", t.invalidPhone);
      if (phone && !v.phoneCountry && !v.country) add("phoneCountry", t.required);
    });
}

const inputClass =
  "h-11 w-full rounded-[var(--site-radius)] border border-border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)] aria-[invalid=true]:border-danger md:text-sm";

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

type Outcome = { kind: "stored"; number: number } | { kind: "not-stored" } | null;

/**
 * Paket X — "Plan my package" talep formu. Bir satın alma/randevu DEĞİLDİR; ödeme alınmaz. Honeypot `website` alanı,
 * iki rıza kutusu (sağlık bilgisi / iletişim) ve iletişim izni yoksa "hiçbir şey kaydedilmedi" bildirimi içerir.
 * İletişim izni yoksa istek gövdesinde kişisel veri/not GİTMEZ (yalnızca `locale` ve iki `false` rıza).
 */
export function PackageInquiryForm({ slug, className }: { slug: string; className?: string }) {
  const t = usePackagesStrings();
  const lang = useActiveLocaleCode();
  const localize = useLocalizePath();
  const intlLocale = contentLocaleToIntl(lang);
  const schema = useMemo(() => buildInquirySchema(t), [t]);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [legalLinks, setLegalLinks] = useState<{ notice: string | null; consent: string | null } | null>(null);

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { website: "", name: "", email: "", phoneCountry: "", phoneNumber: "", country: "", dateFrom: "", dateTo: "", travellers: "1", note: "", consentHealth: false, consentContact: false },
  });
  const [note, consentContact, consentHealth, dateFrom] = useWatch({ control, name: ["note", "consentContact", "consentHealth", "dateFrom"] });

  useEffect(() => {
    let cancelled = false;
    fetchLegalPagesClient(lang).then((pages) => {
      if (cancelled) return;
      const notice = resolveKvkkNoticePage(pages);
      const consent = resolveExplicitConsentPage(pages);
      setLegalLinks({ notice: notice ? localize(`/${notice.slug}`) : null, consent: consent ? localize(`/${consent.slug}`) : null });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `localize` yalnızca dil/bağlam değişince değişir
  }, [lang]);

  // Ülke adları ve sıralaması `Intl` (ICU) verisine bağlı; Node ile tarayıcının ICU sürümü farklı olabildiği için liste
  // YALNIZCA tarayıcıda oluşturulur. Aksi halde hidrasyon uyuşmazlığı tüm sayfayı istemcide yeniden çizdiriyordu.
  const isClient = useSyncExternalStore(subscribeNever, () => true, () => false);
  const countries = useMemo(
    () => (isClient ? COUNTRY_DIAL_CODES.map(([code]) => ({ code, name: countryName(code, intlLocale) })).sort((a, b) => a.name.localeCompare(b.name, intlLocale)) : []),
    [intlLocale, isClient]
  );

  const onSubmit = handleSubmit(async (v) => {
    setSubmitError(null);
    const body: PackageInquiryBody = v.consentContact
      ? {
          website: v.website || undefined,
          locale: lang,
          name: v.name.trim(),
          ...(v.email.trim() ? { email: v.email.trim() } : {}),
          ...(v.phoneNumber.trim() ? { phoneNumber: v.phoneNumber.trim(), phoneCountry: v.phoneCountry || v.country } : {}),
          ...(v.country ? { country: v.country } : {}),
          ...(buildPreferredDates(v.dateFrom, v.dateTo) ? { preferredDates: buildPreferredDates(v.dateFrom, v.dateTo)! } : {}),
          travellers: Number(v.travellers),
          ...(v.note.trim() ? { note: v.note.trim() } : {}),
          consentContact: true,
          consentHealth: v.consentHealth,
        }
      : // İletişim izni yok: ad, iletişim, not ve tarih GÖNDERİLMEZ.
        { website: v.website || undefined, locale: lang, consentContact: false, consentHealth: false };
    try {
      const result: PackageInquiryResult = await submitPackageInquiry(slug, body);
      setOutcome(result.stored ? { kind: "stored", number: result.number } : { kind: "not-stored" });
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 429) {
        setSubmitError(t.errorRateLimit);
        return;
      }
      if (err instanceof ApiClientError && err.details) {
        for (const key of Object.keys(err.details)) {
          const message = key === "email" ? t.contactOneRequired : key === "phoneNumber" ? t.invalidPhone : key === "consentHealth" ? t.noteNeedsConsent : t.required;
          if (key === "name" || key === "email" || key === "phoneNumber" || key === "consentHealth") setError(key, { message });
        }
      }
      setSubmitError(t.errorGeneric);
    }
  });

  if (outcome?.kind === "stored") {
    return (
      <section id={PACKAGE_INQUIRY_FORM_ID} aria-labelledby="package-inquiry-title" className={cn("rounded-[var(--site-radius)] border border-border bg-surface p-4", className)}>
        <div role="status" data-testid="package-inquiry-success">
          <h3 id="package-inquiry-title" className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
            <CircleCheck className="h-5 w-5 text-success" aria-hidden="true" />
            {t.successTitle}
          </h3>
          <p className="mt-2 text-sm font-medium text-foreground" data-testid="package-inquiry-number">
            {fill(t.successNumber, { number: outcome.number })}
          </p>
          <p className="mt-1 text-sm text-foreground/70">{t.successText}</p>
        </div>
      </section>
    );
  }

  if (outcome?.kind === "not-stored") {
    return (
      <section id={PACKAGE_INQUIRY_FORM_ID} aria-labelledby="package-inquiry-title" className={cn("rounded-[var(--site-radius)] border border-border bg-surface p-4", className)}>
        <div role="status" data-testid="package-inquiry-not-stored">
          <h3 id="package-inquiry-title" className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
            <Info className="h-5 w-5 text-foreground/60" aria-hidden="true" />
            {t.notStoredTitle}
          </h3>
          <p className="mt-2 text-sm text-foreground/70">{t.notStoredText}</p>
        </div>
        <button type="button" onClick={() => setOutcome(null)} className="mt-3 min-h-11 rounded-[var(--site-radius)] border border-[var(--site-primary)] px-4 text-sm font-semibold text-[var(--site-primary)] hover:bg-[var(--site-primary)]/5">
          {t.editAgain}
        </button>
      </section>
    );
  }

  const noteMissingConsent = note.trim().length > 0 && !consentHealth;

  return (
    <section id={PACKAGE_INQUIRY_FORM_ID} aria-labelledby="package-inquiry-title" className={cn("rounded-[var(--site-radius)] border border-border bg-surface p-4", className)}>
      <h3 id="package-inquiry-title" className="font-heading text-lg font-semibold text-foreground">
        {t.formTitle}
      </h3>
      <p className="mt-1 text-sm text-foreground/70">{t.formIntro}</p>

      <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4" data-testid="package-inquiry-form">
        {/* Honeypot: insanlara görünmez ve odaklanılamaz; botlar doldurur. */}
        <div aria-hidden="true" className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input type="text" tabIndex={-1} autoComplete="off" {...register("website")} data-testid="package-inquiry-website" />
          </label>
        </div>

        <Field label={t.nameLabel} htmlFor="package-inquiry-name" error={errors.name?.message}>
          <input id="package-inquiry-name" type="text" autoComplete="name" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "package-inquiry-name-error" : undefined} className={inputClass} {...register("name")} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.emailLabel} htmlFor="package-inquiry-email" error={errors.email?.message}>
            <input id="package-inquiry-email" type="email" dir="ltr" autoComplete="email" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "package-inquiry-email-error" : undefined} className={inputClass} {...register("email")} />
          </Field>
          <Field label={t.phoneLabel} htmlFor="package-inquiry-phone" error={errors.phoneNumber?.message ?? errors.phoneCountry?.message}>
            <div className="flex gap-2" dir="ltr">
              <select aria-label={t.phoneCountryLabel} className="h-11 w-28 rounded-[var(--site-radius)] border border-border bg-background px-2 text-base md:text-sm" {...register("phoneCountry")}>
                <option value="">–</option>
                {COUNTRY_DIAL_CODES.map(([code, dial]) => (
                  <option key={code} value={code}>
                    {code} +{dial}
                  </option>
                ))}
              </select>
              <input id="package-inquiry-phone" type="tel" autoComplete="tel-national" aria-invalid={Boolean(errors.phoneNumber)} className={inputClass} {...register("phoneNumber")} />
            </div>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.countryLabel} htmlFor="package-inquiry-country">
            <select id="package-inquiry-country" autoComplete="country" className={inputClass} {...register("country")}>
              <option value="">{t.countryPlaceholder}</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.travellersLabel} htmlFor="package-inquiry-travellers" error={errors.travellers?.message}>
            <input id="package-inquiry-travellers" type="number" inputMode="numeric" min={1} max={20} aria-invalid={Boolean(errors.travellers)} className={inputClass} {...register("travellers")} />
          </Field>
        </div>

        <fieldset className="space-y-1 text-sm">
          <legend className="font-semibold text-foreground">{t.datesLabel}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-foreground/70">{t.dateFromLabel}</span>
              <input type="date" className={inputClass} {...register("dateFrom")} data-testid="package-inquiry-date-from" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-foreground/70">{t.dateToLabel}</span>
              <input type="date" min={dateFrom || undefined} className={inputClass} {...register("dateTo")} data-testid="package-inquiry-date-to" />
            </label>
          </div>
        </fieldset>

        <div className="space-y-1 text-sm">
          <label htmlFor="package-inquiry-note" className="block font-semibold text-foreground">
            {t.noteLabel}
          </label>
          <textarea
            id="package-inquiry-note"
            rows={3}
            maxLength={PACKAGE_NOTE_MAX}
            aria-describedby="package-inquiry-note-hint"
            className="w-full rounded-[var(--site-radius)] border border-border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)] md:text-sm"
            {...register("note")}
          />
          <div className="flex items-start justify-between gap-3 text-xs text-foreground/60">
            <p id="package-inquiry-note-hint">{t.noteHint}</p>
            <p aria-live="off" data-testid="package-inquiry-note-counter" className="shrink-0">
              {fill(t.noteCounter, { n: note.length })}
            </p>
          </div>
          {noteMissingConsent && (
            <p role="alert" className="text-xs font-medium text-warning" data-testid="package-inquiry-note-warning">
              {t.noteNeedsConsent}
            </p>
          )}
        </div>

        <div className="space-y-3 rounded-[var(--site-radius)] border border-border bg-background p-3 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--site-primary)]" {...register("consentHealth")} data-testid="package-inquiry-consent-health" />
            <span>
              {t.consentHealth}{" "}
              {legalLinks?.consent && (
                <Link href={legalLinks.consent} target="_blank" className="font-medium text-[var(--site-link,var(--site-primary))] underline">
                  {t.consentHealthLink}
                </Link>
              )}
              <span className="mt-1 block text-xs text-foreground/60">{t.consentHealthHint}</span>
            </span>
          </label>
          {errors.consentHealth?.message && (
            <span role="alert" className="block text-xs text-danger" data-testid="package-inquiry-consent-health-error">
              {errors.consentHealth.message}
            </span>
          )}
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--site-primary)]" {...register("consentContact")} data-testid="package-inquiry-consent-contact" />
            <span>
              {t.consentContact}{" "}
            {legalLinks?.notice && (
              <>
                <Link href={legalLinks.notice} target="_blank" className="font-medium text-[var(--site-link,var(--site-primary))] underline">
                  {t.privacyNoticeLink}
                </Link>
              </>
            )}
            </span>
          </label>
          {!consentContact && (
            <p className="text-xs text-foreground/70" data-testid="package-inquiry-no-contact-note">
              {t.noContactNote}
            </p>
          )}
        </div>

        {submitError && (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" data-testid="package-inquiry-error">
            {submitError}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-primary)] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 sm:w-auto"
        >
          {isSubmitting ? t.submitting : t.submit}
        </button>
      </form>
    </section>
  );
}

function subscribeNever(): () => void {
  return () => {};
}
