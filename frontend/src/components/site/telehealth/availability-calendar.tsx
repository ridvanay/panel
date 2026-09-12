"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, ChevronLeft, ChevronRight, CloudSun, Globe, Loader2, Sun } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AvailabilitySlot, CreateBookingResult, SitePage } from "@/lib/api/types";
import { MAX_BOOKING_SLOTS } from "@/lib/api/types";
import { formatDayKey, formatTime } from "@/lib/telehealth-format";
import { useBookingSelection } from "@/components/site/telehealth/booking-selection-context";
import { BookingPostCreationFlow } from "@/components/site/telehealth/booking-post-creation-flow";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { cn } from "@/lib/utils";
import Link from "next/link";

/**
 * `.claude/architect-scope-telehealth-template.md` §4.2/§9.7.2 + `.claude/design-notes-telehealth.md`
 * §2.3/§4/§12 — ay takvimi ızgarası + iki saat grubuna (ÖÖ Sabah/ÖS Öğleden Sonra) ayrılmış ÇOKLU
 * slot seçim ızgarası (1..4, AYNI gün) + randevu formu. `selectedSlots` `booking-selection-
 * context.tsx` üzerinden PAYLAŞILIR ("Hizmet Özeti" paneli AYNI seçimi sağ sütunda gösterir); bu
 * dosya context'in TÜKETİCİSİ ve TEK yazarıdır, context'in SAHİBİ DEĞİLDİR.
 *
 * [TCT] §9.7.2 (bağlayıcı) — TEKİL slot varsayımı KALDIRILDI: `POST /appointments/bookings` ile
 * `slots: string[]` (1..4) gönderilir; tutar (`totalCents`) İSTEMCİDEN ASLA gönderilmez, yalnızca
 * yanıttaki değer kanoniktir. `.claude/design-notes-telehealth.md` §12.1 — standalone "seçim onay
 * şeridi" TAMAMEN KALDIRILDI, "Değiştir" aksiyonu Hizmet Özeti kutusuna taşındı
 * (`doctor-service-summary.tsx`).
 */

interface AvailabilityCalendarProps {
  doctorSlug: string;
  doctorTimeZone: string;
  lang: string;
  defaultLocaleCode: string;
  initialSlots: AvailabilitySlot[];
  kvkkPage: Pick<SitePage, "title" | "slug"> | null;
}

const bookingFormSchema = z.object({
  patientName: z.string().trim().min(1, "Ad soyad gerekli.").max(120),
  patientEmail: z.string().trim().min(1, "E-posta gerekli.").email("Geçerli bir e-posta girin.").max(255),
  consent: z.literal(true, { errorMap: () => ({ message: "Devam etmek için KVKK Aydınlatma Metni'ni onaylamalısınız." }) }),
});
type BookingFormValues = z.infer<typeof bookingFormSchema>;

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
const SELECTION_PILL_AVAILABLE = "border-border bg-surface text-foreground hover:border-primary/50 hover:bg-primary/5";
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

