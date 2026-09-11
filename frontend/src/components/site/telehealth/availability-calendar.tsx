"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, Globe, Loader2 } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AvailabilitySlot, SitePage } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert } from "@/components/ui/alert";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { cn } from "@/lib/utils";
import Link from "next/link";

/**
 * `.claude/architect-scope-telehealth-template.md` §4.2 + `.claude/design-notes-telehealth.md`
 * §3/§4 — saat dilimi duyarlı slot takvimi + randevu formu. Ziyaretçi dilimi
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` ile YALNIZCA istemcide, mount SONRASI okunur
 * (hidrasyon uyuşmazlığı önlenir — SSR'da slot verisi zaten alınmıştır, yalnızca SAAT
 * BİÇİMLENDİRME istemcide yapılır). ÖNEMLİ: mount öncesi/hydration anındaki render `timeZone`
 * parametresi olarak ASLA `undefined` GEÇMEMELİDİR — `Intl.DateTimeFormat` `timeZone: undefined`
 * ile çalışma zamanının kendi yerel dilimini kullanır ve bu sunucuda (konteyner) ile istemcinin
 * hydration'daki İLK render'ında (tarayıcı yerel dilimi) FARKLI sonuç üretip hydration mismatch'e
 * yol açar. Bu yüzden mount öncesi/`visitorTimeZone` bilinmeden önce sunucudan gelen
 * (dolayısıyla SSR/istemci arasında AYNI) `doctorTimeZone` fallback olarak kullanılır — bkz.
 * `displayTimeZone`.
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

function formatDayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function formatDayLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("tr-TR", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
}

function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("tr-TR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

export function AvailabilityCalendar({ doctorSlug, doctorTimeZone, lang, defaultLocaleCode, initialSlots, kvkkPage }: AvailabilityCalendarProps) {
  const router = useRouter();
  const [visitorTimeZone, setVisitorTimeZone] = useState<string | undefined>(undefined);
  const [slots, setSlots] = useState<AvailabilitySlot[]>(initialSlots);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingResult, setBookingResult] = useState<{ id: string; accessToken: string } | null>(null);

  // §4.2 bağlayıcı — mount SONRASI okunur, SSR ilk boyada YOK.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ziyaretçi dilimi yalnızca istemcide okunabilir (Intl), bu değeri React dışı bir kaynaktan React state'ine SENKRONİZE etmenin tek yolu budur (§4.2)
    setVisitorTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  // Hidrasyon KÖK NEDENİ düzeltmesi: `Intl.DateTimeFormat(..., { timeZone: undefined })`
  // ÇALIŞMA ZAMANININ varsayılan saat dilimini kullanır — bu sunucuda (konteyner, ör. UTC) ve
  // istemcinin React'in hydration için yaptığı İLK render'ında (tarayıcı yerel dilimi, ör.
  // Europe/Istanbul) FARKLIDIR; `undefined` "sunucu diliminde sabit kalır" ANLAMINA GELMEZ, her
  // ortam kendi yerelini uygular. Bu yüzden mount öncesi/hydration anında sunucu ve istemcinin
  // AYNI, deterministik değeri üretmesi için sunucudan gelen `doctorTimeZone` kullanılır (SSR ve
  // istemcinin ilk render'ı birebir eşleşir); mount SONRASI `visitorTimeZone` bilinince gerçek
  // ziyaretçi dilimine geçilir (§4.2).
  const displayTimeZone = visitorTimeZone ?? doctorTimeZone;

  // eslint-disable-next-line react-hooks/purity -- slot durumunu (müsait/dolu/geçmiş) "şu an" ile karşılaştırmak GEREKİR; sayaç gibi saniyede bir tick ATMASI gerekmez, yalnızca render anındaki an yeterlidir
  const now = Date.now();

  const dayGroups = useMemo(() => {
    const groups = new Map<string, AvailabilitySlot[]>();
    for (const slot of slots) {
      const key = formatDayKey(slot.startsAt, displayTimeZone);
      const list = groups.get(key) ?? [];
      list.push(slot);
      groups.set(key, list);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({ key, items: items.sort((a, b) => a.startsAt.localeCompare(b.startsAt)) }));
  }, [slots, displayTimeZone]);

  useEffect(() => {
    if (selectedDayKey === null && dayGroups.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ilk yüklemede varsayılan gün seçimi, kullanıcı etkileşimini TAKLİT etmez
      setSelectedDayKey(dayGroups[0]!.key);
    }
  }, [dayGroups, selectedDayKey]);

  const activeDay = dayGroups.find((d) => d.key === selectedDayKey) ?? dayGroups[0] ?? null;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: { patientName: "", patientEmail: "", consent: undefined as unknown as true },
  });

  async function loadMoreDays() {
    const lastSlot = slots[slots.length - 1];
    const fromDate = lastSlot ? new Date(lastSlot.startsAt) : new Date();
    fromDate.setUTCDate(fromDate.getUTCDate() + 1);
    const toDate = new Date(fromDate);
    toDate.setUTCDate(toDate.getUTCDate() + 13);
    const from = fromDate.toISOString().slice(0, 10);
    const to = toDate.toISOString().slice(0, 10);
    try {
      const more = await telehealthApi.getDoctorSlots(doctorSlug, from, to);
      setSlots((prev) => [...prev, ...more]);
    } catch (err) {
      setBookingError(friendlyErrorMessage(err));
    }
  }

  function selectSlot(slot: AvailabilitySlot) {
    if (!slot.available) return;
    setSelectedSlot(slot);
    setBookingError(null);
  }

  async function onSubmit(values: BookingFormValues) {
    if (!selectedSlot) return;
    setBookingError(null);
    try {
      const result = await telehealthApi.createAppointment({
        doctorSlug,
        startsAt: selectedSlot.startsAt,
        patientName: values.patientName,
        patientEmail: values.patientEmail,
        consent: true,
      });
      setBookingResult({ id: result.id, accessToken: result.accessToken });
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        setBookingError("Bu saat az önce başka biri tarafından alındı. Lütfen başka bir saat seçin.");
        setSelectedSlot(null);
        // Slotu yeniden getirerek ızgarayı tazele — kullanıcı aynı hatayı tekrar görmesin.
        router.refresh();
      } else {
        setBookingError(friendlyErrorMessage(err));
      }
    }
  }

  if (bookingResult) {
    const consultationHref = withLocalePrefix(`/consultation/${bookingResult.id}?t=${bookingResult.accessToken}`, lang, defaultLocaleCode);
    return (
      <Alert variant="success">
        <div className="space-y-2">
          <p className="font-medium">Randevunuz oluşturuldu.</p>
          <p className="text-sm">
            Randevu saatinizde{" "}
            <Link href={consultationHref} className="font-medium text-primary hover:underline">
              bu bağlantı
            </Link>{" "}
            üzerinden görüşmeye katılabilirsiniz.{" "}
            {/* compliance-agent (§7.3) — bu sürümde randevu onay/hatırlatma e-postası GÖNDERİLMEZ
                (mimari doküman §11 backlog: `feature/telehealth-appointment-emails`,
                notification-agent). Buradaki metin bu bağlantının SADECE bu ekranda gösterildiğini
                doğru şekilde yansıtır — "e-postanıza da kaydettik" gibi gerçekleşmeyen bir işlemi
                iddia ETMEZ (KVKK m.10/GDPR m.13 şeffaflık ilkesi: yapılmayan bir veri işleme
                faaliyetini yapılmış gibi göstermek yasaktır). */}
            Bu bağlantıyı not alın veya bu sayfayı yer imlerine ekleyin — bu sürümde bağlantı ayrıca
            e-posta ile gönderilmemektedir.
          </p>
        </div>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* §4 — 2 aşamalı saat dilimi rozeti (hidrasyon uyuşmazlığı önlenir). */}
      <div className="mb-1 flex items-start gap-2 rounded-[var(--site-radius)] border border-border bg-muted/50 px-3 py-2 text-xs text-foreground/70">
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

      {dayGroups.length === 0 ? (
        <p className="text-sm text-foreground/60">Önümüzdeki günlerde müsait bir saat bulunmuyor.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Gün seçin">
            {dayGroups.map((day) => {
              const active = day.key === activeDay?.key;
              return (
                <button
                  key={day.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedDayKey(day.key)}
                  className={cn(
                    "rounded-[var(--site-radius)] border px-3 py-1.5 text-sm font-medium transition-colors duration-150",
                    active ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-foreground/70 hover:border-primary/40"
                  )}
                >
                  {formatDayLabel(day.items[0]!.startsAt, displayTimeZone)}
                </button>
              );
            })}
          </div>

          {activeDay && (
            <div
              role="radiogroup"
              aria-label={`${formatDayLabel(activeDay.items[0]!.startsAt, displayTimeZone)} müsaitlik saatleri`}
              className="flex flex-wrap gap-2"
            >
              {activeDay.items.map((slot) => {
                const isPast = new Date(slot.startsAt).getTime() < now;
                const isSelected = selectedSlot?.startsAt === slot.startsAt;
                const time = formatTime(slot.startsAt, displayTimeZone);

                if (isSelected) {
                  return (
                    <button
                      key={slot.startsAt}
                      type="button"
                      role="radio"
                      aria-checked="true"
                      aria-label={`${time} — seçili`}
                      onClick={() => selectSlot(slot)}
                      className="flex h-10 min-w-[84px] items-center justify-center gap-1 rounded-[var(--site-radius)] border-2 border-transparent bg-primary px-3 text-sm font-medium tabular-nums text-primary-foreground ring-2 ring-offset-2 ring-offset-surface ring-primary"
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

                return (
                  <button
                    key={slot.startsAt}
                    type="button"
                    role="radio"
                    aria-checked="false"
                    aria-label={`${time} — müsait`}
                    onClick={() => selectSlot(slot)}
                    className="flex h-10 min-w-[84px] items-center justify-center rounded-[var(--site-radius)] border border-border bg-surface px-3 text-sm font-medium tabular-nums text-foreground transition-colors duration-150 hover:border-primary/50 hover:bg-primary/5"
                  >
                    {time}
                  </button>
                );
              })}
            </div>
          )}

          <Button type="button" variant="ghost" size="sm" onClick={() => void loadMoreDays()}>
            Daha fazla gün göster
          </Button>
        </>
      )}

      {selectedSlot && (
        <form className="mt-4 space-y-4 rounded-[var(--site-radius)] border border-border bg-surface p-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <p className="text-sm font-medium text-foreground">
            Seçilen saat: {formatDayLabel(selectedSlot.startsAt, displayTimeZone)} · {formatTime(selectedSlot.startsAt, displayTimeZone)}
          </p>

          <Field id="patientName" label="Ad soyad" error={errors.patientName?.message} required>
            {(inputProps) => <Input {...inputProps} {...register("patientName")} />}
          </Field>
          <Field
            id="patientEmail"
            label="E-posta"
            error={errors.patientEmail?.message}
            required
            // compliance-agent (§7.3) — bu e-posta yalnızca randevu kaydının bir parçası olarak
            // SAKLANIR (PII snapshot, bkz. Appointment.patientEmail); bu sürümde otomatik bir
            // e-posta GÖNDERİLMEZ (§11 backlog). İpucu metni bunu doğru yansıtır.
            hint="Randevu kaydınızla ilişkilendirilecektir; bu sürümde otomatik e-posta gönderilmez."
          >

            {(inputProps) => <Input {...inputProps} type="email" {...register("patientEmail")} />}
          </Field>

          {/*
            compliance-agent NİHAİ onayı (§7.3/§7.4, `.claude/compliance-notes-telehealth.md`):
            aşağıdaki onay kutusu metni bu görev kapsamında finalize edilmiştir — varsayılan
            İŞARETSİZ (`defaultValues.consent = undefined`) ve backend `consent: z.literal(true)`
            ile ZORUNLU kılınmıştır (bkz. `telehealth.schemas.ts::CreateAppointmentRequestSchema`).
            UYARI: bu metin de, bağlandığı "KVKK Aydınlatma Metni" sayfası da bir YER TUTUCUDUR ve
            hukuki geçerliliği yoktur ([EPT] §4.3 ilkesiyle aynı ruh) — canlıya almadan önce gerçek
            bir hukuk danışmanıyla birlikte gözden geçirilip/doldurulması ZORUNLUDUR. Bu uyarı
            bilerek KULLANICIYA gösterilen metnin İÇİNE YAZILMAMIŞTIR (üretim ortamında müşteriyi
            gereksiz yere tedirgin eder) — aynı ilke bu şablonun `extraPages`'indeki
            `LEGAL_PLACEHOLDER_NOTICE` ile HER yasal sayfada zaten müşteri-yüzeyinde karşılanıyor.
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

      {!selectedSlot && bookingError && (
        <Alert variant="error">
          <span>{bookingError}</span>
        </Alert>
      )}
    </div>
  );
}
