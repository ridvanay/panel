"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, ChevronLeft } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage, fieldErrorsFrom } from "@/lib/api/friendly-error";
import type { Appointment, AvailabilitySlot, BookingIdentityInput, BookingPaymentStatus, DoctorProfile, SitePage } from "@/lib/api/types";
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
import { Spinner } from "@/components/ui/spinner";

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

/**
 * 2026-09-19 (kullanıcı talebi) — Adım 5'te (Ödeme & Onay) sayfa yenilenirse `bookingResult`
 * (bellek-içi `useState`) kaybolup akış baştan başlıyordu. `CreateBookingResult`'ın TÜMÜ değil,
 * bu bileşenin GERÇEKTEN kullandığı alt küme (`bookingId`/`accessToken`/`bookingNumber`/
 * `slotCount`/`totalCents`/`currency`/`appointments`) — hem oluşturma (`createBooking`) hem
 * kurtarma (`getBooking` + kalıcı depoda saklanan `accessToken`) yanıtından AYNI şekilde
 * üretilebilir (bkz. `recoverPendingBooking`).
 */
interface WizardBookingState {
  bookingId: string;
  accessToken: string;
  bookingNumber: string;
  slotCount: number;
  totalCents: number;
  currency: string;
  appointments: Appointment[];
  /** `totalCents === 0` (ücretsiz doktor) bookinginde backend booking'i ANINDA `PAID`e çevirir
   * (bkz. backend `telehealth.routes.ts::POST /appointments/bookings`) — Adım 5'te bu durumda
   * `BookingPaymentStep` HİÇ render edilmez, ödeme gerekmediğini belirten bir onay paneli gösterilir. */
  paymentStatus: BookingPaymentStatus;
}

/** `sessionStorage`/URL kalıcılığı için — doktora göre kapsamlı (aynı tarayıcıda farklı doktor için AYRI kayıt). */
function pendingBookingStorageKey(doctorSlug: string): string {
  return `wm-telehealth-pending-booking:${doctorSlug}`;
}

interface PendingBookingRef {
  bookingId: string;
  accessToken: string;
}

/**
 * URL (`?booking=&t=`) ÖNCELİKLİDİR — sayfa yenilendiğinde tarayıcı tarafından AYNEN korunur
 * (`sessionStorage` da AYNI sekmede korunur ama URL AYRICA paylaşılabilir/yer imine eklenebilir
 * bir "kaldığın yerden devam et" bağlantısı sağlar, mevcut `magic_link`/`join_link` deseniyle
 * AYNI — bkz. `notifications.ts::buildMagicLink`). `sessionStorage` yalnızca URL parametreleri
 * YOKSA (ör. kullanıcı elle `?booking=`i sildiyse) yedek olarak okunur.
 */
function readPendingBooking(doctorSlug: string): PendingBookingRef | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const urlBookingId = params.get("booking");
  const urlToken = params.get("t");
  if (urlBookingId && urlToken) return { bookingId: urlBookingId, accessToken: urlToken };
  try {
    const raw = sessionStorage.getItem(pendingBookingStorageKey(doctorSlug));
    return raw ? (JSON.parse(raw) as PendingBookingRef) : null;
  } catch {
    // Gizli sekme/depolama engeli — sessizce yok sayılır (yalnızca F5-sonrası kurtarma çalışmaz,
    // ana akış booking zaten backend'de VAR olduğu için ETKİLENMEZ).
    return null;
  }
}

function persistPendingBooking(doctorSlug: string, ref: PendingBookingRef): void {
  try {
    sessionStorage.setItem(pendingBookingStorageKey(doctorSlug), JSON.stringify(ref));
  } catch {
    // bkz. yukarıdaki not.
  }
  const url = new URL(window.location.href);
  url.searchParams.set("booking", ref.bookingId);
  url.searchParams.set("t", ref.accessToken);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}

