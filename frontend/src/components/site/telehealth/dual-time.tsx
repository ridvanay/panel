"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { CalendarPlus, Moon, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fmt, usePortalStrings } from "@/lib/i18n/use-portal-strings";
import { useActiveLocaleCode } from "@/context/locale-alternates-context";
import type { GeoHint } from "@/lib/api/geo";
import {
  POPULAR_TIME_ZONES,
  TURKEY_TIME_ZONE,
  cityLabel,
  dualSlotTime,
  formatHourSpan,
  gmtLabel,
  isSameClockAsTurkey,
  listTimeZones,
  searchTimeZones,
  turkeyLeadMinutes,
} from "@/lib/dual-time";
import {
  countryFlagSrc,
  countryForTimeZone,
  countryName,
  defaultHour12,
  formatClock,
  formatClockRange,
  formatLongDate,
  isNightHour,
  patientLocaleTag,
  zoneAbbreviation,
} from "@/lib/country-display";
import { setHourFormatPreference, useHourFormatPreference } from "@/lib/hour-format-store";
import { buildIcs, googleCalendarUrl, type CalendarEventInput } from "@/lib/calendar-links";
import { formatDayLabel } from "@/lib/telehealth-format";
import { usePatientTimeZoneState, type PatientTimeZoneSource } from "@/components/site/telehealth/use-patient-time-zone";

/**
 * Paket P/R — hastanın saati + Türkiye saati. Saatler ve rakam blokları her dilde `dir="ltr"` ile
 * izole edilir (Arapçada "16:00" / "GMT+3" ters dönmesin). Paket R: bayrak + ülke adı (aktif dilde),
 * dilim kısaltması (CET/GST/EST), canlı saat, bölgeye göre 12/24 saat (Türkiye saati her zaman 24 saat).
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

/** Bayrak (flag-icons SVG, tembel yükleme) ya da bayrak yoksa ülke kodu rozeti. Dekoratif — metin yanında ülke adı var. */
export function ZoneFlag({ countryCode, className }: { countryCode: string | null; className?: string }) {
  const src = countryFlagSrc(countryCode);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- küçük statik SVG; next/image optimizasyonu gereksiz
    return <img src={src} alt="" aria-hidden="true" loading="lazy" width={20} height={15} className={cn("inline-block h-[15px] w-5 shrink-0 rounded-[2px] object-cover shadow-sm", className)} />;
  }
  return (
    <span aria-hidden="true" className={cn("inline-flex h-[15px] min-w-5 shrink-0 items-center justify-center rounded-[2px] bg-muted px-0.5 text-[9px] font-semibold text-foreground/60", className)}>
      {countryCode ?? "–"}
    </span>
  );
}

/** Şehir adı: İstanbul aktif dilde ("İstanbul"/"Estambul"), diğerleri IANA kimliğinden. */
function useCityName() {
  const t = usePortalStrings().t.schedule;
  return (timeZone: string) => (timeZone === TURKEY_TIME_ZONE ? t.istanbul : cityLabel(timeZone));
}

/** Hastanın saat biçimi: kullanıcı tercihi → bölge (site dili + dilimin ülkesi) → dil. */
export function usePatientHour12(patientTimeZone: string | null | undefined): boolean {
  const preference = useHourFormatPreference();
  const language = useActiveLocaleCode();
  if (preference) return preference === "12";
  return defaultHour12(patientLocaleTag(language, patientTimeZone));
}

