"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { ChevronLeft, Info, Pencil } from "lucide-react";
import { ApiClientError } from "@/lib/api/error";
import { CONTACT_LANGUAGES, CONTACT_LANGUAGE_NATIVE_NAMES, type ContactLanguage, type PreferredContactChannel } from "@/lib/api/consultation-requests";
import {
  buildServiceConsultationPayload,
  createServiceConsultation,
  getServiceConsultationSlots,
  type ServiceConsultationConfig,
  type ServiceConsultationCreated,
} from "@/lib/api/service-consultations";
import { browserTimeZone } from "@/lib/dual-time";
import { countryName } from "@/lib/country-display";
import { contentLocaleToIntl, withLatinDigits } from "@/lib/i18n/content-locale-to-intl";
import type { RequestStrings } from "@/lib/i18n/site-dictionaries/en/request";
import type { ServiceBookingStrings } from "@/lib/i18n/site-dictionaries/en/service-booking";
import type { ServiceGroupId } from "@/lib/service-groups";
import { AvailabilityCalendar } from "@/components/site/telehealth/availability-calendar";
import { BookingSelectionProvider, useBookingSelection } from "@/components/site/telehealth/booking-selection-context";
import { DualDateTimeSummary } from "@/components/site/telehealth/dual-time";
import { BookingStepperBar, type BookingStepperStep } from "@/components/site/telehealth/booking-stepper-bar";
import { RequestServicePicker, type RequestServiceGroup } from "@/components/site/request/request-service-picker";
import { composePhone } from "@/components/site/request/request-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DETAILS_STEP_FIELDS,
  ServiceBookingDetailsStep,
  buildDetailsSchema,
  type DetailsFormValues,
} from "./service-booking-details-step";
import { ServiceBookingSummaryPanel } from "./service-booking-summary-panel";
import { ServiceBookingSuccess } from "./service-booking-success";
import { ServiceBookingUnavailable } from "./service-booking-unavailable";
import { useServiceSlots } from "./use-service-slots";

const TOTAL_STEPS = 4;
type WizardStep = 1 | 2 | 3 | 4;

