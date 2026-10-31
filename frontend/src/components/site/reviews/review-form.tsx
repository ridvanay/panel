"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CircleCheck, ShieldAlert, Star } from "lucide-react";
import { ApiClientError } from "@/lib/api/error";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { fetchLegalPagesClient, resolveKvkkConsentPage } from "@/lib/legal-pages";
import { countryOptions } from "@/lib/review-countries";
import type { ReviewFormDisplayMode, SubmitReviewRequest } from "@/lib/api/types";
import { fillReview, useReviewStrings } from "@/lib/i18n/use-review-strings";
import type { ReviewsStrings } from "@/lib/i18n/site-dictionaries/en/reviews";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const REVIEW_BODY_MIN = 30;
export const REVIEW_BODY_MAX = 1500;
const TITLE_MIN = 3;
const TITLE_MAX = 120;

/** Rıza metninin sürümü — gönderimle birlikte sunucuya iletilir (metin değişirse sürüm de artırılır). */
export const REVIEW_CONSENT_TEXT_VERSION = "2026-11-review-v1";

/** E-posta, telefon ya da URL benzeri desen → yumuşak uyarı (gönderimi ENGELLEMEZ). */
export function looksLikeContactInfo(text: string): boolean {
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text) || /(?:https?:\/\/|www\.)\S+/i.test(text) || /(?:\+?\d[\d\s().-]{7,}\d)/.test(text);
}

const DISPLAY_MODES: ReviewFormDisplayMode[] = ["initials", "first_initial", "anonymous"];

/** İstemci doğrulaması — sunucu kontratıyla (rating 1-5, title 3-120, body 30-1500, onay zorunlu) AYNI sınırlar. */
export function buildReviewFormSchema(t: ReviewsStrings) {
  return z.object({
    rating: z.number().int().min(1, t.errRating).max(5, t.errRating),
    title: z.string().trim().min(TITLE_MIN, t.errTitle).max(TITLE_MAX, t.errTitle),
    body: z
      .string()
      .trim()
      .min(REVIEW_BODY_MIN, fillReview(t.errBody, { min: REVIEW_BODY_MIN, max: REVIEW_BODY_MAX }))
      .max(REVIEW_BODY_MAX, fillReview(t.errBody, { min: REVIEW_BODY_MIN, max: REVIEW_BODY_MAX })),
    displayMode: z.enum(["initials", "first_initial", "anonymous"]),
    country: z.string(),
    publishConsent: z.boolean().refine((v) => v === true, t.errConsent),
  });
}

type ReviewFormValues = z.infer<ReturnType<typeof buildReviewFormSchema>>;

interface ReviewFormProps {
  /** Davet/portal ucuna göndermeyi yapar; hata fırlatırsa form uygun mesajı gösterir. */
  submit: (input: SubmitReviewRequest) => Promise<unknown>;
  doctorName?: string | null;
  /** Başarıdan sonra (teşekkür ekranı görünürken) çağrılır. */
  onSubmitted?: () => void;
  /** Sunucu 404 döndüğünde (geçersiz/kullanılmış bağlantı). */
  onInvalid?: () => void;
  /** Başlık (`h2`) gösterilsin mi; portal içinde ayrı başlık varsa `false`. */
  showHeading?: boolean;
}

/**
 * Paket Y — ortak yorum formu (davet bağlantısı sayfası ve hasta portalı). Yıldız seçimi klavye erişilebilir
 * `radio` grubudur; yayın onayı kutusu zorunludur; tanı/ilaç uyarısı formun içinde sürekli görünür.
 */
