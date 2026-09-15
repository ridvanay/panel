"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, ChevronLeft, Mail } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage, fieldErrorsFrom } from "@/lib/api/friendly-error";
import type { AvailabilitySlot, BookingIdentityInput, CreateBookingResult, DoctorProfile, SitePage } from "@/lib/api/types";
import { formatDayLabel, formatTime } from "@/lib/telehealth-format";
import { formatPriceFromCents } from "@/lib/format-price";
import { useBookingSelection } from "@/components/site/telehealth/booking-selection-context";
import { AvailabilityCalendar } from "@/components/site/telehealth/availability-calendar";
import { BookingIdentityStep } from "@/components/site/telehealth/booking-identity-step";
import { BookingIntakeStep } from "@/components/site/telehealth/booking-intake-step";
import { BookingPaymentStep } from "@/components/site/telehealth/booking-payment-step";
import { DoctorServiceSummaryPanel } from "@/components/site/telehealth/doctor-service-summary";
import { BookingStepperBar, type BookingStepperStep } from "@/components/site/telehealth/booking-stepper-bar";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Grid görevi (2026-09-14) Görev 1 — kurumsal, TEK butonlu, numaralandırılmış randevu sihirbazı.
 * Bu bileşen eski `AvailabilityCalendar`'ın (takvim/slot/form/booking oluşturma), eski
 * `IdentityStepDialog`'un (MODAL) ve eski `BookingPostCreationFlow`'un (2 iç adımlı ayrı akış)
 * hepsini TEK bir 5 adımlı `<BookingStepperBar>` altında BİRLEŞTİRİR:
 *
 *   [1. Hekim Seçimi (statik, tamamlanmış)] → [2. Tarih & Saat] → [3. Hasta & Kimlik]
 *   → [4. Tıbbi Belge/Şikayet] → [5. Ödeme & Onay]
 *
 * Mimari karar (görev veren tarafından, bağlayıcı) — Adım 1 İNTERAKTİF DEĞİLDİR: kullanıcı
 * `/doctors/[slug]`'a gelerek doktoru zaten SEÇMİŞTİR (`/doctors` listeleme sayfasında olur).
 * `currentStep` bu yüzden yalnızca 2..5 değerlerini alır.
 *
 * `DoctorServiceSummaryPanel` (sağ sticky sütun) ARTIK bu bileşenin İÇİNDE render edilir ve TEK
 * dinamik "Devam Et" butonunu barındırır (`currentStep`/`onContinue`/`continueDisabled`/
 * `continueLoading` prop'ları) — eski "Randevu Al" ANKOR butonu + AYRI "Randevu Oluştur" submit
 * butonu (kullanıcı şikayetinin kaynağı) TAMAMEN KALDIRILDI.
 *
 * Geri gitme — adım 2/3 arası SERBEST (booking henüz backend'de YOK); adım 4/5'e geçtikten SONRA
 * booking ZATEN oluşturulmuş olduğu için geri butonu GİZLENİR (yeniden `POST
 * /appointments/bookings` TETİKLENMEZ).
 */

const BOOKING_CONSENT_VERSION = "v2";

interface BookingWizardProps {
  doctor: DoctorProfile;
  doctorSlug: string;
  doctorTimeZone: string;
  lang: string;
  defaultLocaleCode: string;
  initialSlots: AvailabilitySlot[];
  kvkkPage: Pick<SitePage, "title" | "slug"> | null;
  intlLocale?: string;
}

type WizardStep = 2 | 3 | 4 | 5;

export function BookingWizard({ doctor, doctorSlug, doctorTimeZone, lang, defaultLocaleCode, initialSlots, kvkkPage, intlLocale }: BookingWizardProps) {
  const router = useRouter();
  const { selectedSlots, clearAllSlots, displayTimeZone } = useBookingSelection();

  const [currentStep, setCurrentStep] = useState<WizardStep>(2);
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);

  const [identityCanContinue, setIdentityCanContinue] = useState(false);
  const [identitySubmitting, setIdentitySubmitting] = useState(false);
  const [identityServerError, setIdentityServerError] = useState<string | null>(null);
  const [identityFieldErrors, setIdentityFieldErrors] = useState<Record<string, string>>({});
  const identityFormRef = useRef<HTMLFormElement>(null);

  const [bookingResult, setBookingResult] = useState<CreateBookingResult | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [resendError, setResendError] = useState<string | null>(null);

  async function handleIdentityContinue(identity: BookingIdentityInput, patientName: string, patientEmail: string) {
    if (selectedSlots.length === 0) return;
    setIdentitySubmitting(true);
    setIdentityServerError(null);
    setIdentityFieldErrors({});
    try {
      const result = await telehealthApi.createBooking({
        doctorSlug,
        slots: selectedSlots.map((s) => s.startsAt),
        patientName,
        patientEmail,
        identity,
        consent: true,
        consentVersion: BOOKING_CONSENT_VERSION,
      });
      setBookingResult(result);
      setCurrentStep(4);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        setConflictNotice("Seçtiğiniz saatlerden biri az önce başka biri tarafından alındı. Lütfen yeniden seçin.");
        clearAllSlots();
        setCurrentStep(2);
        // Slotları yeniden getirerek ızgarayı tazele — kullanıcı aynı hatayı tekrar görmesin.
        router.refresh();
      } else {
        // [DPI] §2.6 — 422 (geçersiz kimlik/yaş) adımda KALINIR, ilgili `Field`'ın hata slotu
        // sunucu mesajıyla doldurulur; hiçbir slot tutulmaz (backend tarafı).
        setIdentityServerError(friendlyErrorMessage(err));
        setIdentityFieldErrors(fieldErrorsFrom(err));
      }
    } finally {
      setIdentitySubmitting(false);
    }
  }

  async function handleResend() {
    if (!bookingResult) return;
    setResendState("sending");
    setResendError(null);
    try {
      await telehealthApi.resendBookingLink(bookingResult.bookingId);
      setResendState("sent");
    } catch (err) {
      setResendState("error");
      setResendError(friendlyErrorMessage(err));
    }
  }

  function handleContinueClick() {
    if (currentStep === 2) {
      if (selectedSlots.length === 0) return;
      setConflictNotice(null);
      setCurrentStep(3);
      return;
    }
    if (currentStep === 3) {
      // `booking-identity-step.tsx`'in `<form>`'unu native `requestSubmit()` ile tetikler —
      // doğrulama/gönderim mantığı O bileşenin İÇİNDE KALIR, burada TEKRAR EDİLMEZ.
      identityFormRef.current?.requestSubmit();
    }
  }

  const steps: BookingStepperStep[] = [
    { index: 1, label: `${doctor.title} ${doctor.fullName}`.trim(), status: "completed" },
    { index: 2, label: "Tarih & Saat", status: currentStep === 2 ? "current" : "completed" },
    { index: 3, label: "Hasta & Kimlik", status: currentStep === 3 ? "current" : currentStep > 3 ? "completed" : "upcoming" },
    { index: 4, label: "Tıbbi Belge", status: currentStep === 4 ? "current" : currentStep > 4 ? "completed" : "upcoming" },
    { index: 5, label: "Ödeme & Onay", status: currentStep === 5 ? "current" : "upcoming" },
  ];

  const showContinueButton = currentStep === 2 || currentStep === 3;
  const continueDisabled = currentStep === 2 ? selectedSlots.length === 0 : !identityCanContinue;
  const continueLoading = currentStep === 3 && identitySubmitting;

  return (
    <div className="space-y-6">
      <BookingStepperBar steps={steps} />

      {/* Grid görevi (2026-09-14) — TEK `lg:grid-cols-12` dış grid, grid SAHİPLİĞİ artık
          `AvailabilityCalendar`'ın kendi iç gridiyle BİRLEŞİK: adım 2'de `AvailabilityCalendar`
          bir Fragment döndürür (meta `lg:col-span-12` + takvim `lg:col-span-4` + slot
          `lg:col-span-5`, TOPLAM 9), bu üç/dört parça doğrudan bu gridin çocukları olur; diğer
          adımlarda (3/4/5) içerik `lg:col-span-9` sütununa sarılır. Sağ "Hizmet Özeti"
          `lg:col-span-3` — 9+3=12, her adımda AYNI toplam. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        {currentStep === 2 ? (
          <AvailabilityCalendar
            doctorSlug={doctorSlug}
            doctorTimeZone={doctorTimeZone}
            initialSlots={initialSlots}
            conflictNotice={conflictNotice}
          />
        ) : (
          <div className="lg:col-span-9 min-w-0 space-y-4">
            {currentStep === 3 && (
              <div>
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="mb-3 inline-flex items-center gap-1 rounded-[var(--site-radius)] text-sm font-medium text-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Tarih & Saat seçimine dön
                </button>
                <BookingIdentityStep
                  ref={identityFormRef}
                  submitting={identitySubmitting}
                  serverError={identityServerError}
                  serverFieldErrors={identityFieldErrors}
                  onContinue={(identity, patientName, patientEmail) => void handleIdentityContinue(identity, patientName, patientEmail)}
                  onCanContinueChange={setIdentityCanContinue}
                  kvkkPage={kvkkPage}
                  lang={lang}
                  defaultLocaleCode={defaultLocaleCode}
                />
              </div>
            )}

            {currentStep >= 4 && bookingResult && (
              <div className="space-y-4">
                <Alert variant="success">
                  <div className="space-y-2">
                    <p className="flex items-center gap-1.5 font-medium">
                      <CalendarCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                      Rezervasyonunuz oluşturuldu ({bookingResult.bookingNumber}).
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {bookingResult.appointments.map((appointment) => (
                        <span key={appointment.id} className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs tabular-nums">
                          {formatDayLabel(appointment.startsAt, displayTimeZone)} · {formatTime(appointment.startsAt, displayTimeZone)}
                        </span>
                      ))}
                    </div>
                    <p className="text-sm">
                      {bookingResult.slotCount} Slot · Toplam {formatPriceFromCents(bookingResult.totalCents, bookingResult.currency)}. Bu
                      rezervasyon slotu <strong>30 dakika</strong> tutar; bu süre içinde ödemeyi tamamlamanız gerekir.
                    </p>
                    <p className="text-sm">
                      Randevunuzu daha sonra görüntülemek için bu bağlantıyı not alın veya yer imlerine ekleyin — ödeme
                      onaylandığında aynı bağlantı e-posta ile de gönderilir.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button type="button" variant="outline" size="sm" onClick={() => void handleResend()} loading={resendState === "sending"}>
                        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                        Bağlantıyı e-posta ile gönder
                      </Button>
                      {resendState === "sent" && <span className="text-xs text-success">Gönderildi (e-posta kayıtlıysa).</span>}
                      {resendState === "error" && <span className="text-xs text-danger">{resendError}</span>}
                    </div>
                  </div>
                </Alert>

                {currentStep === 4 ? (
                  <BookingIntakeStep bookingId={bookingResult.bookingId} accessToken={bookingResult.accessToken} onDone={() => setCurrentStep(5)} />
                ) : (
                  <BookingPaymentStep
                    bookingId={bookingResult.bookingId}
                    accessToken={bookingResult.accessToken}
                    totalCents={bookingResult.totalCents}
                    currency={bookingResult.currency}
                    // `backend/.../checkout.routes.ts::buildPatientReturnUrl` (Stripe `success_url`)
                    // HER ZAMAN `localeSet.default.code`'u kullanır (aktif `lang` DEĞİL) — demo
                    // ödeme yönlendirmesi AYNI rotayı üretsin diye burada da `defaultLocaleCode`
                    // geçilir, `lang` DEĞİL.
                    lang={defaultLocaleCode}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* §2.4.1/§2.4.6 — sticky offset `lg:top-24`/`calc(100vh-7rem)` → `lg:top-6`/
            `calc(100vh-3rem)` (task madde 1 — "sticky top-6 olarak sabit kalsın", alt boşluk
            ORANTILI küçültüldü). Adım 4/5'te (booking zaten oluşmuşken) TEK "Devam Et" butonu
            artık `BookingIntakeStep`/`BookingPaymentStep`'in KENDİ aksiyonuna (Kaydet ve Devam Et /
            Bu adımı atla / Ödemeye Geç) bırakılır — panel `locked` modda (salt-okunur seçim özeti)
            İÇERİK olarak KALIR, ikinci bir buton EKLEMEZ. */}
        <aside className="lg:col-span-3 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
          <DoctorServiceSummaryPanel
            doctor={doctor}
            intlLocale={intlLocale}
            currentStep={currentStep}
            onContinue={handleContinueClick}
            continueDisabled={continueDisabled}
            continueLoading={continueLoading}
            showContinueButton={showContinueButton}
            locked={currentStep >= 4}
          />
        </aside>
      </div>
    </div>
  );
}