function clearPendingBooking(doctorSlug: string): void {
  try {
    sessionStorage.removeItem(pendingBookingStorageKey(doctorSlug));
  } catch {
    // bkz. yukarıdaki not.
  }
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("booking") && !url.searchParams.has("t")) return;
  url.searchParams.delete("booking");
  url.searchParams.delete("t");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}

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

  const [bookingResult, setBookingResult] = useState<WizardBookingState | null>(null);
  // Yalnızca kalıcı bir booking kaydı GERÇEKTEN varsa `true` başlar (lazy initializer, render
  // ANINDA senkron kontrol) — aksi halde HER sayfa açılışında (kalıcı kayıt olsun/olmasın) bir
  // kare boyunca gereksiz bir yükleniyor spinner'ı yanıp söner.
  const [recovering, setRecovering] = useState(() => readPendingBooking(doctorSlug) !== null);

  /**
   * 2026-09-18 (kullanıcı talebi) — booking oluşturulduktan (Adım 4) SONRA ödeme tamamlanmadan
   * akış SPA-İÇİNDE terk edilirse (başka bir sayfaya `next/link` ile gidilir) tutulan slot ANINDA
   * serbest bırakılır. `bookingFinalizedRef`, ödeme BAŞLATILDIĞINDA (Stripe'a yönlendirmeden hemen
   * önce, bkz. `BookingPaymentStep`'e geçilen `onPaymentStarted`) veya demo ödeme BAŞARILI
   * olduğunda `true` olur — bu andan SONRA "terk edildi" sanıp iptal etmek, tam da ödeme
   * yapılırken/yapıldıktan hemen sonra rezervasyonu bozar.
   *
   * 2026-09-19 KRİTİK DÜZELTME (kullanıcı talebi, GÖREV 2) — eskiden BURADA AYRICA bir `pagehide`
   * dinleyicisi (`navigator.sendBeacon` ile) VARDI: sekme kapatma/F5/geri tuşunda da ANINDA iptal
   * ediyordu. Tarayıcı `pagehide`'ı SAYFA YENİLEMESİYLE GERÇEK TERK ETMEYİ AYIRT EDEMEZ (JS'ten
   * ikisi de aynı olaydır) — bu da Adım 5'te F5'e basan bir hastanın rezervasyonunun ANINDA iptal
   * edilmesine yol açıyordu (bu turun asıl şikayeti). Çözüm: F5/sekme kapatma artık BURADA hiç
   * iptal TETİKLEMEZ — bunun yerine booking `bookingId`/`accessToken`'ı kalıcı depoya yazılır
   * (aşağıdaki `persistPendingBooking`) ve sayfa yeniden yüklendiğinde `recoverPendingBooking`
   * backend'den GÜNCEL durumu sorup akışı KURTARIR. Gerçek terk (sekme kapanır, hasta HİÇ geri
   * dönmez) artık backend'in zaten var olan 30 dakikalık `PENDING` süre dolumuna/süpürücüsüne
   * bırakılır — SADECE SPA-içi (uygulama İÇİNDE başka bir sayfaya gidiş, aşağıdaki `return` temizliği)
   * terk hâlâ ANINDA iptal eder (bu durumda React'in unmount temizliği GÜVENİLİR şekilde çalışır).
   */
  const bookingFinalizedRef = useRef(false);

  useEffect(() => {
    if (!bookingResult) return;
    const { bookingId, accessToken } = bookingResult;
    return () => {
      if (!bookingFinalizedRef.current) {
        void telehealthApi.cancelBooking(bookingId, accessToken).catch(() => {});
        clearPendingBooking(doctorSlug);
      }
    };
  }, [bookingResult, doctorSlug]);

  /**
   * 2026-09-19 (kullanıcı talebi, GÖREV 2) — mount anında BİR KEZ çalışır: URL'de (`?booking=&t=`,
   * daha güvenilir — sayfa yeniden yüklendiğinde AYNEN korunur) ya da `sessionStorage`'da
   * (`pendingBookingStorageKey`) kalıcı bir booking kaydı VARSA, backend'den (`getBooking`) GÜNCEL
   * durumu sorar. Yalnızca HÂLÂ `PENDING` VE süresi DOLMAMIŞSA Adım 4'ten devam ettirilir (intake
   * adımı tekrar görülür — hangi ADIMDA kalındığı sunucuda AYRICA İZLENMEZ, Adım 4 her zaman
   * güvenli/tekrar-girilebilir bir yeniden giriş noktasıdır). Aksi HER durumda (ödenmiş/iptal/süresi
   * dolmuş/token geçersiz/ağ hatası) kalıcı kayıt SESSİZCE temizlenir ve Adım 2'den TEMİZ başlanır
   * — bu bir hata DEĞİLDİR, kullanıcıya AYRICA gösterilmez (aynı `resendBookingAccessLink`'in
   * "varlık sızdırılmaz" disiplini — geçersiz/eski bir token'a görünür bir hata İLE karşılık VERİLMEZ).
   */
  useEffect(() => {
    const stored = readPendingBooking(doctorSlug);
    // `recovering`'in lazy initializer'ı (`useState(() => readPendingBooking(...) !== null)`) BU
    // sorguyla AYNI sonucu ZATEN üretti — kayıt yoksa `recovering` baştan `false`'tur, burada
    // AYRICA `setState` ÇAĞRILMASINA gerek YOK (render sırasında set edilen state'i effect'te
    // TEKRAR set etmek gereksiz bir kademeli render'a yol açar).
    if (!stored) return;
    let cancelled = false;
    (async () => {
      try {
        const booking = await telehealthApi.getBooking(stored.bookingId, stored.accessToken);
        if (cancelled) return;
        const notExpired = new Date(booking.expiresAt).getTime() > Date.now();
        // Ücretsiz doktor bookingleri backend'de ANINDA `PAID` olur (Stripe akışının aksine bu
        // sayfadan HİÇ AYRILINMAZ) — sayfa bu adımda yenilenirse `PENDING` DEĞİL `PAID` bulunur,
        // yine de Adım 5'e (ödeme adımı atlanmış onay paneli) kurtarılabilir olmalıdır.
        if (booking.paymentStatus === "PENDING" && notExpired) {
          setBookingResult({
            bookingId: booking.id,
            accessToken: stored.accessToken,
            bookingNumber: booking.bookingNumber,
            slotCount: booking.slotCount,
            totalCents: booking.totalCents,
            currency: booking.currency,
            appointments: booking.appointments,
            paymentStatus: booking.paymentStatus,
          });
          setCurrentStep(4);
        } else if (booking.paymentStatus === "PAID" && booking.totalCents === 0) {
          setBookingResult({
            bookingId: booking.id,
            accessToken: stored.accessToken,
            bookingNumber: booking.bookingNumber,
            slotCount: booking.slotCount,
            totalCents: booking.totalCents,
            currency: booking.currency,
            appointments: booking.appointments,
            paymentStatus: booking.paymentStatus,
          });
          bookingFinalizedRef.current = true;
          setCurrentStep(5);
        } else {
          clearPendingBooking(doctorSlug);
        }
      } catch {
        if (!cancelled) clearPendingBooking(doctorSlug);
      } finally {
        if (!cancelled) setRecovering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnızca mount anında BİR KEZ çalışır (kalıcı depo/URL okuması, `doctorSlug` sayfa ömrü boyunca sabittir).
  }, []);

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
      persistPendingBooking(doctorSlug, { bookingId: result.bookingId, accessToken: result.accessToken });
      // Ücretsiz doktor (`totalCents === 0`) bookingi backend'de ANINDA `PAID` döner — terk-edilirse-
      // iptal-et temizleyicisi (yukarıdaki `useEffect`) bu booking'i YANLIŞLIKLA iptal etmesin diye
      // `bookingFinalizedRef` burada da (Stripe/demo ödeme BAŞLADIĞINDA İLE AYNI noktada) `true` olur.
      if (result.paymentStatus === "PAID") bookingFinalizedRef.current = true;
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

  // 2026-09-19 (GÖREV 2) — kalıcı bir booking kaydı bulunup backend'e sorulurken (`recovering`,
  // yalnızca böyle bir kayıt GERÇEKTEN varsa `true` — bkz. lazy initializer yorumu) Adım 2'nin
  // takvimini KISA SÜRELİĞİNE göstermek yerine (kurtarma başarılıysa saniyeler içinde Adım 4'e
  // atlanacağı için görsel olarak rahatsız edici bir "zıplama" olurdu) basit bir yükleniyor durumu
  // gösterilir.
  if (recovering) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

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

            {currentStep >= 4 && bookingResult && (() => {
              // Ücretsiz doktor (`sessionPriceCents === null`) bookingi backend'de ANINDA `PAID`
              // döner (bkz. `telehealth.routes.ts::POST /appointments/bookings`) — bu akışta ödeme
              // adımı hiç YOKTUR, Adım 5'te `BookingPaymentStep` yerine bir onay notu gösterilir.
              const isFreeBooking = bookingResult.paymentStatus === "PAID" && bookingResult.totalCents === 0;
              return (
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
                          {formatDayLabel(appointment.startsAt, displayTimeZone, intlLocale)} · {formatTime(appointment.startsAt, displayTimeZone, intlLocale)}
                        </span>
                      ))}
                    </div>
                    {isFreeBooking ? (
                      <p className="text-sm">
                        {bookingResult.slotCount} Slot · Bu randevu ücretsizdir, ödeme gerekmez. Randevunuz onaylandı ve görüşme bağlantınız
                        e-posta ile gönderildi.
                      </p>
                    ) : (
                      <>
                        <p className="text-sm">
                          {bookingResult.slotCount} Slot · Toplam {formatPriceFromCents(bookingResult.totalCents, bookingResult.currency, intlLocale)}. Bu
                          rezervasyon slotu <strong>30 dakika</strong> tutar; bu süre içinde ödemeyi tamamlamanız gerekir.
                        </p>
                        {/* 2026-09-18 KRİTİK DÜZELTME (kullanıcı talebi) — ödeme TAMAMLANMADAN hiçbir
                            e-posta GÖNDERİLMEMELİDİR: eskiden burada ödeme öncesi de çalışan bir
                            "Bağlantıyı e-posta ile gönder" butonu vardı (`resendBookingLink`), bu
                            gereksiz e-posta trafiği yarattığı için KALDIRILDI. Randevu bağlantısı
                            ARTIK YALNIZCA ödeme başarıyla tamamlandığında (webhook/demo ödeme) otomatik
                            olarak gönderilir (bkz. `backend/.../lib/notifications.ts
                            ::triggerAppointmentConfirmationEmail`) — burada yalnızca tarayıcıda not
                            alma/yer imi tavsiyesi kalır. */}
                        <p className="text-sm">
                          Randevunuzu daha sonra görüntülemek için bu bağlantıyı not alın veya yer imlerine ekleyin. Ödeme
                          onaylandığında görüşme bağlantınız otomatik olarak e-posta ile gönderilecektir.
                        </p>
                      </>
                    )}
                  </div>
                </Alert>

                {currentStep === 4 ? (
                  <BookingIntakeStep bookingId={bookingResult.bookingId} accessToken={bookingResult.accessToken} onDone={() => setCurrentStep(5)} />
                ) : isFreeBooking ? (
                  <Alert variant="success">
                    <p className="text-sm font-medium">Ödeme adımı gerekmiyor — randevunuz tamamlandı.</p>
                  </Alert>
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
                    onPaymentStarted={() => {
                      bookingFinalizedRef.current = true;
                    }}
                  />
                )}
              </div>
              );
            })()}
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
