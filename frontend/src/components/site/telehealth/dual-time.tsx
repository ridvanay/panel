"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuthOptional } from "@/context/auth-context";
import { Globe, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fmt, usePortalStrings } from "@/lib/i18n/use-portal-strings";
import {
  COMMON_TIME_ZONES,
  PATIENT_TIME_ZONE_STORAGE_KEY,
  TURKEY_TIME_ZONE,
  browserTimeZone,
  isValidTimeZone,
  cityLabel,
  dualDateTimeLabels,
  dualSlotTime,
  formatHourSpan,
  gmtLabel,
  isSameClockAsTurkey,
  listTimeZones,
  searchTimeZones,
  turkeyLeadMinutes,
} from "@/lib/dual-time";

/**
 * Paket P (İş 1) — hastanın saati + Türkiye saati. Saatler her dilde `dir="ltr"` ile izole edilir
 * (Arapçada "16:00" / "GMT+3" ters dönmesin).
 */
export function LtrTime({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}

/** `Berlin (GMT+1)` — şehir adı + o andaki GMT farkı. */
export function zoneLabel(timeZone: string, at: string = new Date().toISOString()): string {
  return `${cityLabel(timeZone)} (${gmtLabel(at, timeZone)})`;
}

/**
 * Sihirbazın üstündeki bilgi satırı: "Saatler sizin saat diliminize göre gösteriliyor: Berlin (GMT+1).
 * Türkiye saati: GMT+3 · [Değiştir]". "Değiştir" aranabilir bir saat dilimi listesi açar.
 */
export function TimeZoneBar({
  timeZone,
  detectedTimeZone,
  onChange,
  className,
}: {
  timeZone: string | undefined;
  detectedTimeZone: string | undefined;
  onChange: (timeZone: string) => void;
  className?: string;
}) {
  const t = usePortalStrings().t.schedule;
  const [open, setOpen] = useState(false);
  const now = new Date().toISOString();

  return (
    <div
      data-testid="time-zone-bar"
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--site-radius)] border border-border bg-muted/50 px-3 py-2 text-xs text-foreground/70",
        className
      )}
    >
      <Globe className="h-3.5 w-3.5 shrink-0 text-foreground/50" aria-hidden="true" />
      {timeZone ? (
        <>
          <span>
            {t.timesShownIn.split("{zone}")[0]}
            <strong className="font-medium text-foreground">
              <LtrTime>{zoneLabel(timeZone, now)}</LtrTime>
            </strong>
            {t.timesShownIn.split("{zone}")[1] ?? ""}
          </span>
          <span className="text-foreground/50">
            {t.turkeyTime.split("{offset}")[0]}
            <LtrTime>{gmtLabel(now, TURKEY_TIME_ZONE)}</LtrTime>
            {t.turkeyTime.split("{offset}")[1] ?? ""}
          </span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            // Görünen "Değiştir" metni erişilebilir adın içinde kalır (WCAG 2.5.3); özet panelindeki "Değiştir" ile karışmaz.
            aria-label={`${t.change} — ${t.pickerTitle}`}
            className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            {t.change}
          </button>
        </>
      ) : (
        <span>…</span>
      )}
      <TimeZonePickerDialog
        open={open}
        onOpenChange={setOpen}
        value={timeZone}
        detectedTimeZone={detectedTimeZone}
        onSelect={(tz) => {
          onChange(tz);
          setOpen(false);
        }}
      />
    </div>
  );
}

