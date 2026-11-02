"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Ban, CalendarCheck, CalendarClock, CalendarX2, ChevronLeft } from "lucide-react";
import { ApiClientError } from "@/lib/api/error";
import {
  cancelServiceConsultation,
  getServiceConsultationConfig,
  getServiceConsultationSlots,
  lookupServiceConsultation,
  rescheduleServiceConsultation,
  type ServiceConsultationConfig,
  type ServiceConsultationManageView,
} from "@/lib/api/service-consultations";
import { browserTimeZone } from "@/lib/dual-time";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { ServiceBookingStrings } from "@/lib/i18n/site-dictionaries/en/service-booking";
import { AvailabilityCalendar } from "@/components/site/telehealth/availability-calendar";
import { BookingSelectionProvider, useBookingSelection } from "@/components/site/telehealth/booking-selection-context";
import { DualDateTimeSummary, usePatientDisplayTimeZone } from "@/components/site/telehealth/dual-time";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useServiceSlots } from "./use-service-slots";

/** Yönetim belirteci biçimi (`sc_…`); sunucu bağlayıcıdır, bu yalnızca anlamsız istekleri önler. */
const TOKEN_PATTERN = /^sc_[A-Za-z0-9_-]{16,128}$/;

/**
 * Adres çubuğundaki `#sc_…` parçasını okur ve geçmişten SİLER (belirteç URL'de, Referer'da ve geçmişte kalmaz). AG
 * `guest-join-flow.tsx::takeTokenFromLocation` ile aynı desen; ağır oda modüllerini içe aktarmamak için burada ayrı.
 */
export function takeManageTokenFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return null;
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  return raw;
}

type Stage =
  | { kind: "checking" }
  | { kind: "invalid" }
  | { kind: "error"; message: string }
  | { kind: "view"; data: ServiceConsultationManageView }
  | { kind: "reschedule"; data: ServiceConsultationManageView; token: string }
  | { kind: "cancelled" }
  | { kind: "rescheduled"; startsAt: string; endsAt: string };