export function AvailabilityCalendar({ doctorSlug, doctorTimeZone, lang, defaultLocaleCode, initialSlots, kvkkPage }: AvailabilityCalendarProps) {
  const router = useRouter();
  const { selectedSlots, toggleSlot, clearAllSlots, displayTimeZone, visitorTimeZone } = useBookingSelection();
  const [slots, setSlots] = useState<AvailabilitySlot[]>(initialSlots);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [dayChangedNotice, setDayChangedNotice] = useState(false);
  const [bookingResult, setBookingResult] = useState<CreateBookingResult | null>(null);

  // §2.3.1 — takvimin başlangıç sayfası. `initialSlots`/`doctorTimeZone` SUNUCU/istemci İLK
  // render'ında AYNIDIR (hidrasyon güvenli, `visitorTimeZone` henüz BİLİNMİYOR) — mount sonrası
  // `displayTimeZone` değişse de bu başlangıç değeri GERİYE dönük değiştirilmez (kullanıcı zaten
  // navigasyona başlamış olabilir, ani bir ay sıçraması İSTENMEZ).
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

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: { patientName: "", patientEmail: "", consent: undefined as unknown as true },
  });

  /** §2.3.1 — ay değiştiğinde o ayın slotlarını (henüz yüklenmemişse) getirir, mevcutlarla BİRLEŞTİRİR. */
  async function fetchMonthSlots(year: number, month0: number) {
    const from = `${year}-${pad2(month0 + 1)}-01`;
    const to = `${year}-${pad2(month0 + 1)}-${pad2(daysInMonthUTC(year, month0))}`;
    try {
      const fetched = await telehealthApi.getDoctorSlots(doctorSlug, from, to);
      setSlots((prev) => mergeSlots(prev, fetched));
    } catch (err) {
      setBookingError(friendlyErrorMessage(err));
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
    if (!slot.available) return;
    setBookingError(null);
    const { dayChanged } = toggleSlot(slot, displayTimeZone);
    setDayChangedNotice(dayChanged);
  }

  async function onSubmit(values: BookingFormValues) {
    if (selectedSlots.length === 0) return;
    setBookingError(null);
    try {
      const result = await telehealthApi.createBooking({
        doctorSlug,
        slots: selectedSlots.map((s) => s.startsAt),
        patientName: values.patientName,
        patientEmail: values.patientEmail,
        consent: true,
      });
      setBookingResult(result);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        setBookingError("Seçtiğiniz saatlerden biri az önce başka biri tarafından alındı. Lütfen yeniden seçin.");
        clearAllSlots();
        // Slotları yeniden getirerek ızgarayı tazele — kullanıcı aynı hatayı tekrar görmesin.
        router.refresh();
      } else {
        setBookingError(friendlyErrorMessage(err));
      }
    }
  }

  if (bookingResult) {
    return <BookingPostCreationFlow result={bookingResult} displayTimeZone={displayTimeZone} />;
  }

  return (
    <div className="space-y-4">
      {/* §4/§2.3.5 — 2 aşamalı saat dilimi rozeti (hidrasyon uyuşmazlığı önlenir), stil KORUNUR. */}
      <div className="mb-4 flex items-start gap-2 rounded-[var(--site-radius)] border border-border bg-muted/50 px-3 py-2 text-xs text-foreground/70">
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

      {slots.length === 0 ? (
        <p className="text-sm text-foreground/60">Önümüzdeki günlerde müsait bir saat bulunmuyor.</p>
      ) : (
        <div>
          {/* §2.3.1 — ay navigasyonu + §2.3.2 — 7 sütunlu gün ızgarası, tek kart yüzeyi. */}
          <div className="rounded-[var(--site-radius)] border border-border bg-surface p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
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
                  if (!cell) return <span key={`blank-${idx}`} aria-hidden="true" className="h-10 w-full sm:h-11" />;

                  const { day, dayKey } = cell;
                  const isAvailable = availableDayKeySet.has(dayKey);
                  const isSelected = dayKey === selectedDayKey;
                  const isEarliest = dayKey === earliestKey;
                  const datePart = formatCellDatePart(year, month0, day);

                  if (isSelected) {
                    return (
                      <button
                        key={dayKey}
                        type="button"
                        aria-pressed="true"
                        aria-label={`${datePart} — seçili${isEarliest ? ", en yakın randevu tarihi" : ""}`}
                        onClick={() => setSelectedDayKey(dayKey)}
                        className="relative flex h-10 w-full flex-col items-center justify-center gap-0.5 rounded-[var(--site-radius)] border-2 border-transparent bg-primary text-sm font-semibold tabular-nums text-primary-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:h-11"
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
                        aria-label={`${datePart} — müsait${isEarliest ? ", en yakın randevu tarihi" : ""}`}
                        onClick={() => setSelectedDayKey(dayKey)}
                        className="flex h-10 w-full flex-col items-center justify-center gap-0.5 rounded-[var(--site-radius)] border border-primary/20 bg-primary/5 text-sm font-medium tabular-nums text-foreground transition-colors duration-150 hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:h-11"
                      >
                        <span>{day}</span>
                        {isEarliest ? (
                          <span aria-hidden="true" className="text-[8px] font-semibold uppercase leading-none tracking-wide text-primary">
                            Erken
                          </span>
                        ) : (
                          <span aria-hidden="true" className="h-1 w-1 rounded-full bg-primary" />
                        )}
                      </button>
                    );
                  }

                  return (
                    <span
                      key={dayKey}
                      aria-label={`${datePart} — müsait saat yok`}
                      className="flex h-10 w-full cursor-not-allowed items-center justify-center rounded-[var(--site-radius)] border border-transparent text-sm font-medium tabular-nums text-foreground/25 sm:h-11"
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
                SADECE bu çakışma anında (seçili gün ≡ en yakın müsait gün) devreye girer ve
                bilgiyi ekran okuyucuya da taşır — başka bir gün seçildiğinde kaybolur, çünkü o
                durumda ızgaranın kendi "Erken" sinyali zaten görünür. */}
            {selectedDayKey === earliestKey && earliestKey !== null && (
              <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-primary">
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                En yakın müsait randevu tarihi seçili.
              </p>
            )}
          </div>

          {hourGroups.length > 0 && (
            <div className="mt-5 space-y-3">
              {hourGroups.map((group) => (
                <section key={group.label} className="overflow-hidden rounded-[var(--site-radius)] border border-border">
                  {group.label === "Sabah" ? (
                    <div className="flex items-center gap-2 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-2.5">
                      <Sun className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-amber-900">ÖÖ Sabah</span>
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
                    className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2 p-3"
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

          {/* §12.2.3 — farklı bir gün seçildiğinde önceki seçim otomatik temizlenir + bilgi notu. */}
          {dayChangedNotice && (
            <Alert variant="info" className="mt-3">
              Farklı bir gün seçtiğiniz için önceki seçiminiz temizlendi.
            </Alert>
          )}
        </div>
      )}

      {selectedSlots.length > 0 && (
        <form className="mt-4 space-y-4 rounded-[var(--site-radius)] border border-border bg-surface p-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Field id="patientName" label="Ad soyad" error={errors.patientName?.message} required>
            {(inputProps) => <Input {...inputProps} {...register("patientName")} />}
          </Field>
          <Field
            id="patientEmail"
            label="E-posta"
            error={errors.patientEmail?.message}
            required
            hint="Randevu kaydınızla ilişkilendirilecek ve ödeme onaylandığında güvenli erişim bağlantınız bu adrese gönderilecektir."
          >
            {(inputProps) => <Input {...inputProps} type="email" {...register("patientEmail")} />}
          </Field>

          {/*
            compliance-agent NİHAİ onayı (Tur 1, `.claude/compliance-notes-telehealth.md`):
            aşağıdaki onay kutusu metni bu görev kapsamında finalize edilmiştir — varsayılan
            İŞARETSİZ ve backend `consent: z.literal(true)` ile ZORUNLU kılınmıştır. Bu, sağlık
            verisi rızasından (`booking-intake-step.tsx`) TAMAMEN AYRI, randevu KVKK onayıdır.
          */}
          <div>
            <label htmlFor="consent" className="flex items-start gap-2.5 text-sm text-foreground/80">
              <Controller
                control={control}
                name="consent"
                render={({ field }) => (
                  <Checkbox
                    id="consent"
                    className="mt-0.5"
                    aria-invalid={errors.consent ? true : undefined}
                    checked={field.value === true}
                    onCheckedChange={(checked) => field.onChange(checked === true ? true : undefined)}
                  />
                )}
              />
              <span>
                {kvkkPage ? (
                  <Link href={withLocalePrefix(`/${kvkkPage.slug}`, lang, defaultLocaleCode)} target="_blank" className="text-primary underline-offset-4 hover:underline">
                    KVKK Aydınlatma Metni
                  </Link>
                ) : (
                  "KVKK Aydınlatma Metni"
                )}
                {"'"}ni okudum, kişisel verilerimin bu randevu kapsamında işlenmesine açık rızamı veriyorum.
              </span>
            </label>
            {errors.consent && (
              <p role="alert" className="pl-6 text-xs text-danger">
                {errors.consent.message}
              </p>
            )}
          </div>

          {bookingError && (
            <Alert variant="error">
              <span>{bookingError}</span>
            </Alert>
          )}

          <Button type="submit" loading={isSubmitting} className="w-full rounded-[var(--site-radius)]">
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Randevuyu Onayla
          </Button>
        </form>
      )}

      {selectedSlots.length === 0 && bookingError && (
        <Alert variant="error">
          <span>{bookingError}</span>
        </Alert>
      )}
    </div>
  );
}