/** Dakika başında güncellenen "şu an"; mount öncesi `null` (canlı saat yalnızca istemcide çizilir). */
export function useMinuteClock(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- canlı saat yalnızca istemcide (hidrasyon uyuşmazlığı olmasın)
    setNow(Date.now());
    const first = setTimeout(() => {
      setNow(Date.now());
      interval = setInterval(() => setNow(Date.now()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    };
  }, []);
  return now;
}

interface TimeZoneBarProps {
  timeZone: string | undefined;
  source?: PatientTimeZoneSource;
  detectedTimeZone: string | undefined;
  ipHint?: GeoHint | null;
  suggestion?: { timeZone: string; countryCode: string } | null;
  onChange: (timeZone: string) => void;
  onKeep?: () => void;
  className?: string;
  /** Doktor profilindeki randevu kutusu: landmark değil, IP notu/öneri yok (sihirbazdaki bantla çakışmasın). */
  compact?: boolean;
}

/**
 * Üst bilgi bandı: "[bayrak] Almanya · Berlin (GMT+1, CET) — Şu an 14:05 | [bayrak] Türkiye · İstanbul
 * (GMT+3) — Şu an 16:05 · Değiştir" + "İstanbul sizden 2 saat ileride." Aynı saatteyse tek saat.
 * IP önerisi yalnızca bildirimdir ("Evet" / "Hayır, şimdiki kalsın"); otomatik değiştirme yok.
 */
export function TimeZoneBar({ timeZone, source, detectedTimeZone, ipHint, suggestion, onChange, onKeep, className, compact = false }: TimeZoneBarProps) {
  const { t, intlLocale } = usePortalStrings();
  const s = t.schedule;
  const [open, setOpen] = useState(false);
  const now = useMinuteClock();
  const hour12 = usePatientHour12(timeZone);
  const cityName = useCityName();
  const nowIso = now !== null ? new Date(now).toISOString() : null;

  const zoneLine = (tz: string, isTurkey: boolean) => {
    const country = countryForTimeZone(tz);
    const abbr = nowIso && !isTurkey ? zoneAbbreviation(nowIso, tz) : null;
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <ZoneFlag countryCode={country} />
        <strong className="font-medium text-foreground">
          {country ? `${countryName(country, intlLocale)} · ` : ""}
          {cityName(tz)}
        </strong>
        {nowIso && (
          <LtrTime className="text-foreground/60">
            ({gmtLabel(nowIso, tz)}
            {abbr ? `, ${abbr}` : ""})
          </LtrTime>
        )}
        {nowIso && (
          <span className="tabular-nums text-foreground/80" data-testid={isTurkey ? "bar-turkey-clock" : "bar-patient-clock"}>
            {s.nowAt.split("{time}")[0]}
            <LtrTime className="font-medium">{formatClock(nowIso, tz, intlLocale, isTurkey ? false : hour12)}</LtrTime>
            {s.nowAt.split("{time}")[1] ?? ""}
          </span>
        )}
      </span>
    );
  };

  const sameClock = timeZone && nowIso ? isSameClockAsTurkey(nowIso, timeZone) : false;
  const lead = timeZone && nowIso && !sameClock ? turkeyLeadMinutes(nowIso, timeZone) : 0;
  const suggestedCountry = suggestion ? countryName(suggestion.countryCode, intlLocale) : "";

  const Wrapper = compact ? "div" : "section";
  return (
    <Wrapper
      aria-label={compact ? undefined : s.zoneBarLabel}
      data-testid={compact ? "time-zone-bar-compact" : "time-zone-bar"}
      className={cn("space-y-1.5 rounded-[var(--site-radius)] border border-border bg-muted/50 px-3 py-2 text-xs text-foreground/70", className)}
    >
      {timeZone && nowIso ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {zoneLine(timeZone, timeZone === TURKEY_TIME_ZONE)}
            {!sameClock && (
              <>
                <span aria-hidden="true" className="hidden h-4 w-px bg-border sm:inline-block" />
                {zoneLine(TURKEY_TIME_ZONE, true)}
              </>
            )}
            <button
              type="button"
              onClick={() => setOpen(true)}
              // Görünen "Değiştir" metni erişilebilir adın içinde kalır (WCAG 2.5.3).
              aria-label={`${s.change} — ${s.pickerTitle}`}
              className="ms-auto font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              {s.change}
            </button>
          </div>
          <p data-testid="bar-lead">
            {sameClock
              ? countryForTimeZone(timeZone) === "TR"
                ? s.inTurkeyTime
                : s.sameClockAsTurkey
              : fmt(lead > 0 ? s.leadAhead : s.leadBehind, { span: formatHourSpan(lead, intlLocale) })}
          </p>
          {source === "ip" && !compact && <p data-testid="bar-ip-note">{s.ipDefaultNote}</p>}
        </>
      ) : (
        <span>…</span>
      )}
      {/* İnceleme bulgusu — canlı bölge kalıcıdır (içerik sonradan eklendiğinde okunur). */}
      {!compact && (
        <div role="status">
          {timeZone && nowIso && suggestion && (
            <div data-testid="tz-suggestion" className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-foreground/80">
              <ZoneFlag countryCode={suggestion.countryCode} />
              <span>{fmt(s.mismatchPrompt, { country: suggestedCountry, city: cityName(suggestion.timeZone) })}</span>
              <span className="ms-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => onChange(suggestion.timeZone)}
                  className="rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  {s.mismatchYes}
                </button>
                <button
                  type="button"
                  onClick={onKeep}
                  className="rounded-md border border-border bg-surface px-2.5 py-1 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  {s.mismatchNo}
                </button>
              </span>
            </div>
          )}
        </div>
      )}
      <TimeZonePickerDialog
        open={open}
        onOpenChange={setOpen}
        value={timeZone}
        detectedTimeZone={detectedTimeZone}
        ipTimeZone={ipHint?.timeZone ?? null}
        onSelect={(tz) => {
          onChange(tz);
          setOpen(false);
        }}
      />
    </Wrapper>
  );
}