function Notice({ icon, title, body, actions, testId }: { icon: React.ReactNode; title: string; body?: string; actions?: React.ReactNode; testId: string }) {
  return (
    <div role="status" className="mx-auto max-w-xl rounded-[var(--site-radius)] border border-border bg-surface p-8 text-center" data-testid={testId}>
      <div className="mx-auto flex w-fit text-foreground/40" aria-hidden="true">
        {icon}
      </div>
      <h1 className="mt-4 font-heading text-xl font-semibold text-foreground">{title}</h1>
      {body && <p className="mt-2 text-sm text-foreground/70">{body}</p>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-3">{actions}</div>}
    </div>
  );
}

/**
 * `/{lang}/book-consultation/manage#sc_…` — hastanın e-postadaki yönetim bağlantısıyla görüşmesini görüntülemesi,
 * iptal etmesi ve saatini değiştirmesi. Uçlar YALNIZCA tarayıcıdan çağrılır. Geçersiz/süresi dolmuş/iptal edilmiş
 * bağlantılar TEK tip "bağlantı geçersiz" ekranı gösterir (neden belirtilmez).
 */
export function ServiceConsultationManage({
  lang,
  strings: s,
  bookHref,
  homeHref,
}: {
  lang: string;
  strings: ServiceBookingStrings;
  bookHref: string;
  homeHref: string;
}) {
  const intlLocale = contentLocaleToIntl(lang);
  const [stage, setStage] = useState<Stage>({ kind: "checking" });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const displayTimeZone = usePatientDisplayTimeZone();

  const lookup = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || !TOKEN_PATTERN.test(token)) {
      setStage({ kind: "invalid" });
      return;
    }
    try {
      const data = await lookupServiceConsultation(token);
      setStage({ kind: "view", data });
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 404 || err.status === 400 || err.status === 422)) setStage({ kind: "invalid" });
      else setStage({ kind: "error", message: s.manageErrorGeneric });
    }
  }, [s]);

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      tokenRef.current = takeManageTokenFromLocation();
    }
    void lookup();
    // Yalnızca bağlandığında bir kez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirmCancel() {
    const token = tokenRef.current;
    if (!token) return;
    setCancelling(true);
    try {
      await cancelServiceConsultation(token);
      setCancelOpen(false);
      setStage({ kind: "cancelled" });
    } catch (err) {
      setCancelOpen(false);
      if (err instanceof ApiClientError && err.status === 404) setStage({ kind: "invalid" });
      else if (err instanceof ApiClientError && err.code === "CONSULTATION_NOT_CHANGEABLE") {
        setNotice(s.manageNotChangeable);
        void lookup();
      } else setNotice(s.manageErrorGeneric);
    } finally {
      setCancelling(false);
    }
  }

  const wrapperClass = "mx-auto max-w-[1360px] px-4 py-10 sm:px-6 md:py-14 xl:px-8";
  let content: React.ReactNode;

  if (stage.kind === "checking") {
    content = (
      <div role="status" className="mx-auto max-w-xl space-y-3" data-testid="manage-checking">
        <span className="sr-only">{s.manageChecking}</span>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  } else if (stage.kind === "invalid") {
    content = (
      <Notice
        testId="manage-invalid"
        icon={<Ban className="h-9 w-9" />}
        title={s.manageInvalidTitle}
        body={s.manageInvalidBody}
        actions={
          <Link href={bookHref} className={cn(buttonVariants({ variant: "default" }), "rounded-[var(--site-radius)]")}>
            {s.manageBookAgain}
          </Link>
        }
      />
    );
  } else if (stage.kind === "error") {
    content = (
      <Notice
        testId="manage-error"
        icon={<Ban className="h-9 w-9" />}
        title={stage.message}
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setStage({ kind: "checking" });
              void lookup();
            }}
          >
            {s.retry}
          </Button>
        }
      />
    );
  } else if (stage.kind === "cancelled") {
    content = (
      <Notice
        testId="manage-cancelled"
        icon={<CalendarX2 className="h-9 w-9" />}
        title={s.manageCancelledTitle}
        body={s.manageCancelledBody}
        actions={
          <>
            <Link href={bookHref} className={cn(buttonVariants({ variant: "default" }), "rounded-[var(--site-radius)]")}>
              {s.manageBookAgain}
            </Link>
            <Link href={homeHref} className={cn(buttonVariants({ variant: "outline" }), "rounded-[var(--site-radius)]")}>
              {s.successHome}
            </Link>
          </>
        }
      />
    );
  } else if (stage.kind === "rescheduled") {
    content = (
      <div className="mx-auto max-w-xl space-y-4" data-testid="manage-rescheduled">
        <Alert variant="success">
          <div className="space-y-3">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <CalendarCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
              {s.manageRescheduledTitle}
            </h1>
            <DualDateTimeSummary iso={stage.startsAt} endIso={stage.endsAt} timeZone={displayTimeZone} intlLocale={intlLocale} />
            <p className="text-sm">{s.manageRescheduledBody}</p>
          </div>
        </Alert>
        <Link href={homeHref} className={cn(buttonVariants({ variant: "outline" }), "rounded-[var(--site-radius)]")}>
          {s.successHome}
        </Link>
      </div>
    );
  } else if (stage.kind === "reschedule") {
    content = (
      <ReschedulePanel
        strings={s}
        token={stage.token}
        onBack={() => setStage({ kind: "view", data: stage.data })}
        onDone={(startsAt, endsAt) => setStage({ kind: "rescheduled", startsAt, endsAt })}
        onInvalid={() => setStage({ kind: "invalid" })}
        onNotChangeable={() => {
          setNotice(s.manageNotChangeable);
          setStage({ kind: "checking" });
          void lookup();
        }}
        intlLocale={intlLocale}
      />
    );
  } else {
    const { data } = stage;
    const scheduled = data.status === "SCHEDULED";
    const statusLabel =
      data.status === "SCHEDULED"
        ? s.manageStatusScheduled
        : data.status === "CANCELLED"
          ? s.manageStatusCancelled
          : data.status === "COMPLETED"
            ? s.manageStatusCompleted
            : s.manageStatusMissed;
    content = (
      <div className="mx-auto max-w-2xl space-y-5" data-testid="manage-view">
        <div className="rounded-[var(--site-radius)] border border-border bg-surface p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h1 className="font-heading text-xl font-semibold text-foreground sm:text-2xl">{s.manageTitle}</h1>
            <span
              className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-semibold text-foreground/80"
              data-testid="manage-status"
              data-status={data.status}
            >
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-foreground/70" data-testid="manage-number">
            {formatSiteString(s.manageNumber, { number: data.consultationNumber })}
          </p>
          <dl className="mt-5 divide-y divide-border rounded-[var(--site-radius)] border border-border bg-background text-sm">
            <div className="px-4 py-3">
              <dt className="text-xs text-foreground/70">{s.manageService}</dt>
              <dd className="mt-0.5 font-medium text-foreground">{data.serviceName}</dd>
            </div>
            <div className="px-4 py-3">
              <dt className="text-xs text-foreground/70">{s.manageWhen}</dt>
              <dd className="mt-1">
                <DualDateTimeSummary iso={data.startsAt} endIso={data.endsAt} timeZone={displayTimeZone} intlLocale={intlLocale} />
              </dd>
            </div>
            <div className="px-4 py-3">
              <dt className="text-xs text-foreground/70">{s.manageWith}</dt>
              <dd className="mt-0.5 font-medium text-foreground">{s.coordinatorTitle}</dd>
            </div>
          </dl>
          {scheduled && <p className="mt-4 text-sm text-foreground/70">{s.manageJoinNote}</p>}
          {notice && (
            <div className="mt-4">
              <Alert variant="error">{notice}</Alert>
            </div>
          )}
          {scheduled && !(data.canCancel || data.canReschedule) && <p className="mt-4 text-xs text-foreground/60">{s.manageLockedNote}</p>}
          {scheduled && (data.canCancel || data.canReschedule) && (
            <div className="mt-5 flex flex-wrap gap-3">
              {data.canReschedule && (
                <Button type="button" onClick={() => {
                    const token = tokenRef.current;
                    if (token) setStage({ kind: "reschedule", data, token });
                  }} data-testid="manage-reschedule">
                  <CalendarClock className="size-4" aria-hidden="true" />
                  {s.manageRescheduleAction}
                </Button>
              )}
              {data.canCancel && (
                <Button type="button" variant="outline" onClick={() => setCancelOpen(true)} data-testid="manage-cancel">
                  {s.manageCancelAction}
                </Button>
              )}
            </div>
          )}
          <p className="mt-5 border-t border-border pt-3 text-xs text-foreground/60">{s.medicalNote}</p>
        </div>
      </div>
    );
  }

  return (
    <div dir={localeDirection(lang)} className={wrapperClass} data-testid="manage-page">
      {content}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={s.manageCancelTitle}
        description={s.manageCancelBody}
        confirmText={s.manageCancelYes}
        cancelText={s.manageCancelNo}
        tone="danger"
        loading={cancelling}
        onConfirm={() => void confirmCancel()}
      />
    </div>
  );
}