export function ReviewForm({ submit, doctorName, onSubmitted, onInvalid, showHeading = true }: ReviewFormProps) {
  const { t, intlLocale } = useReviewStrings();
  const localize = useLocalizePath();
  const [privacyHref, setPrivacyHref] = useState<string | null>(null);
  const [contentWarned, setContentWarned] = useState(false);
  const countries = useMemo(() => countryOptions(intlLocale), [intlLocale]);
  const schema = useMemo(() => buildReviewFormSchema(t), [t]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ReviewFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { rating: 0, title: "", body: "", displayMode: "initials", country: "", publishConsent: false },
  });

  const rating = watch("rating");
  const bodyValue = watch("body") ?? "";
  const titleValue = watch("title") ?? "";
  const bodyLength = bodyValue.length;

  // Aydınlatma metni bağlantısı: mevcut KVKK sayfası yardımcısı; sayfa yoksa bağlantı gösterilmez.
  useEffect(() => {
    let cancelled = false;
    void fetchLegalPagesClient().then((pages) => {
      const page = resolveKvkkConsentPage(pages);
      if (!cancelled && page) setPrivacyHref(localize(`/${page.slug}`));
    });
    return () => {
      cancelled = true;
    };
  }, [localize]);

  // Metin değişince yumuşak uyarı sıfırlanır.
  useEffect(() => {
    setContentWarned(false);
  }, [bodyValue, titleValue]);

  async function onValid(values: ReviewFormValues) {
    setServerError(null);
    if (!contentWarned && looksLikeContactInfo(`${values.title}
${values.body}`)) {
      setContentWarned(true);
      return;
    }
    try {
      await submit({
        rating: values.rating,
        title: values.title,
        body: values.body,
        displayMode: values.displayMode,
        ...(values.country ? { country: values.country } : {}),
        publishConsent: true,
        consentTextVersion: REVIEW_CONSENT_TEXT_VERSION,
      });
      setDone(true);
      onSubmitted?.();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 404) {
          onInvalid?.();
          return;
        }
        if (err.status === 409) return setServerError(t.errAlreadyReviewed);
        if (err.status === 422 && !err.details) return setServerError(t.errNotCompleted);
      }
      setServerError(t.errGeneric);
    }
  }

  if (done) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 rounded-[var(--site-radius)] border border-success/30 bg-success/10 p-8 text-center">
        <CircleCheck className="h-8 w-8 text-success" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-foreground">{t.thanksTitle}</h2>
        <p className="text-sm text-foreground/70">{t.thanksBody}</p>
      </div>
    );
  }

  const displayModeLabel: Record<ReviewFormDisplayMode, string> = {
    initials: t.displayModeInitials,
    first_initial: t.displayModeFirstInitial,
    anonymous: t.displayModeAnonymous,
  };

  return (
    <form onSubmit={handleSubmit(onValid)} noValidate className="space-y-6" aria-label={t.formTitle}>
      <div>
        {showHeading && <h2 className="text-xl font-semibold text-foreground">{t.formTitle}</h2>}
        {doctorName && <p className="mt-1 text-sm font-medium text-foreground/80">{fillReview(t.formDoctor, { doctor: doctorName })}</p>}
        <p className="mt-1 text-sm text-foreground/60">{t.formIntro}</p>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-foreground">{t.ratingLabel}</legend>
        <div className="flex items-center gap-1" role="radiogroup" aria-describedby={errors.rating ? "review-rating-error" : undefined}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="relative cursor-pointer rounded-md p-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <input
                type="radio"
                name="rating"
                value={n}
                checked={rating === n}
                onChange={() => setValue("rating", n, { shouldValidate: true })}
                aria-label={fillReview(t.ratingOptionAria, { n })}
                className="peer sr-only"
              />
              <Star aria-hidden="true" className={cn("h-8 w-8 transition-colors", n <= rating ? "fill-current text-warning" : "text-foreground/25")} />
            </label>
          ))}
        </div>
        {errors.rating && (
          <p id="review-rating-error" role="alert" className="mt-1 text-xs text-danger">
            {errors.rating.message}
          </p>
        )}
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="review-title" className="text-sm font-medium text-foreground">
          {t.titleLabel}
        </label>
        <Input id="review-title" maxLength={TITLE_MAX} aria-invalid={Boolean(errors.title)} {...register("title")} />
        {errors.title && (
          <p role="alert" className="text-xs text-danger">
            {errors.title.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="review-body" className="text-sm font-medium text-foreground">
          {t.bodyLabel}
        </label>
        <Textarea id="review-body" rows={6} maxLength={REVIEW_BODY_MAX} aria-invalid={Boolean(errors.body)} aria-describedby="review-body-hint" {...register("body")} />
        <div id="review-body-hint" className="flex items-center justify-between gap-3 text-xs text-foreground/60">
          <span>{fillReview(t.bodyMinHint, { min: REVIEW_BODY_MIN })}</span>
          <span className="tabular-nums">{fillReview(t.bodyCounter, { count: bodyLength, max: REVIEW_BODY_MAX })}</span>
        </div>
        {errors.body && (
          <p role="alert" className="text-xs text-danger">
            {errors.body.message}
          </p>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-foreground/80">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <p>{t.privacyWarning}</p>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-foreground">{t.displayModeLabel}</legend>
        <div className="space-y-2">
          {DISPLAY_MODES.map((mode) => (
            <label key={mode} className="flex cursor-pointer items-center gap-2 text-sm text-foreground/80">
              <input type="radio" value={mode} className="h-4 w-4 accent-[var(--site-primary)]" {...register("displayMode")} />
              {displayModeLabel[mode]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="review-country" className="text-sm font-medium text-foreground">
          {t.countryLabel}
        </label>
        <select
          id="review-country"
          className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          {...register("country")}
        >
          <option value="">{t.countryNone}</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground/80">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--site-primary)]" aria-invalid={Boolean(errors.publishConsent)} {...register("publishConsent")} />
          <span>{t.consentLabel}</span>
        </label>
        {privacyHref && (
          <a href={privacyHref} target="_blank" rel="noopener noreferrer" className="ms-6 mt-1 inline-block text-xs font-medium text-[var(--site-primary)] hover:underline">
            {t.consentPrivacyLink}
          </a>
        )}
        {errors.publishConsent && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {errors.publishConsent.message}
          </p>
        )}
      </div>

      {contentWarned && <Alert variant="warning">{t.contentWarning}</Alert>}
      {serverError && <Alert variant="error">{serverError}</Alert>}

      <Button type="submit" size="lg" loading={isSubmitting} disabled={isSubmitting}>
        {isSubmitting ? t.submitting : t.submit}
      </Button>
    </form>
  );
}