/** Backend `details.<alan>` anahtarları → form alanı (AH ile aynı) ve hata verdiği adım. */
const SERVER_FIELD_MAP: Record<string, keyof DetailsFormValues | "service" | "slot"> = {
  serviceSlug: "service",
  specialtySlug: "service",
  packageSlug: "service",
  startsAt: "slot",
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

export interface ServiceBookingWizardProps {
  lang: string;
  strings: ServiceBookingStrings;
  /** AH talep formu sözlüğü: alan etiketleri/hata metinleri/rıza metinleri buradan (aynı alanlar ve kurallar). */
  requestStrings: RequestStrings;
  groups: RequestServiceGroup[];
  groupTitles: Record<ServiceGroupId, string>;
  /** `?service=` ile gelen, listede bulunan hizmet. */
  initialService: string | null;
  /** `?package=` ile gelen, aktif paket. Varsa hizmet adımı atlanır; gövdede `packageSlug` gider. */
  pkg: { slug: string; title: string } | null;
  config: Pick<ServiceConsultationConfig, "timeZone" | "durationMin" | "horizonDays">;
  privacyHref: string | null;
  consentHref: string | null;
  homeHref: string;
  servicesHref: string;
  /** "Request a call back" (talep formu). */
  callbackHref: string;
  /** `null` = "Find your treatment" bağlantısı gizli (Paket AK). */
  findTreatmentHref: string | null;
}

export function ServiceBookingWizard(props: ServiceBookingWizardProps) {
  return (
    <BookingSelectionProvider doctorTimeZone={props.config.timeZone}>
      <WizardInner {...props} />
    </BookingSelectionProvider>
  );
}

function WizardInner({
  lang,
  strings: s,
  requestStrings: t,
  groups,
  groupTitles,
  initialService,
  pkg,
  config,
  privacyHref,
  consentHref,
  homeHref,
  servicesHref,
  callbackHref,
  findTreatmentHref,
}: ServiceBookingWizardProps) {
  const intlLocale = withLatinDigits(contentLocaleToIntl(lang));
  const { selectedSlots, clearAllSlots, displayTimeZone, visitorTimeZone } = useBookingSelection();

  const [service, setService] = useState(initialService ?? "");
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStep>(initialService || pkg ? 2 : 1);
  const { state: slotsState, refresh: refreshSlots } = useServiceSlots(config);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<ServiceConsultationCreated | null>(null);
  const [bookingRejected, setBookingRejected] = useState(false);
  const notBookable = bookingRejected || slotsState.status === "unavailable";
  const setNotBookable = setBookingRejected;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const defaultContactLanguage: ContactLanguage = (CONTACT_LANGUAGES as readonly string[]).includes(lang) ? (lang as ContactLanguage) : "en";
  const schema = useMemo(() => buildDetailsSchema(t), [t]);
  const form = useForm<DetailsFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      website: "",
      country: "",
      contactLanguage: defaultContactLanguage,
      needsInterpreter: false,
      interpreterLanguage: defaultContactLanguage,
      fullName: "",
      email: "",
      dial: "",
      phone: "",
      channel: "email",
      message: "",
      contactConsent: false,
      healthDataConsent: false,
    },
  });

  const allServices = useMemo(() => groups.flatMap((g) => [{ slug: g.slug, name: g.name }, ...g.children]), [groups]);
  const serviceName = pkg ? pkg.title : allServices.find((x) => x.slug === service)?.name ?? null;

  // Takvimin doktor sözcüğü geçen varsayılan metinleri hizmet görüşmesi metinleriyle değiştirilir.
  const calendarStrings = useMemo(
    () => ({
      schedule: { dayUnavailable: s.dayUnavailable, noSlotsTitle: s.noSlotsTitle, noSlotsCta: s.noSlotsCta },
      calendar: { morningGroupAria: s.morningGroupAria, afternoonGroupAria: s.afternoonGroupAria, eveningGroupAria: s.eveningGroupAria },
    }),
    [s]
  );

  // Adım değişince başlığa odaklan (ekran okuyucu + klavye); ilk çizimde odak çalma.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (created) document.getElementById("service-booking-success-title")?.focus();
  }, [created]);

  const stepLabels = [s.stepService, s.stepDateTime, s.stepDetails, s.stepConfirm];
  const steps: BookingStepperStep[] = stepLabels.map((label, i) => {
    const index = i + 1;
    return { index, label, status: index === step ? "current" : index < step ? "completed" : "upcoming" };
  });

  function goToStep(next: WizardStep) {
    setSubmitError(null);
    setStep(next);
  }

  if (notBookable) return <ServiceBookingUnavailable strings={s} callbackHref={callbackHref} />;

  if (created) {
    return (
      <ServiceBookingSuccess
        strings={s}
        result={created}
        displayTimeZone={displayTimeZone}
        intlLocale={intlLocale}
        serviceName={serviceName}
        homeHref={homeHref}
        servicesHref={servicesHref}
      />
    );
  }

  async function submitBooking(values: DetailsFormValues) {
    const slot = selectedSlots[0];
    if (!slot) {
      goToStep(2);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const phone = composePhone(values.dial, values.phone);
    const body = buildServiceConsultationPayload({
      serviceSlug: pkg ? null : service || null,
      packageSlug: pkg?.slug ?? null,
      country: values.country,
      contactLanguage: values.contactLanguage as ContactLanguage,
      needsInterpreter: values.needsInterpreter,
      interpreterLanguage: values.needsInterpreter ? (values.interpreterLanguage as ContactLanguage) : null,
      fullName: values.fullName.trim(),
      email: values.email.trim(),
      phone: phone || null,
      preferredContactChannel: values.channel,
      message: values.message.trim() || null,
      contactConsent: values.contactConsent,
      healthDataConsent: values.healthDataConsent && values.message.trim().length > 0,
      locale: lang,
      website: values.website,
      startsAt: slot.startsAt,
      patientTimeZone: visitorTimeZone ?? browserTimeZone() ?? config.timeZone,
    });
    try {
      const result = await createServiceConsultation(body);
      setCreated(result);
    } catch (err) {
      handleSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmitError(err: unknown) {
    if (err instanceof ApiClientError) {
      if (err.code === "SLOT_TAKEN" || (err.status === 409 && err.code !== "SERVICE_CONSULTATION_LIMIT")) {
        // Slot başkasına gitti: seçimi temizle, takvimi yeniden yükle, mesaj göster.
        clearAllSlots();
        setConflictNotice(s.slotTaken);
        setStep(2);
        refreshSlots();
        return;
      }
      if (err.code === "SERVICE_NOT_BOOKABLE" || err.status === 404) {
        setNotBookable(true);
        return;
      }
      if (err.code === "SERVICE_CONSULTATION_LIMIT") {
        setSubmitError(s.limitReached);
        return;
      }
      if (err.status === 429) {
        setSubmitError(s.errorRateLimit);
        return;
      }
      if (err.status === 0) {
        setSubmitError(s.errorNetwork);
        return;
      }
      if (err.details) {
        let target: WizardStep | null = null;
        for (const [key, messages] of Object.entries(err.details)) {
          const field = SERVER_FIELD_MAP[key];
          if (!field) continue;
          const text = messages[0] || t.required;
          if (field === "service") {
            setServiceError(text);
            target = 1;
          } else if (field === "slot") {
            setConflictNotice(text);
            target = target ?? 2;
          } else {
            form.setError(field, { message: text });
            target = target === null || target > 3 ? 3 : target;
          }
        }
        if (target !== null) {
          setStep(target);
          setSubmitError(s.errorFields);
          return;
        }
      }
    }
    setSubmitError(s.errorGeneric);
  }

  async function handleContinue() {
    if (step === 1) {
      if (!pkg && !service) {
        setServiceError(t.required);
        return;
      }
      setServiceError(null);
      goToStep(2);
      return;
    }
    if (step === 2) {
      if (selectedSlots.length === 0) return;
      setConflictNotice(null);
      goToStep(3);
      return;
    }
    if (step === 3) {
      const ok = await form.trigger(DETAILS_STEP_FIELDS, { shouldFocus: true });
      if (ok) goToStep(4);
      return;
    }
    await form.handleSubmit(submitBooking, (invalid) => {
      const fields = Object.keys(invalid);
      if (fields.length > 0) setStep(3);
      setSubmitError(s.errorFields);
    })();
  }

  const continueDisabled = step === 1 ? false : step === 2 ? selectedSlots.length === 0 || slotsState.status !== "ready" : false;
  const continueLabel = step === 4 ? (submitting ? s.confirming : s.confirmCta) : s.continueCta;
  const values = form.getValues();
  const channelLabels: Record<PreferredContactChannel, string> = { email: t.channelEmail, whatsapp: t.channelWhatsapp, phone: t.channelPhone };

  const backButtonClass =
    "mb-3 inline-flex items-center gap-1 rounded-[var(--site-radius)] text-sm font-medium text-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
  const cardClass = "rounded-[var(--site-radius)] border border-border bg-surface p-5 sm:p-6";

  const reviewRows: { label: string; value: string; step: WizardStep }[] = [
    { label: t.fullNameLabel, value: values.fullName.trim(), step: 3 },
    { label: t.emailLabel, value: values.email.trim(), step: 3 },
    { label: t.phoneLabel, value: composePhone(values.dial, values.phone) || t.reviewNotProvided, step: 3 },
    { label: t.preferredChannelLabel, value: channelLabels[values.channel], step: 3 },
    { label: t.countryLabel, value: values.country ? countryName(values.country, intlLocale) : t.reviewNotProvided, step: 3 },
    { label: t.contactLanguageLabel, value: CONTACT_LANGUAGE_NATIVE_NAMES[values.contactLanguage as ContactLanguage] ?? values.contactLanguage, step: 3 },
    {
      label: t.interpreterLabel,
      value: values.needsInterpreter ? `${t.interpreterYes} (${CONTACT_LANGUAGE_NATIVE_NAMES[values.interpreterLanguage as ContactLanguage] ?? values.interpreterLanguage})` : t.interpreterNo,
      step: 3,
    },
    ...(values.message.trim() ? [{ label: t.messageLabel, value: values.message.trim(), step: 3 as WizardStep }] : []),
  ];

  return (
    <div className="space-y-6" data-crm-ignore="" data-testid="service-booking-wizard">
      <BookingStepperBar steps={steps} />

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
        }}
        aria-label={s.stepsAria}
        className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start"
      >
        {step === 2 ? (
          <>
            <div className="lg:col-span-12">
              <button type="button" onClick={() => goToStep(1)} className={backButtonClass} data-testid="booking-back">
                <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                {s.backToService}
              </button>
              <h2 ref={headingRef} tabIndex={-1} className="font-heading text-xl font-semibold tracking-tight text-foreground outline-none sm:text-2xl">
                {s.stepDateTime}
              </h2>
            </div>
            {slotsState.status === "loading" && (
              <div className="space-y-3 lg:col-span-9" role="status" aria-live="polite" data-testid="booking-slots-loading">
                <span className="sr-only">{s.loadingSlots}</span>
                <Skeleton className="h-10 w-2/3" />
                <div className="grid gap-4 lg:grid-cols-9">
                  <Skeleton className="h-72 lg:col-span-4" />
                  <Skeleton className="h-72 lg:col-span-5" />
                </div>
              </div>
            )}
            {slotsState.status === "error" && (
              <div className="space-y-3 lg:col-span-9" data-testid="booking-slots-error">
                <Alert variant="error">{s.loadErrorTitle}</Alert>
                <Button type="button" variant="outline" onClick={refreshSlots}>
                  {s.retry}
                </Button>
              </div>
            )}
            {slotsState.status === "ready" && (
              <AvailabilityCalendar
                doctorTimeZone={config.timeZone}
                initialSlots={slotsState.slots}
                conflictNotice={conflictNotice}
                fetchSlots={getServiceConsultationSlots}
                singleSelect
                latinDigits
                requestHref={callbackHref}
                stringOverrides={calendarStrings}
              />
            )}
          </>
        ) : (
          <div className="min-w-0 space-y-4 lg:col-span-9">
            {step === 1 && (
              <section className={cardClass} data-testid="booking-step-service">
                <h2 ref={headingRef} tabIndex={-1} className="mb-5 font-heading text-xl font-semibold tracking-tight text-foreground outline-none sm:text-2xl">
                  {s.stepService}
                </h2>
                {pkg ? (
                  <div className="rounded-[var(--site-radius)] border border-[var(--site-primary)]/30 bg-[var(--site-primary)]/5 p-4 text-sm" data-testid="booking-package">
                    <span className="block text-xs font-semibold text-foreground/70">{t.packageLabel}</span>
                    <span className="font-semibold text-foreground">{pkg.title}</span>
                  </div>
                ) : groups.length === 0 ? (
                  <div role="alert" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <p>{t.servicesUnavailable}</p>
                  </div>
                ) : (
                  <RequestServicePicker
                    strings={t}
                    groups={groups}
                    groupTitles={groupTitles}
                    value={service}
                    onChange={(slug) => {
                      setService(slug);
                      setServiceError(null);
                    }}
                    error={serviceError ?? undefined}
                    findTreatmentHref={findTreatmentHref}
                  />
                )}
                <p className="mt-5 text-sm text-foreground/70">
                  {s.callbackPrompt}{" "}
                  <Link href={callbackHref} className="font-semibold text-[var(--site-primary)] underline">
                    {s.callbackLink}
                  </Link>
                </p>
              </section>
            )}

            {step === 3 && (
              <section className={cardClass} data-testid="booking-step-details">
                <button type="button" onClick={() => goToStep(2)} className={backButtonClass} data-testid="booking-back">
                  <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                  {s.backToDateTime}
                </button>
                <h2 ref={headingRef} tabIndex={-1} className="mb-5 font-heading text-xl font-semibold tracking-tight text-foreground outline-none sm:text-2xl">
                  {s.stepDetails}
                </h2>
                <ServiceBookingDetailsStep form={form} strings={s} requestStrings={t} lang={lang} privacyHref={privacyHref} consentHref={consentHref} />
              </section>
            )}

            {step === 4 && (
              <section className={cardClass} data-testid="booking-step-confirm">
                <button type="button" onClick={() => goToStep(3)} className={backButtonClass} data-testid="booking-back">
                  <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                  {s.backToDetails}
                </button>
                <h2 ref={headingRef} tabIndex={-1} className="mb-2 font-heading text-xl font-semibold tracking-tight text-foreground outline-none sm:text-2xl">
                  {s.stepConfirm}
                </h2>
                <p className="mb-5 text-sm text-foreground/70">{s.confirmHint}</p>
                <dl className="divide-y divide-border rounded-[var(--site-radius)] border border-border bg-background text-sm" data-testid="booking-review">
                  <div className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <dt className="text-xs text-foreground/70">{s.reviewService}</dt>
                      <dd className="mt-0.5 break-words font-medium text-foreground">{serviceName ?? s.summaryServicePending}</dd>
                    </div>
                    <EditButton label={s.reviewService} editLabel={s.editRow} onClick={() => goToStep(1)} />
                  </div>
                  <div className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <dt className="text-xs text-foreground/70">{s.reviewWhen}</dt>
                      <dd className="mt-1 font-medium text-foreground">
                        {selectedSlots[0] && (
                          <DualDateTimeSummary iso={selectedSlots[0].startsAt} endIso={selectedSlots[0].endsAt} timeZone={displayTimeZone} intlLocale={intlLocale} />
                        )}
                      </dd>
                    </div>
                    <EditButton label={s.reviewWhen} editLabel={s.editRow} onClick={() => goToStep(2)} />
                  </div>
                  <div className="px-4 py-3">
                    <dt className="text-xs text-foreground/70">{s.reviewWith}</dt>
                    <dd className="mt-0.5 font-medium text-foreground">{s.coordinatorTitle}</dd>
                  </div>
                  <div className="px-4 py-3">
                    <dt className="text-xs text-foreground/70">{s.reviewPrice}</dt>
                    <dd className="mt-0.5 font-medium text-foreground">{s.freeLabel}</dd>
                  </div>
                  {reviewRows.map((row) => (
                    <div key={row.label} className="flex items-start justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <dt className="text-xs text-foreground/70">{row.label}</dt>
                        <dd className="mt-0.5 break-words font-medium text-foreground">{row.value}</dd>
                      </div>
                      <EditButton label={row.label} editLabel={s.editRow} onClick={() => goToStep(row.step)} />
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-xs text-foreground/60">{s.medicalNote}</p>
                <p className="mt-1 text-xs text-foreground/60">{s.intermediaryNote}</p>
                {submitError && (
                  <div className="mt-4" data-testid="booking-error">
                    <Alert variant="error">{submitError}</Alert>
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        <aside className="lg:sticky lg:top-6 lg:col-span-3 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
          <ServiceBookingSummaryPanel
            strings={s}
            serviceName={serviceName}
            durationMin={config.durationMin}
            intlLocale={intlLocale}
            currentStep={step}
            totalSteps={TOTAL_STEPS}
            onContinue={() => void handleContinue()}
            continueDisabled={continueDisabled || submitting}
            continueLoading={submitting}
            showContinueButton
            locked={step === 4}
            continueLabel={continueLabel}
          />
          {step !== 4 && submitError && (
            <div className="mt-3">
              <Alert variant="error">{submitError}</Alert>
            </div>
          )}
        </aside>
      </form>
    </div>
  );
}

function EditButton({ label, editLabel, onClick }: { label: string; editLabel: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${editLabel}: ${label}`}
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-[var(--site-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--site-primary)]"
    >
      <Pencil className="size-3.5" aria-hidden="true" />
      {editLabel}
    </button>
  );
}