/** "Change time": eski randevu takvimi/saat ızgarasıyla (tek seçim) yeni slot seçimi. */
function ReschedulePanel(props: {
  strings: ServiceBookingStrings;
  token: string | null;
  intlLocale: string;
  onBack: () => void;
  onDone: (startsAt: string, endsAt: string) => void;
  onInvalid: () => void;
  onNotChangeable: () => void;
}) {
  const [config, setConfig] = useState<ServiceConsultationConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const { strings: s, onBack } = props;

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getServiceConsultationConfig().then(
      (value) => {
        if (!cancelled) setConfig(value);
      },
      () => {
        if (!cancelled) setConfigError(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (configError) {
    return (
      <div className="mx-auto max-w-xl space-y-3" data-testid="manage-reschedule-error">
        <Alert variant="error">{s.loadErrorTitle}</Alert>
        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={() => {
              setConfigError(false);
              setAttempt((n) => n + 1);
            }}>
            {s.retry}
          </Button>
          <Button type="button" variant="ghost" onClick={onBack}>
            {s.manageRescheduleBack}
          </Button>
        </div>
      </div>
    );
  }
  if (!config) {
    return (
      <div role="status" className="space-y-3" data-testid="manage-reschedule-loading">
        <span className="sr-only">{s.loadingSlots}</span>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  return (
    <BookingSelectionProvider doctorTimeZone={config.timeZone}>
      <RescheduleBody {...props} config={config} />
    </BookingSelectionProvider>
  );
}

function RescheduleBody({
  strings: s,
  token,
  config,
  intlLocale,
  onBack,
  onDone,
  onInvalid,
  onNotChangeable,
}: {
  strings: ServiceBookingStrings;
  token: string | null;
  config: ServiceConsultationConfig;
  intlLocale: string;
  onBack: () => void;
  onDone: (startsAt: string, endsAt: string) => void;
  onInvalid: () => void;
  onNotChangeable: () => void;
}) {
  const { selectedSlots, clearAllSlots, visitorTimeZone, displayTimeZone } = useBookingSelection();
  const { state, refresh } = useServiceSlots(config);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const calendarStrings = useMemo(
    () => ({
      schedule: { dayUnavailable: s.dayUnavailable, noSlotsTitle: s.noSlotsTitle, noSlotsCta: s.noSlotsCta },
      calendar: { morningGroupAria: s.morningGroupAria, afternoonGroupAria: s.afternoonGroupAria, eveningGroupAria: s.eveningGroupAria },
    }),
    [s]
  );
  const slot = selectedSlots[0] ?? null;

  async function save() {
    if (!slot || !token) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await rescheduleServiceConsultation({ t: token, startsAt: slot.startsAt, patientTimeZone: visitorTimeZone ?? browserTimeZone() ?? displayTimeZone });
      onDone(res?.startsAt ?? slot.startsAt, res?.endsAt ?? slot.endsAt);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 404) return onInvalid();
        if (err.code === "SLOT_TAKEN") {
          clearAllSlots();
          setNotice(s.manageSlotTaken);
          refresh();
          return;
        }
        if (err.code === "CONSULTATION_NOT_CHANGEABLE") {
          return onNotChangeable();
        }
        if (err.status === 429) {
          setNotice(s.errorRateLimit);
          return;
        }
      }
      setNotice(s.manageErrorGeneric);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="manage-reschedule-panel">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex items-center gap-1 rounded-[var(--site-radius)] text-sm font-medium text-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
          {s.manageRescheduleBack}
        </button>
        <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{s.manageRescheduleTitle}</h1>
        <p className="mt-1 text-sm text-foreground/70">{s.manageRescheduleHint}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        {state.status === "loading" && (
          <div className="space-y-3 lg:col-span-12" role="status">
            <span className="sr-only">{s.loadingSlots}</span>
            <Skeleton className="h-72 w-full" />
          </div>
        )}
        {state.status === "error" && (
          <div className="space-y-3 lg:col-span-12">
            <Alert variant="error">{s.loadErrorTitle}</Alert>
            <Button type="button" variant="outline" onClick={refresh}>
              {s.retry}
            </Button>
          </div>
        )}
        {state.status === "unavailable" && (
          <div className="lg:col-span-12">
            <Alert variant="info">{s.notBookableTitle}</Alert>
          </div>
        )}
        {state.status === "ready" && (
          <AvailabilityCalendar
            doctorTimeZone={config.timeZone}
            initialSlots={state.slots}
            conflictNotice={notice}
            fetchSlots={getServiceConsultationSlots}
            singleSelect
            stringOverrides={calendarStrings}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!slot || saving} loading={saving} onClick={() => void save()} data-testid="manage-reschedule-confirm">
          {saving ? s.manageRescheduling : s.manageRescheduleConfirm}
        </Button>
        {slot && <DualDateTimeSummary iso={slot.startsAt} endIso={slot.endsAt} timeZone={displayTimeZone} intlLocale={intlLocale} />}
      </div>
    </div>
  );
}