export function TimeZonePickerDialog({
  open,
  onOpenChange,
  value,
  detectedTimeZone,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string | undefined;
  detectedTimeZone: string | undefined;
  onSelect: (timeZone: string) => void;
}) {
  const t = usePortalStrings().t.schedule;
  const [query, setQuery] = useState("");
  const zones = useMemo(() => (open ? listTimeZones() : []), [open]);
  const results = useMemo(() => searchTimeZones(query, zones), [query, zones]);
  const commonSet = useMemo(() => new Set(COMMON_TIME_ZONES.map((c) => c.tz)), []);
  const now = new Date().toISOString();
  const common = results.filter((tz) => commonSet.has(tz));
  const rest = results.filter((tz) => !commonSet.has(tz));

  const option = (tz: string) => (
    <li key={tz}>
      <button
        type="button"
        role="option"
        aria-selected={tz === value}
        onClick={() => onSelect(tz)}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-start text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
          tz === value && "bg-primary/10 font-medium text-primary"
        )}
      >
        <span className="min-w-0 truncate">
          {cityLabel(tz)} <span className="text-xs text-foreground/50">{tz}</span>
        </span>
        <LtrTime className="shrink-0 text-xs tabular-nums text-foreground/60">{gmtLabel(now, tz)}</LtrTime>
      </button>
    </li>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md">
        <DialogHeader>
          <DialogTitle>{t.pickerTitle}</DialogTitle>
          <DialogDescription className="sr-only">{t.searchPlaceholder}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" aria-hidden="true" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
            className="ps-8"
          />
        </div>
        {detectedTimeZone && detectedTimeZone !== value && !query && (
          <button type="button" onClick={() => onSelect(detectedTimeZone)} className="text-start text-xs font-medium text-primary hover:underline">
            {fmt(t.useDetected, { zone: zoneLabel(detectedTimeZone, now) })}
          </button>
        )}
        <div className="max-h-[50vh] overflow-y-auto" role="listbox" aria-label={t.pickerTitle}>
          {results.length === 0 && <p className="p-3 text-center text-sm text-foreground/50">{t.noResults}</p>}
          {common.length > 0 && (
            <>
              <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/40">{t.commonZones}</p>
              <ul>{common.map(option)}</ul>
            </>
          )}
          {rest.length > 0 && (
            <>
              <p className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-foreground/40">{t.allZones}</p>
              <ul>{rest.map(option)}</ul>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Slot düğmesinin içeriği: ana satır hastanın saati, alt satır küçük Türkiye saati. Hasta Türkiye
 * saatindeyse tek satır. Gün değişiyorsa "Türkiye: ertesi gün 01:30".
 */
export function DualSlotLabel({ iso, timeZone, intlLocale }: { iso: string; timeZone: string; intlLocale: string }) {
  const t = usePortalStrings().t.schedule;
  const d = dualSlotTime(iso, timeZone, intlLocale);
  if (d.single) return <LtrTime>{d.patientTime}</LtrTime>;
  const turkey =
    d.turkeyDayShift === 1
      ? fmt(t.turkeyNextDay, { time: d.turkeyTime })
      : d.turkeyDayShift === -1
        ? fmt(t.turkeyPreviousDay, { time: d.turkeyTime })
        : fmt(t.turkeySuffix, { time: d.turkeyTime });
  return (
    <span className="flex flex-col items-center leading-tight">
      <LtrTime className="tabular-nums">{d.patientTime}</LtrTime>
      <span className="text-[10px] font-normal tabular-nums opacity-70" data-testid="slot-turkey-time">
        {turkey}
      </span>
    </span>
  );
}

/** Ekran okuyucu metni: "16:00 (sizin saatiniz), 18:00 Türkiye". */
export function dualSlotAriaTime(iso: string, timeZone: string, intlLocale: string, t: { yourTime: string; turkeySuffix: string; turkeyNextDay: string; turkeyPreviousDay: string }): string {
  const d = dualSlotTime(iso, timeZone, intlLocale);
  if (d.single) return d.patientTime;
  const turkey =
    d.turkeyDayShift === 1
      ? fmt(t.turkeyNextDay, { time: d.turkeyTime })
      : d.turkeyDayShift === -1
        ? fmt(t.turkeyPreviousDay, { time: d.turkeyTime })
        : fmt(t.turkeySuffix, { time: d.turkeyTime });
  return `${d.patientTime} ${t.yourTime}, ${turkey}`;
}

/**
 * Seçim özeti / onay ekranı: hastanın tarih-saati, Türkiye tarih-saati ve aradaki fark
 * ("Türkiye sizden 2 saat ileride"). Hasta Türkiye saatindeyse tek satır.
 */
export function DualDateTimeSummary({ iso, timeZone, intlLocale = "tr-TR", className }: { iso: string; timeZone: string; intlLocale?: string; className?: string }) {
  const t = usePortalStrings().t.schedule;
  const labels = dualDateTimeLabels(iso, timeZone, intlLocale);
  if (isSameClockAsTurkey(iso, timeZone)) {
    return (
      <div className={cn("text-sm", className)} data-testid="dual-summary">
        <LtrTime className="font-medium text-foreground">{labels.turkey}</LtrTime>
        <span className="ms-1 text-xs text-foreground/60">({t.summaryTurkeyTime})</span>
      </div>
    );
  }
  const lead = turkeyLeadMinutes(iso, timeZone);
  const span = formatHourSpan(lead, intlLocale);
  return (
    <dl className={cn("space-y-0.5 text-sm", className)} data-testid="dual-summary">
      <div className="flex flex-wrap gap-x-1.5">
        <dt className="text-foreground/60">{t.summaryYourTime} ({cityLabel(timeZone)}):</dt>
        <dd>
          <LtrTime className="font-medium text-foreground">{labels.patient}</LtrTime>
        </dd>
      </div>
      <div className="flex flex-wrap gap-x-1.5">
        <dt className="text-foreground/60">{t.summaryTurkeyTime}:</dt>
        <dd>
          <LtrTime className="text-foreground">{labels.turkey}</LtrTime>
        </dd>
      </div>
      <p className="text-xs text-foreground/60">{lead === 0 ? t.sameAsTurkey : fmt(lead > 0 ? t.turkeyAhead : t.turkeyBehind, { span })}</p>
    </dl>
  );
}

/**
 * Portal listeleri için kısa satır: "28 Ekim · 16:00 (Berlin) · Türkiye 18:00". Hasta dilimi yoksa
 * ya da Türkiye ile aynıysa yalnızca Türkiye saati.
 */
export function DualTimeInline({
  iso,
  timeZone,
  intlLocale,
  className,
}: {
  iso: string;
  timeZone: string | null | undefined;
  intlLocale: string;
  className?: string;
}) {
  const t = usePortalStrings().t.schedule;
  const labels = dualDateTimeLabels(iso, timeZone ?? TURKEY_TIME_ZONE, intlLocale);
  if (!timeZone || isSameClockAsTurkey(iso, timeZone)) {
    return (
      <span className={className} data-testid="dual-inline">
        <LtrTime>{labels.turkey}</LtrTime> <span className="text-foreground/50">({t.summaryTurkeyTime})</span>
      </span>
    );
  }
  return (
    <span className={cn("inline-flex flex-wrap gap-x-1.5", className)} data-testid="dual-inline">
      <LtrTime>{labels.patient}</LtrTime>
      <span className="text-foreground/50">({cityLabel(timeZone)})</span>
      <span className="text-foreground/50">
        · {t.summaryTurkeyTime}: <LtrTime>{labels.turkey}</LtrTime>
      </span>
    </span>
  );
}

/**
 * Paket P — portal ekranları (randevu sihirbazı dışı) için hastanın görüntüleme dilimi: bu tarayıcıda
 * seçilen → giriş yapmış hastanın profili → tarayıcı. Mount öncesi (SSR) Türkiye saati.
 */
export function usePatientDisplayTimeZone(): string {
  const auth = useAuthOptional();
  const [clientTimeZone, setClientTimeZone] = useState<string | undefined>(undefined);
  useEffect(() => {
    let stored: string | undefined;
    try {
      const value = window.localStorage.getItem(PATIENT_TIME_ZONE_STORAGE_KEY);
      stored = isValidTimeZone(value) ? value : undefined;
    } catch {
      stored = undefined;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tarayıcı dilimi/localStorage yalnızca istemcide okunur
    setClientTimeZone(stored ?? browserTimeZone());
  }, []);
  const profile = isValidTimeZone(auth?.user?.timeZone) ? auth?.user?.timeZone ?? undefined : undefined;
  return clientTimeZone ?? profile ?? TURKEY_TIME_ZONE;
}