export function TimeZonePickerDialog({
  open,
  onOpenChange,
  value,
  detectedTimeZone,
  ipTimeZone = null,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string | undefined;
  detectedTimeZone: string | undefined;
  ipTimeZone?: string | null;
  onSelect: (timeZone: string) => void;
}) {
  const { t, intlLocale } = usePortalStrings();
  const s = t.schedule;
  const cityName = useCityName();
  const preference = useHourFormatPreference();
  const effectiveHour12 = usePatientHour12(value);
  const [query, setQuery] = useState("");
  const zones = useMemo(() => (open ? listTimeZones() : []), [open]);
  const now = useMemo(() => new Date(), [open]); // eslint-disable-line react-hooks/exhaustive-deps -- seçici her açılışta "şu an"ı yeniden okur
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(() => searchTimeZones(deferredQuery, zones, intlLocale, now), [deferredQuery, zones, intlLocale, now]);
  const nowIso = now.toISOString();
  // İnceleme bulgusu (performans) — ~418 dilimin GMT etiketi ve ülke adı açılışta bir kez hesaplanır.
  const zoneMeta = useMemo(() => {
    const map = new Map<string, { gmt: string; code: string | null; country: string | null }>();
    for (const tz of zones) {
      const code = countryForTimeZone(tz);
      map.set(tz, { gmt: gmtLabel(now, tz), code, country: code ? countryName(code, intlLocale) : null });
    }
    return map;
  }, [zones, now, intlLocale]);

  const suggested = [
    detectedTimeZone ? { tz: detectedTimeZone, label: s.suggestedDevice } : null,
    ipTimeZone && ipTimeZone !== detectedTimeZone ? { tz: ipTimeZone, label: s.suggestedLocation } : null,
  ].filter((x): x is { tz: string; label: string } => x !== null && results.includes(x.tz));
  const suggestedSet = new Set(suggested.map((x) => x.tz));
  const popular = results.filter((tz) => POPULAR_TIME_ZONES.includes(tz) && !suggestedSet.has(tz));
  const restGroups = useMemo(() => {
    const groups = new Map<string, { code: string | null; name: string; zones: string[] }>();
    for (const tz of results) {
      if (POPULAR_TIME_ZONES.includes(tz)) continue;
      const code = countryForTimeZone(tz);
      const key = code ?? "~";
      const group = groups.get(key) ?? { code, name: code ? countryName(code, intlLocale) : s.otherZones, zones: [] };
      group.zones.push(tz);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => (a.code === null ? 1 : b.code === null ? -1 : a.name.localeCompare(b.name, intlLocale)));
  }, [results, intlLocale, s.otherZones]);

  const option = (tz: string, note?: string) => {
    const meta = zoneMeta.get(tz);
    const code = meta?.code ?? countryForTimeZone(tz);
    return (
      <li key={`${note ?? ""}${tz}`}>
        <button
          type="button"
          aria-pressed={tz === value}
          onClick={() => onSelect(tz)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-start text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
            tz === value && "bg-primary/10 font-medium text-primary"
          )}
        >
          <ZoneFlag countryCode={code} />
          <span className="min-w-0 flex-1 truncate">
            {cityName(tz)}
            <span className="ms-1.5 text-xs text-foreground/50">
              {meta?.country ?? (code ? countryName(code, intlLocale) : tz)}
              {note ? ` · ${note}` : ""}
            </span>
          </span>
          <LtrTime className="shrink-0 text-xs tabular-nums text-foreground/60">{meta?.gmt ?? gmtLabel(nowIso, tz)}</LtrTime>
        </button>
      </li>
    );
  };

  const heading = (text: string) => <p className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-foreground/40">{text}</p>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md">
        <DialogHeader>
          <DialogTitle>{s.pickerTitle}</DialogTitle>
          <DialogDescription className="sr-only">{s.searchPlaceholder}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" aria-hidden="true" />
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={s.searchPlaceholder} aria-label={s.searchPlaceholder} className="ps-8" />
        </div>
        <div role="group" aria-label={s.hourFormat} className="flex items-center gap-2 text-xs">
          <span className="text-foreground/60">{s.hourFormat}:</span>
          {(["12", "24"] as const).map((format) => {
            const active = preference ? preference === format : (format === "12") === effectiveHour12;
            return (
              <button
                key={format}
                type="button"
                aria-pressed={active}
                onClick={() => setHourFormatPreference(format)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                  active ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70 hover:bg-muted"
                )}
              >
                {format === "12" ? s.hour12 : s.hour24}
              </button>
            );
          })}
        </div>
        <div className="max-h-[50vh] overflow-y-auto" role="region" aria-label={s.pickerTitle}>
          <p role="status" className={results.length === 0 ? "p-3 text-center text-sm text-foreground/50" : "sr-only"}>
            {results.length === 0 ? s.noResults : ""}
          </p>
          {suggested.length > 0 && (
            <>
              {heading(s.suggestedZones)}
              <ul>{suggested.map((x) => option(x.tz, x.label))}</ul>
            </>
          )}
          {popular.length > 0 && (
            <>
              {heading(s.popularZones)}
              <ul>{popular.map((tz) => option(tz))}</ul>
            </>
          )}
          {restGroups.length > 0 && heading(s.allZones)}
          {restGroups.map((group) => (
            <div key={group.code ?? "~"} role="group" aria-label={group.name}>
              <p className="px-2.5 pb-0.5 pt-2 text-xs font-medium text-foreground/60">{group.name}</p>
              <ul>{group.zones.map((tz) => option(tz))}</ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Slot kartı
// ---------------------------------------------------------------------------------------------

export interface SlotView {
  /** `16:00 – 16:30` (hastanın saati, 12/24 tercihine göre). */
  patientRange: string;
  /** `18:00 – 18:30` (İstanbul, her zaman 24 saat). */
  turkeyRange: string;
  single: boolean;
  /** İstanbul'un takvim günü hastanınkinden farklıysa ±1. */
  turkeyDayShift: -1 | 0 | 1;
  night: boolean;
  /** Ekran okuyucu cümlesi: "Salı 28 Ekim, sizin saatinizle 16:00–16:30, İstanbul saatiyle 18:00–18:30". */
  sentence: string;
}

type ScheduleStrings = ReturnType<typeof usePortalStrings>["t"]["schedule"];

export function buildSlotView(
  slot: { startsAt: string; endsAt: string },
  timeZone: string,
  intlLocale: string,
  hour12: boolean,
  s: Pick<ScheduleStrings, "slotSentence" | "slotSentenceSame" | "nextDaySuffix" | "prevDaySuffix" | "nightHint">
): SlotView {
  const d = dualSlotTime(slot.startsAt, timeZone, intlLocale);
  const patientRange = formatClockRange(slot.startsAt, slot.endsAt, timeZone, intlLocale, hour12);
  const turkeyRange = formatClockRange(slot.startsAt, slot.endsAt, TURKEY_TIME_ZONE, intlLocale, false);
  const night = isNightHour(slot.startsAt, timeZone);
  const date = formatDayLabel(slot.startsAt, timeZone, intlLocale);
  const shiftSuffix = d.turkeyDayShift === 1 ? s.nextDaySuffix : d.turkeyDayShift === -1 ? s.prevDaySuffix : "";
  const base = d.single
    ? fmt(s.slotSentenceSame, { date, time: patientRange.replace(" – ", "–") })
    : fmt(s.slotSentence, { date, time: patientRange.replace(" – ", "–"), turkeyTime: `${turkeyRange.replace(" – ", "–")}${shiftSuffix}` });
  return { patientRange, turkeyRange, single: d.single, turkeyDayShift: d.turkeyDayShift, night, sentence: night ? `${base}. ${s.nightHint}` : base };
}

/** Slot düğmesinin içeriği: büyük hasta aralığı; altta bayrak + "İstanbul 18:00 – 18:30" (+1 gün rozeti); gece ay ikonu. */
export function SlotCardContent({ view, status }: { view: SlotView; status?: string }) {
  const s = usePortalStrings().t.schedule;
  return (
    <span className="flex w-full flex-col items-center gap-0.5 leading-tight" aria-hidden="true">
      <span className="inline-flex items-center gap-1">
        {view.night && <Moon className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" data-testid="slot-night" />}
        <LtrTime className="text-sm font-semibold tabular-nums">{view.patientRange}</LtrTime>
      </span>
      {!view.single && (
        <span className="inline-flex flex-wrap items-center justify-center gap-1 text-[10px] font-normal opacity-75" data-testid="slot-turkey-time">
          <ZoneFlag countryCode="TR" className="h-[9px] w-3" />
          <span>{s.istanbul}</span>
          <LtrTime className="tabular-nums">{view.turkeyRange}</LtrTime>
          {view.turkeyDayShift !== 0 && (
            <span className="rounded-sm bg-foreground/10 px-1 font-semibold" data-testid="slot-day-shift">
              <bdi>{view.turkeyDayShift === 1 ? s.dayShiftNext : s.dayShiftPrev}</bdi>
            </span>
          )}
        </span>
      )}
      {status && <span className="text-[10px] font-medium">{status}</span>}
    </span>
  );
}

/**
 * Portal listeleri için kısa etiket: ana satır hastanın saati, alt satır küçük Türkiye saati. Hasta
 * Türkiye saatindeyse tek satır. Gün değişiyorsa "Türkiye: ertesi gün 01:30".
 */
export function DualSlotLabel({ iso, timeZone, intlLocale }: { iso: string; timeZone: string; intlLocale: string }) {
  const t = usePortalStrings().t.schedule;
  const hour12 = usePatientHour12(timeZone);
  const d = dualSlotTime(iso, timeZone, intlLocale);
  const patientTime = formatClock(iso, timeZone, intlLocale, hour12);
  const turkeyTime = formatClock(iso, TURKEY_TIME_ZONE, intlLocale, false);
  if (d.single) return <LtrTime>{patientTime}</LtrTime>;
  const turkey =
    d.turkeyDayShift === 1
      ? fmt(t.turkeyNextDay, { time: turkeyTime })
      : d.turkeyDayShift === -1
        ? fmt(t.turkeyPreviousDay, { time: turkeyTime })
        : fmt(t.turkeySuffix, { time: turkeyTime });
  return (
    <span className="flex flex-col items-center leading-tight">
      <LtrTime className="tabular-nums">{patientTime}</LtrTime>
      <span className="text-[10px] font-normal tabular-nums opacity-70" data-testid="slot-turkey-time">
        {turkey}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Özet / onay
// ---------------------------------------------------------------------------------------------

/**
 * Seçim özeti / onay ekranı (Paket R biçimi):
 *   **28 Ekim 2026 Salı, 16:00–16:30** (Berlin, CET)
 *   İstanbul: 28 Ekim 2026 Salı, 18:00–18:30 (GMT+3)
 *   İstanbul sizden 2 saat ileride.
 * Hasta Türkiye saatindeyse tek satır.
 */
export function DualDateTimeSummary({
  iso,
  endIso,
  timeZone,
  intlLocale = "tr-TR",
  className,
}: {
  iso: string;
  endIso?: string;
  timeZone: string;
  intlLocale?: string;
  className?: string;
}) {
  const s = usePortalStrings().t.schedule;
  const hour12 = usePatientHour12(timeZone);
  const cityName = useCityName();
  // İnceleme bulgusu (Arapça bidi) — yalnızca saat aralığı `dir="ltr"`; tarih (gün/ay adları) kendi yönünde `<bdi>`.
  const range = (tz: string, h12: boolean) => (
    <>
      <bdi>{formatLongDate(iso, tz, intlLocale)}</bdi>, <LtrTime>{formatClockRange(iso, endIso, tz, intlLocale, h12).replace(" – ", "–")}</LtrTime>
    </>
  );
  if (isSameClockAsTurkey(iso, timeZone)) {
    return (
      <div className={cn("text-sm", className)} data-testid="dual-summary">
        <span className="font-semibold text-foreground">{range(timeZone, hour12)}</span>
        <span className="ms-1 text-xs text-foreground/60">({s.summaryTurkeyTime})</span>
      </div>
    );
  }
  const lead = turkeyLeadMinutes(iso, timeZone);
  const zone = zoneAbbreviation(iso, timeZone) ?? gmtLabel(iso, timeZone);
  return (
    <div className={cn("space-y-0.5 text-sm", className)} data-testid="dual-summary">
      <p>
        <span className="font-semibold text-foreground">{range(timeZone, hour12)}</span>{" "}
        <span className="text-foreground/60">
          ({cityName(timeZone)}, <LtrTime>{zone}</LtrTime>)
        </span>
      </p>
      <p className="text-foreground/80">
        {cityName(TURKEY_TIME_ZONE)}: {range(TURKEY_TIME_ZONE, false)}{" "}
        <span className="text-foreground/60">
          (<LtrTime>{gmtLabel(iso, TURKEY_TIME_ZONE)}</LtrTime>)
        </span>
      </p>
      <p className="text-xs text-foreground/60">{lead === 0 ? s.sameAsTurkey : fmt(lead > 0 ? s.leadAhead : s.leadBehind, { span: formatHourSpan(lead, intlLocale) })}</p>
    </div>
  );
}

/**
 * Portal listeleri için kısa satır: "28 Ekim · 16:00 (Berlin) · Türkiye 18:00". Hasta dilimi yoksa
 * ya da Türkiye ile aynıysa yalnızca Türkiye saati.
 */
export function DualTimeInline({
  iso,
  timeZone,
  intlLocale = "tr-TR",
  className,
}: {
  iso: string;
  timeZone: string | null | undefined;
  intlLocale?: string;
  className?: string;
}) {
  const t = usePortalStrings().t.schedule;
  const hour12 = usePatientHour12(timeZone);
  const at = (tz: string, h12: boolean) => (
    <>
      <bdi>{formatDayLabel(iso, tz, intlLocale)}</bdi> · <LtrTime>{formatClock(iso, tz, intlLocale, h12)}</LtrTime>
    </>
  );
  if (!timeZone || isSameClockAsTurkey(iso, timeZone)) {
    return (
      <span className={className} data-testid="dual-inline">
        {at(TURKEY_TIME_ZONE, false)} <span className="text-foreground/50">({t.summaryTurkeyTime})</span>
      </span>
    );
  }
  return (
    <span className={cn("inline-flex flex-wrap gap-x-1.5", className)} data-testid="dual-inline">
      <span>{at(timeZone, hour12)}</span>
      <span className="text-foreground/50">({cityLabel(timeZone)})</span>
      <span className="text-foreground/50">
        · {t.summaryTurkeyTime}: {at(TURKEY_TIME_ZONE, false)}
      </span>
    </span>
  );
}

/**
 * Paket R — "Takvime ekle": `.ics` indirme + Google Takvim bağlantısı, YALNIZCA tarayıcıda üretilir.
 * İçerikte randevu erişim bağlantısı dışında kişisel veri yok.
 */
export function AddToCalendar({ events, className }: { events: CalendarEventInput[]; className?: string }) {
  const s = usePortalStrings().t.schedule;
  if (events.length === 0) return null;
  function downloadIcs() {
    const blob = new Blob([buildIcs(events)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "randevu.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-sm", className)} data-testid="add-to-calendar">
      <span className="inline-flex items-center gap-1 font-medium text-foreground">
        <CalendarPlus className="h-4 w-4" aria-hidden="true" />
        {s.addToCalendar}:
      </span>
      <button type="button" onClick={downloadIcs} className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
        {s.downloadIcs}
      </button>
      {events.map((event, i) => (
        <a
          key={event.startsAt}
          href={googleCalendarUrl(event)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          {s.googleCalendar}
          {events.length > 1 ? ` (${i + 1})` : ""}
        </a>
      ))}
    </div>
  );
}

/**
 * Paket P/R — portal ekranları (randevu sihirbazı dışı) için hastanın görüntüleme dilimi: aynı öncelik
 * (profil → saklı seçim → tarayıcı → IP); burada IP yalnızca tarayıcı dilimi belirsizse sorulur, öneri
 * bildirimi gösterilmez. Mount öncesi (SSR) Türkiye saati.
 */
export function usePatientDisplayTimeZone(): string {
  return usePatientTimeZoneState({ suggest: false }).timeZone ?? TURKEY_TIME_ZONE;
}
