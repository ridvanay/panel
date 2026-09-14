"use client";

import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, CloudSun, Globe, ShieldAlert, Sun } from "lucide-react";
import { useAuthOptional } from "@/context/auth-context";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AvailabilitySlot } from "@/lib/api/types";
import { MAX_BOOKING_SLOTS } from "@/lib/api/types";
import { formatDayKey, formatTime } from "@/lib/telehealth-format";
import { useBookingSelection } from "@/components/site/telehealth/booking-selection-context";
import { SlotAvailabilityLegend } from "@/components/site/telehealth/slot-availability-legend";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * `.claude/architect-scope-telehealth-template.md` §4.2/§9.7.2 + `.claude/design-notes-telehealth.md`
 * §2.3/§4/§12 — ay takvimi ızgarası + iki saat grubuna (ÖÖ Sabah/ÖS Öğleden Sonra) ayrılmış ÇOKLU
 * slot seçim ızgarası (1..4, AYNI gün). `selectedSlots` `booking-selection-context.tsx` üzerinden
 * PAYLAŞILIR; bu dosya context'in TÜKETİCİSİ ve TEK yazarıdır, context'in SAHİBİ DEĞİLDİR.
 *
 * Grid görevi (2026-09-14) Görev 1 — bu bileşen `booking-wizard.tsx`'in 2. adımı ("Tarih & Saat")
 * İÇİN SADELEŞTİRİLDİ: ad-soyad/e-posta formu, `IdentityStepDialog`, booking oluşturma/
 * `BookingPostCreationFlow` mantığı `booking-wizard.tsx`'e TAŞINDI (o dosyanın başlığına bakın).
 * Bu bileşen ARTIK yalnızca takvim + slot ızgarasıdır — SAF bir "adım 2 içeriği" bileşeni.
 *
 * ui-designer `slot-availability-legend.tsx` `data-notes` talimatı — takvim ızgarasındaki hafta
 * sonu (Cmt/Paz) GÜN hücreleri (yalnızca "müsait" durumdaki, seçili OLMAYAN hücreler) legend'daki
 * `--site-secondary` tonuyla (`border-[var(--site-secondary)]/30 bg-[var(--site-secondary)]/10`)
 * İŞARETLENDİ — legend'ın "Hafta Sonu" swatch'ıyla BİREBİR aynı sınıflar (bkz. `isWeekend` dalı).
 */

interface AvailabilityCalendarProps {
  doctorSlug: string;
  doctorTimeZone: string;
  initialSlots: AvailabilitySlot[];
  /** `booking-wizard.tsx`'ten gelen 409 (slot çakışması) bildirimi — bu bileşenin KENDİ ay-getirme hatasından AYRI. */
  conflictNotice?: string | null;
}

/**
 * `.claude/design-notes-telehealth.md` §2.3.3 — saat gruplaması ÜÇTEN (Sabah/Öğleden Sonra/
 * Akşam) İKİYE (ÖÖ Sabah/ÖS Öğleden Sonra) indirildi, sınır öğlen 12:00. `formatTime`'ın
 * ürettiği `HH:mm` dizesinden saat kısmı `parseInt` ile okunur (ikinci bir saat biçimlendirici
 * İCAT EDİLMEZ, mevcut `formatTime` ile AYNI kaynaktan türer).
 */
const HOUR_GROUP_LABELS = ["Sabah", "Öğleden Sonra"] as const;
type HourGroupLabel = (typeof HOUR_GROUP_LABELS)[number];

function getHourGroupLabel(iso: string, timeZone: string): HourGroupLabel {
  const hour = parseInt(formatTime(iso, timeZone).slice(0, 2), 10);
  return hour < 12 ? "Sabah" : "Öğleden Sonra";
}

/** §2.2.1/§12.2.1 — seçim pili taban dili, çoklu seçimde de DEĞİŞMEDEN kullanılır. */
const SELECTION_PILL_BASE =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-[var(--site-radius)] border text-sm font-medium tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
const SELECTION_PILL_AVAILABLE =
  "border-border bg-white text-foreground hover:border-primary hover:bg-primary/10 hover:text-primary";
const SELECTION_PILL_SELECTED =
  "border-2 border-transparent bg-primary text-primary-foreground ring-2 ring-offset-2 ring-offset-surface ring-primary";
/** §12.2.2 — 4/4 sınırına ulaşıldığında henüz seçilmemiş müsait slotların "geçici olarak seçilemez" durumu. */
const SELECTION_PILL_AT_LIMIT = "border-border/60 bg-surface text-foreground/35 cursor-not-allowed";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Takvim hücresi anahtarı — `formatDayKey`'in (`en-CA`) ürettiği `YYYY-MM-DD` ile BİREBİR aynı biçim. */
function buildDayKey(year: number, month0: number, day: number): string {
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`;
}

/** Ayın gün sayısı — UTC ile hesaplanır (tarayıcı/sunucu yerel dilimine BAĞIMSIZ, hidrasyon güvenli). */
function daysInMonthUTC(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** §2.3.2 — Pazartesi BAŞLANGIÇ (ISO 8601); `getUTCDay()`'in Pazar=0 döndüren JS varsayılanı Pazartesi=0'a çevrilir. */
function firstWeekdayMondayIndex(year: number, month0: number): number {
  return (new Date(Date.UTC(year, month0, 1)).getUTCDay() + 6) % 7;
}

/** §2.3.1 — `"EYLÜL 2026"`; Türkçe `İ/i` noktalama kuralı için `toUpperCase()` DEĞİL `toLocaleUpperCase("tr-TR")`. */
function formatMonthLabel(year: number, month0: number): string {
  return new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month0, 1)))
    .toLocaleUpperCase("tr-TR");
}

/** §2.3.2 — hücre `aria-label`'ının tarih kısmı: `"16 Eylül Çarşamba"`. */
function formatCellDatePart(year: number, month0: number, day: number): string {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", weekday: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month0, day))
  );
}

/** Belirli bir `timeZone`'daki takvim yılı/ayını (0-indeksli ay) döndürür — ay navigasyonunun geçmiş-ay kısıtı için. */
function getYearMonthInTimeZone(date: Date, timeZone: string): { year: number; month0: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month0 = Number(parts.find((p) => p.type === "month")!.value) - 1;
  return { year, month0 };
}

/** Belirli bir yıl/ay/gün (UTC) hafta sonu (Cmt=6/Paz=0) mu — takvim hücresi hafta sonu işareti İÇİN. */
function isWeekendDay(year: number, month0: number, day: number): boolean {
  const weekday = new Date(Date.UTC(year, month0, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** Verilen slot listesindeki (`available: true`) kronolojik olarak İLK gün anahtarı, yoksa `null`. */
function earliestAvailableDayKey(slots: AvailabilitySlot[], timeZone: string): string | null {
  const keys = slots.filter((s) => s.available).map((s) => formatDayKey(s.startsAt, timeZone));
  if (keys.length === 0) return null;
  return keys.sort()[0]!;
}

function mergeSlots(prev: AvailabilitySlot[], fetched: AvailabilitySlot[]): AvailabilitySlot[] {
  const seen = new Set(prev.map((s) => s.startsAt));
  const merged = [...prev];
  for (const slot of fetched) {
    if (!seen.has(slot.startsAt)) {
      merged.push(slot);
      seen.add(slot.startsAt);
    }
  }
  return merged;
}

export function AvailabilityCalendar({ doctorSlug, doctorTimeZone, initialSlots, conflictNotice }: AvailabilityCalendarProps) {
  // `.claude/architect-scope-telehealth-template.md` K6 — `SiteRole.DOCTOR` YOKTUR; doktorluk
  // `User.doctorProfileId` ilişkisinden TÜRETİLİR (bkz. `site-header.tsx`'teki AYNI desen).
  const auth = useAuthOptional();
  const isDoctorSession = auth?.status === "authenticated" && auth.user?.doctorProfileId != null;
  const { selectedSlots, toggleSlot, displayTimeZone, visitorTimeZone } = useBookingSelection();
  const [slots, setSlots] = useState<AvailabilitySlot[]>(initialSlots);
  const [monthFetchError, setMonthFetchError] = useState<string | null>(null);
  const [dayChangedNotice, setDayChangedNotice] = useState(false);
  // Grid görevi (2026-09-14) Görev 1 — "Dolu saatleri gizle" toggle'ı; yalnızca `!slot.available &&
  // !isPast` (gerçekten "Dolu" etiketli) slotları ızgaradan gizler, "geçmiş" slotlar ETKİLENMEZ.
  const [hideFullSlots, setHideFullSlots] = useState(false);

  // §2.3.1 — takvimin başlangıç sayfası. `initialSlots`/`doctorTimeZone` SUNUCU/istemci İLK
  // render'ında AYNIDIR (hidrasyon güvenli, `visitorTimeZone` henüz BİLİNMİYOR) — mount sonrası
  // `displayTimeZone` değişse de bu başlangıç değeri GERİYE dönük değiştirilmez.
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(() => earliestAvailableDayKey(initialSlots, doctorTimeZone));
  const [viewMonth, setViewMonth] = useState<{ year: number; month0: number }>(() => {
    const firstKey = earliestAvailableDayKey(initialSlots, doctorTimeZone);
    if (firstKey) {
      const [y, m] = firstKey.split("-").map(Number);
      return { year: y!, month0: m! - 1 };
    }
    return getYearMonthInTimeZone(new Date(), doctorTimeZone);
  });

  // eslint-disable-next-line react-hooks/purity -- slot durumunu (müsait/dolu/geçmiş) "şu an" ile karşılaştırmak GEREKİR; sayaç gibi saniyede bir tick ATMASI gerekmez, yalnızca render anındaki an yeterlidir
  const now = Date.now();

  // §2.3.2 — seçili ayın TÜM günlerinin (müsait/dolu/geçmiş fark etmeksizin) slot listesi; saat
  // gruplarının (§2.3.3) da kaynağı budur.
  const dayItemsByKey = useMemo(() => {
    const map = new Map<string, AvailabilitySlot[]>();
    for (const slot of slots) {
      const key = formatDayKey(slot.startsAt, displayTimeZone);
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return map;
  }, [slots, displayTimeZone]);

  const availableDayKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const [key, items] of dayItemsByKey) {
      if (items.some((item) => item.available)) set.add(key);
    }
    return set;
  }, [dayItemsByKey]);

  const earliestKey = useMemo(() => {
    const keys = Array.from(availableDayKeySet).sort();
    return keys[0] ?? null;
  }, [availableDayKeySet]);

  const activeDayItems = useMemo(
    () => (selectedDayKey ? dayItemsByKey.get(selectedDayKey) ?? [] : []),
    [selectedDayKey, dayItemsByKey]
  );

  // §2.3.3 — seçili günün saatleri ÖÖ Sabah/ÖS Öğleden Sonra gruplarına ayrılır, boş grup RENDER
  // EDİLMEZ; kronolojik sıra (dolu/geçmiş dahil) her grubun İÇİNDE korunur.
  const hourGroups = useMemo(() => {
    if (activeDayItems.length === 0) return [];
    const groups = new Map<HourGroupLabel, AvailabilitySlot[]>();
    for (const slot of activeDayItems) {
      const label = getHourGroupLabel(slot.startsAt, displayTimeZone);
      const list = groups.get(label) ?? [];
      list.push(slot);
      groups.set(label, list);
    }
    return HOUR_GROUP_LABELS.filter((label) => groups.has(label)).map((label) => ({ label, items: groups.get(label)! }));
  }, [activeDayItems, displayTimeZone]);

  const displayedHourGroups = useMemo(() => {
    if (!hideFullSlots) return hourGroups;
    return hourGroups
      .map((group) => ({
        label: group.label,
        items: group.items.filter((slot) => slot.available || new Date(slot.startsAt).getTime() < now),
      }))
      .filter((group) => group.items.length > 0);
  }, [hourGroups, hideFullSlots, now]);

  /** §2.3.1 — ay değiştiğinde o ayın slotlarını (henüz yüklenmemişse) getirir, mevcutlarla BİRLEŞTİRİR. */
  async function fetchMonthSlots(year: number, month0: number) {
    const from = `${year}-${pad2(month0 + 1)}-01`;
    const to = `${year}-${pad2(month0 + 1)}-${pad2(daysInMonthUTC(year, month0))}`;
    try {
      const fetched = await telehealthApi.getDoctorSlots(doctorSlug, from, to);
      setSlots((prev) => mergeSlots(prev, fetched));
    } catch (err) {
      setMonthFetchError(friendlyErrorMessage(err));
    }
  }

  function changeMonth(delta: number) {
    let { year, month0 } = viewMonth;
    month0 += delta;
    if (month0 < 0) {
      month0 = 11;
      year -= 1;
    } else if (month0 > 11) {
      month0 = 0;
      year += 1;
    }
    setViewMonth({ year, month0 });
    void fetchMonthSlots(year, month0);
  }

  const { year: currentYear, month0: currentMonth0 } = getYearMonthInTimeZone(new Date(now), displayTimeZone);
  const isPrevMonthDisabled = viewMonth.year * 12 + viewMonth.month0 <= currentYear * 12 + currentMonth0;

  function handleSlotClick(slot: AvailabilitySlot) {
    if (!slot.available || isDoctorSession) return;
    const { dayChanged } = toggleSlot(slot, displayTimeZone);
    setDayChangedNotice(dayChanged);
  }

  return (
    <>
      {/* Grid görevi (2026-09-14) Görev — bu bileşen ARTIK `booking-wizard.tsx`'in SAHİP OLDUĞU
          TEK `lg:grid-cols-12` dış gridinin ÜYESİDİR (kendi iç grid'i YOKTUR): meta blok (banner/
          conflict/saat dilimi rozeti/boş-slot mesajı, `lg:col-span-12`, TAM genişlik, KENDİ
          satırında) → takvim kartı (`lg:col-span-4`) → slot kartı (`lg:col-span-5`) — dış gridin
          sağ `lg:col-span-3` "Hizmet Özeti" sütunuyla AYNI satırda 4+5+3=12 tamamlanır. Fragment
          döndürülür (kök `<div>` YOK) ki bu üç/dört parça `booking-wizard.tsx`'teki grid'in
          DOĞRUDAN çocukları olsun. */}
      <div className="lg:col-span-12 space-y-3">
        {/* frontend-agent — hekim oturumu kendi adına hasta randevusu ALAMAZ (bkz. backend
            `POST /appointments`/`POST /appointments/bookings` 403 `FORBIDDEN` guard'ı). Slot seçimi
            aşağıda AYRICA devre dışı bırakılır; bu banner yalnızca kullanıcıya NEDENİ açıklar. */}
        {isDoctorSession && (
          <Alert variant="warning" className="flex items-start gap-2" data-testid="doctor-session-booking-blocked-notice">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Hekim oturumu ile randevu alınamaz.</span>
          </Alert>
        )}

        {conflictNotice && (
          <Alert variant="error">
            <span>{conflictNotice}</span>
          </Alert>
        )}

        {/* §4/§2.3.5 — 2 aşamalı saat dilimi rozeti (hidrasyon uyuşmazlığı önlenir), stil KORUNUR. */}
        <div className="flex items-start gap-2 rounded-[var(--site-radius)] border border-border bg-muted/50 px-3 py-2 text-xs text-foreground/70">
          <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/50" aria-hidden="true" />
          {visitorTimeZone ? (
            <span>
              Saatler <strong className="font-medium text-foreground">{visitorTimeZone}</strong> diliminizde gösteriliyor
              <span className="text-foreground/50"> (doktorun yerel saat dilimi: {doctorTimeZone})</span>
            </span>
          ) : (
            <span>Saat dilimi algılanıyor…</span>
          )}
        </div>

        {slots.length === 0 && <p className="text-sm text-foreground/60">Önümüzdeki günlerde müsait bir saat bulunmuyor.</p>}
      </div>

      {slots.length > 0 && (
        <>
          {/* TAKVİM KARTI — `lg:col-span-4`. Legend ARTIK burada (task madde 2 — takvim kartının
              hemen üstünde, kompakt), üst meta bloğunda DEĞİL. */}
          <div className="lg:col-span-4">
            <div className="mb-3">
              <SlotAvailabilityLegend />
            </div>
            {/* §2.3.1 — ay navigasyonu + §2.3.2 — 7 sütunlu gün ızgarası, tek kart yüzeyi. */}
            <div className="rounded-[var(--site-radius)] border border-border bg-surface p-4 sm:p-5">
              <div className="mb-6 flex items-center justify-between sm:mb-8">
                <button
                  type="button"
                  aria-label="Önceki ay"
                  disabled={isPrevMonthDisabled}
                  onClick={() => changeMonth(-1)}
                  className="flex h-9 w-9 items-center justify-center rounded-[var(--site-radius)] border border-border text-foreground/70 transition-colors duration-150 hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <p className="text-sm font-semibold uppercase tracking-wider text-foreground">
                  {formatMonthLabel(viewMonth.year, viewMonth.month0)}
                </p>
                <button
                  type="button"
                  aria-label="Sonraki ay"
                  onClick={() => changeMonth(1)}
                  className="flex h-9 w-9 items-center justify-center rounded-[var(--site-radius)] border border-border text-foreground/70 transition-colors duration-150 hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="mb-1 grid grid-cols-7 gap-1">
                {["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map((d) => (
                  <span key={d} className="flex h-6 items-center justify-center text-[11px] font-semibold uppercase tracking-wide text-foreground/40">
                    {d}
                  </span>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {(() => {
                  const { year, month0 } = viewMonth;
                  const daysInMonth = daysInMonthUTC(year, month0);
                  const leadingBlanks = firstWeekdayMondayIndex(year, month0);
                  const cells: Array<{ day: number; dayKey: string } | null> = [];
                  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
                  for (let day = 1; day <= daysInMonth; day++) cells.push({ day, dayKey: buildDayKey(year, month0, day) });

                  return cells.map((cell, idx) => {
                    if (!cell) return <span key={`blank-${idx}`} aria-hidden="true" className="aspect-square w-full" />;

                    const { day, dayKey } = cell;
                    const isAvailable = availableDayKeySet.has(dayKey);
                    const isSelected = dayKey === selectedDayKey;
                    const isEarliest = dayKey === earliestKey;
                    const isWeekend = isWeekendDay(year, month0, day);
                    const datePart = formatCellDatePart(year, month0, day);

                    if (isSelected) {
                      return (
                        <button
                          key={dayKey}
                          type="button"
                          aria-pressed="true"
                          aria-label={`${datePart} — seçili${isEarliest ? ", en yakın randevu tarihi" : ""}`}
                          onClick={() => setSelectedDayKey(dayKey)}
                          // Görev (2026-09-14) Görev 2 — takvim SEÇİLİ GÜN hücresi artık admin
                          // panelinden yönetilen `calendarActiveBg`'e (`.telehealth-scope`'un
                          // `--telehealth-calendar-active-bg`'i) EXPLICIT bağlanır; `--primary`
                          // cascade'inden BAĞIMSIZ, ayrı bir semantik kavram (bkz. layout notu).
                          className="relative flex aspect-square w-full flex-col items-center justify-center gap-0.5 rounded-[var(--site-radius)] border-2 border-transparent bg-[var(--telehealth-calendar-active-bg)] text-sm font-semibold tabular-nums text-primary-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:text-base"
                        >
                          <span>{day}</span>
                          <Check className="h-2.5 w-2.5" aria-hidden="true" />
                        </button>
                      );
                    }

                    if (isAvailable) {
                      return (
                        <button
                          key={dayKey}
                          type="button"
                          aria-label={`${datePart} — müsait${isEarliest ? ", en yakın randevu tarihi" : ""}${isWeekend ? ", hafta sonu" : ""}`}
                          onClick={() => setSelectedDayKey(dayKey)}
                          className={cn(
                            "flex aspect-square w-full flex-col items-center justify-center gap-0.5 rounded-[var(--site-radius)] border text-sm font-medium tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:text-base",
                            isWeekend
                              ? "border-[var(--site-secondary)]/30 bg-[var(--site-secondary)]/10 text-foreground hover:border-[var(--site-secondary)]/50 hover:bg-[var(--site-secondary)]/20"
                              : "border-primary/20 bg-primary/5 text-foreground hover:border-primary/50 hover:bg-primary/10"
                          )}
                        >
                          <span>{day}</span>
                          {isEarliest ? (
                            <span aria-hidden="true" className="text-[8px] font-semibold uppercase leading-none tracking-wide text-primary">
                              Erken
                            </span>
                          ) : (
                            <span
                              aria-hidden="true"
                              className={cn("h-1 w-1 rounded-full", isWeekend ? "bg-[var(--site-secondary)]" : "bg-primary")}
                            />
                          )}
                        </button>
                      );
                    }

                    return (
                      <span
                        key={dayKey}
                        aria-label={`${datePart} — müsait saat yok`}
                        className="flex aspect-square w-full cursor-not-allowed items-center justify-center rounded-[var(--site-radius)] border border-transparent text-sm font-medium tabular-nums text-foreground/25 sm:text-base"
                      >
                        {day}
                      </span>
                    );
                  });
                })()}
              </div>

              {/* §2.3.2.1 — QA bug düzeltmesi: sayfa ilk açıldığında `selectedDayKey` zaten
                  `earliestKey`'e eşit olduğu için ızgaradaki hücre-içi "Erken" etiketi bu durumda
                  asla görünmez (o dal `isSelected` tarafından ele alınır). Bu koşullu satır
                  SADECE bu çakışma anında devreye girer ve bilgiyi ekran okuyucuya da taşır. */}
              {selectedDayKey === earliestKey && earliestKey !== null && (
                <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-primary">
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  En yakın müsait randevu tarihi seçili.
                </p>
              )}

              {monthFetchError && (
                <Alert variant="error" className="mt-3">
                  <span>{monthFetchError}</span>
                </Alert>
              )}
            </div>
          </div>

          {/* SAAT SLOTLARI KARTI — `lg:col-span-5`. "Dolu saatleri gizle" toggle'ı legend'dan
              AYRILDI, ARTIK bu kartla ilişkilendirildi (legend takvimi açıklar, bu toggle slot
              listesini filtreler — bkz. task notu). */}
          <div className="lg:col-span-5">
            <div className="mb-3">
              <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-foreground/70">
                {/* `aria-label` KASITLI olarak VERİLMEZ — bu `Switch` bir `<label>`'ın İÇİNDE render
                    edildiği için erişilebilir ad zaten o `<label>`'ın metninden ("Dolu saatleri
                    gizle") türetilir; İKİSİNİ BİRDEN vermek çift/yinelenen bir isimle sonuçlanırdı. */}
                <Switch size="sm" checked={hideFullSlots} onCheckedChange={setHideFullSlots} />
                Dolu saatleri gizle
              </label>
            </div>

            <div className="rounded-[var(--site-radius)] border border-border bg-surface p-4 sm:p-5 max-h-[460px] overflow-y-auto">
              {displayedHourGroups.length === 0 && activeDayItems.length > 0 && (
                <p className="rounded-[var(--site-radius)] border border-dashed border-border p-4 text-center text-sm text-foreground/50">
                  Bu gün için gösterilecek müsait saat yok. &quot;Dolu saatleri gizle&quot;yi kapatırsanız tüm saatleri görebilirsiniz.
                </p>
              )}

              {displayedHourGroups.length > 0 && (
                <div className="space-y-3">
                  {displayedHourGroups.map((group) => (
                    <section key={group.label} className="overflow-hidden rounded-[var(--site-radius)] border border-border">
                      {group.label === "Sabah" ? (
                        // Görev (2026-09-14) Görev 2 — "Sabah" grup başlığı sabit amber yerine
                        // `--telehealth-accent`'e (admin "Vurgu Rengi") EXPLICIT bağlanır;
                        // `color-mix` ile hafif bir zemin tonu üretilir (`--primary` cascade'inden
                        // BAĞIMSIZ, ayrı semantik kavram — bkz. layout notu).
                        <div
                          className="flex items-center gap-2 px-4 py-2.5"
                          style={{ backgroundColor: "color-mix(in oklch, var(--telehealth-accent) 12%, white)" }}
                        >
                          <Sun className="h-4 w-4 shrink-0" style={{ color: "var(--telehealth-accent)" }} aria-hidden="true" />
                          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--telehealth-accent)" }}>
                            ÖÖ Sabah
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 bg-muted px-4 py-2.5">
                          <CloudSun className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden="true" />
                          <span className="text-xs font-semibold uppercase tracking-wider text-foreground/70">ÖS Öğleden Sonra</span>
                        </div>
                      )}

                      <div
                        role="group"
                        aria-label={`${group.label} müsaitlik saatleri, en fazla ${MAX_BOOKING_SLOTS} seçim`}
                        className="grid grid-cols-3 gap-2.5 p-3 sm:grid-cols-4"
                      >
                        {group.items.map((slot) => {
                          const isPast = new Date(slot.startsAt).getTime() < now;
                          const isSelected = selectedSlots.some((s) => s.startsAt === slot.startsAt);
                          const time = formatTime(slot.startsAt, displayTimeZone);

                          if (isSelected) {
                            return (
                              <button
                                key={slot.startsAt}
                                type="button"
                                role="checkbox"
                                aria-checked="true"
                                aria-label={`${time} — seçili`}
                                onClick={() => handleSlotClick(slot)}
                                className={cn(SELECTION_PILL_BASE, "px-3 min-w-[84px]", SELECTION_PILL_SELECTED)}
                              >
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                {time}
                              </button>
                            );
                          }

                          // frontend-agent — hekim oturumu için müsait slotlar TIKLANAMAZ hale
                          // getirilir (backend'deki 403 `FORBIDDEN` guard'ıyla TUTARLI).
                          if (slot.available && isDoctorSession) {
                            return (
                              <Tooltip key={slot.startsAt}>
                                <TooltipTrigger>
                                  <span
                                    aria-disabled="true"
                                    aria-label={`${time} — müsait, ancak hekim oturumu ile randevu alınamaz`}
                                    className={cn(SELECTION_PILL_BASE, "px-3 min-w-[84px]", SELECTION_PILL_AT_LIMIT)}
                                  >
                                    {time}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>Hekim oturumu ile randevu alınamaz.</TooltipContent>
                              </Tooltip>
                            );
                          }

                          if (!slot.available && isPast) {
                            return (
                              <span
                                key={slot.startsAt}
                                aria-label={`${time} — geçmiş, artık kullanılamaz`}
                                className="flex h-10 min-w-[84px] cursor-not-allowed items-center justify-center rounded-[var(--site-radius)] border border-transparent px-3 text-sm font-medium tabular-nums text-foreground/25"
                              >
                                {time}
                              </span>
                            );
                          }

                          if (!slot.available) {
                            return (
                              <span
                                key={slot.startsAt}
                                aria-label={`${time} — dolu, seçilemez`}
                                aria-disabled="true"
                                className="flex h-10 min-w-[84px] cursor-not-allowed flex-col items-center justify-center rounded-[var(--site-radius)] border border-border/60 bg-muted px-3 text-sm font-medium tabular-nums text-foreground/40"
                              >
                                <span className="line-through decoration-foreground/30">{time}</span>
                                <span className="text-[10px] text-foreground/50">Dolu</span>
                              </span>
                            );
                          }

                          // §12.2.2 — 4/4 sınırına ulaşıldığında henüz seçilmemiş müsait slotlar
                          // "dolu" DEĞİL, kendi soluk/nötr "geçici olarak seçilemez" durumuna girer.
                          if (selectedSlots.length >= MAX_BOOKING_SLOTS) {
                            return (
                              <Tooltip key={slot.startsAt}>
                                <TooltipTrigger>
                                  <span
                                    aria-disabled="true"
                                    aria-label={`${time} — müsait, ancak en fazla ${MAX_BOOKING_SLOTS} slot seçilebilir`}
                                    className={cn(SELECTION_PILL_BASE, "px-3 min-w-[84px]", SELECTION_PILL_AT_LIMIT)}
                                  >
                                    {time}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>En fazla {MAX_BOOKING_SLOTS} slot seçebilirsiniz</TooltipContent>
                              </Tooltip>
                            );
                          }

                          return (
                            <button
                              key={slot.startsAt}
                              type="button"
                              role="checkbox"
                              aria-checked="false"
                              aria-label={`${time} — müsait`}
                              onClick={() => handleSlotClick(slot)}
                              className={cn(SELECTION_PILL_BASE, "px-3 min-w-[84px]", SELECTION_PILL_AVAILABLE)}
                            >
                              {time}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>

            {/* §12.2.3 — farklı bir gün seçildiğinde önceki seçim otomatik temizlenir + bilgi notu. */}
            {dayChangedNotice && (
              <Alert variant="info" className="mt-3">
                Farklı bir gün seçtiğiniz için önceki seçiminiz temizlendi.
              </Alert>
            )}
          </div>
        </>
      )}
    </>
  );
}
