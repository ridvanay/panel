"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CircleCheck, FileText, Loader2, Printer, StickyNote, Trash2 } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AppointmentBooking } from "@/lib/api/types";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BookingSummaryCard } from "@/components/site/telehealth/booking-summary-card";
import { BookingIntakeStep } from "@/components/site/telehealth/booking-intake-step";
import { BookingPaymentStep } from "@/components/site/telehealth/booking-payment-step";
import { DocumentUploader } from "@/components/site/telehealth/document-uploader";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.10 — `/{lang}/patient/bookings/{bookingId}`.
 * `?t=` ile misafir (magic-link) VEYA oturum sahibi hasta erişebilir; ikisi de AYNI bileşeni
 * kullanır (`assertBookingViewAccess`/`assertBookingPatientOnlyAccess` sunucuda ayrımı yapar,
 * frontend yalnızca token'ı VARSA taşır).
 *
 * **Ödeme dönüş sayfası aynı zamanda BU sayfadır** — Stripe Checkout'un `success_url`/`cancel_url`'i
 * integration-agent tarafından `.../checkout-session` içinde DOĞRUDAN
 * `/{lang}/patient/bookings/{bookingId}?payment=success|cancelled&t=...` olarak kurulmuştur (bkz.
 * `backend/src/modules/telehealth/telehealth.checkout.routes.ts::buildPatientReturnUrl`) — AYRI bir
 * `/appointments/bookings/{id}/payment-success` rotası İCAT EDİLMEZ, bu sayfa `?payment=` sorgu
 * parametresini okuyarak AYNI ekranda ödeme sonucunu gösterir.
 */
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 6;

export function PatientBookingDetailPanel({
  bookingId,
  accessToken,
  paymentOutcome,
}: {
  bookingId: string;
  accessToken?: string;
  /** `?payment=success|cancelled` — Stripe Checkout dönüşü, bkz. dosya başı yorumu. */
  paymentOutcome?: "success" | "cancelled";
}) {
  const localize = useLocalizePath();
  const [booking, setBooking] = useState<AppointmentBooking | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [addingIntake, setAddingIntake] = useState(false);
  const [intakeNote, setIntakeNote] = useState<string | null | undefined>(undefined);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [consultationNote, setConsultationNote] = useState<string | null | undefined>(undefined);
  const [consultationNoteError, setConsultationNoteError] = useState<string | null>(null);
  const [polling, setPolling] = useState(paymentOutcome === "success");
  const pollCountRef = useRef(0);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await telehealthApi.getBooking(bookingId, accessToken);
      setBooking(result);
      return result;
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
      return null;
    }
  }, [bookingId, accessToken]);

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnızca ilk mount'ta çalışır, `load()` referansı stabil (bkz. `useCallback`)
  }, []);

  // Stripe dönüşü `?payment=success` iken ödeme durumu webhook gecikmesiyle henüz `PAID`'e
  // geçmemiş olabilir — kısa bir yoklama (booking sayfasının GENEL polling gerekçesi, `qa-agent`ın
  // "toPass + reload" ilkesiyle AYNI ruh) uygulanır.
  useEffect(() => {
    if (paymentOutcome !== "success") return;
    let cancelled = false;
    const timer = setInterval(async () => {
      pollCountRef.current += 1;
      const next = await load();
      if (cancelled) return;
      if (!next || next.paymentStatus !== "PENDING" || pollCountRef.current >= MAX_POLLS) {
        setPolling(false);
        clearInterval(timer);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnızca `paymentOutcome` sabit kaldığı sürece bir kez kurulur
  }, [paymentOutcome]);

  async function handleCancel() {
    if (!booking) return;
    if (!window.confirm("Bu rezervasyonu iptal etmek istediğinizden emin misiniz?")) return;
    setCancelling(true);
    try {
      await telehealthApi.cancelBooking(booking.id, accessToken);
      await load();
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  }

  async function handleViewNote() {
    setIntakeError(null);
    try {
      const intake = await telehealthApi.getBookingIntake(bookingId, accessToken);
      setIntakeNote(intake.note);
    } catch (err) {
      setIntakeError(friendlyErrorMessage(err));
    }
  }

  async function handleViewConsultationNote() {
    setConsultationNoteError(null);
    try {
      const result = await telehealthApi.getConsultationNote(bookingId, accessToken);
      setConsultationNote(result.html);
    } catch (err) {
      setConsultationNoteError(friendlyErrorMessage(err));
    }
  }

  async function handleDeleteNote() {
    if (!window.confirm("Şikâyet notunuzu ve rızanızı silmek istediğinizden emin misiniz?")) return;
    try {
      await telehealthApi.deleteBookingIntake(bookingId, accessToken);
      setIntakeNote(null);
      await load();
    } catch (err) {
      setIntakeError(friendlyErrorMessage(err));
    }
  }

  if (booking === null && !loadError) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-56 w-full rounded-[var(--site-radius)]" />
      </div>
    );
  }

  if (loadError || !booking) {
    return (
      <Alert variant="error">
        <div className="space-y-2">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {loadError ?? "Bu rezervasyon bulunamadı ya da erişim bağlantınız geçersiz."}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
            {!accessToken && (
              <Link href={`/login?next=${encodeURIComponent(`/patient/bookings/${bookingId}`)}`} className="text-xs text-primary hover:underline">
                Giriş yap
              </Link>
            )}
          </div>
        </div>
      </Alert>
    );
  }

  const cancellable =
    booking.paymentStatus === "PENDING" ||
    (booking.paymentStatus === "PAID" && booking.appointments.some((a) => a.status === "SCHEDULED" || a.status === "IN_PROGRESS"));

  return (
    <div className="space-y-6">
      {paymentOutcome === "success" && booking.paymentStatus === "PAID" && (
        <Alert variant="success">
          <span className="flex items-center gap-2">
            <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            Ödemeniz alındı, randevunuz onaylandı.
          </span>
        </Alert>
      )}
      {paymentOutcome === "success" && polling && booking.paymentStatus === "PENDING" && (
        <Alert variant="info">
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            Ödemeniz onaylanıyor, lütfen birkaç saniye bekleyin…
          </span>
        </Alert>
      )}
      {paymentOutcome === "success" && !polling && booking.paymentStatus === "PENDING" && (
        <Alert variant="warning">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>Ödemeniz henüz onaylanmadı. Bu birkaç dakika sürebilir; sayfayı yenileyerek tekrar kontrol edebilirsiniz.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Yenile
            </Button>
          </span>
        </Alert>
      )}
      {paymentOutcome === "cancelled" && booking.paymentStatus === "PENDING" && (
        <Alert variant="warning">
          <span>Ödeme tamamlanmadı. Rezervasyonunuz slotu süresi dolana kadar tutuluyor — aşağıdan tekrar deneyebilirsiniz.</span>
        </Alert>
      )}
      {booking.paymentStatus === "EXPIRED" && (
        <Alert variant="error">
          <span>Bu rezervasyonun slot tutma süresi dolmuş. Yeni bir randevu oluşturmanız gerekiyor.</span>
        </Alert>
      )}
      {booking.paymentStatus === "FAILED" && (
        <Alert variant="error">
          <span>Ödeme girişimi başarısız oldu. Aşağıdan tekrar deneyebilirsiniz.</span>
        </Alert>
      )}

      <BookingSummaryCard booking={booking} accessToken={accessToken} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} />

      {(booking.paymentStatus === "PENDING" || booking.paymentStatus === "FAILED") && !polling && (
        <BookingPaymentStep bookingId={booking.id} accessToken={accessToken} totalCents={booking.totalCents} currency={booking.currency} />
      )}

      {cancellable && (
        <div>
          <Button type="button" variant="destructive" size="sm" loading={cancelling} onClick={() => void handleCancel()}>
            Rezervasyonu İptal Et
          </Button>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Tıbbi Belgeler ve Ön Bilgiler</h2>

        {intakeError && <Alert variant="error">{intakeError}</Alert>}

        {booking.hasIntakeNote ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-[var(--site-radius)] border border-border bg-muted/50 p-3">
              <span className="flex items-center gap-2 text-sm text-foreground">
                <FileText className="h-4 w-4 shrink-0 text-foreground/40" aria-hidden="true" />
                Kayıtlı bir şikâyet notunuz var.
              </span>
              <div className="flex items-center gap-2">
                {intakeNote === undefined && (
                  <button type="button" onClick={() => void handleViewNote()} className="text-xs font-medium text-primary hover:underline">
                    Görüntüle
                  </button>
                )}
                <button type="button" onClick={() => void handleDeleteNote()} className="text-foreground/40 hover:text-danger" aria-label="Notu ve rızayı sil">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            {intakeNote !== undefined && (
              <p className="rounded-[var(--site-radius)] border border-border bg-surface p-3 text-sm text-foreground/80 whitespace-pre-line">
                {intakeNote ?? "(Not girilmemiş — yalnızca belge paylaşılmış.)"}
              </p>
            )}
            <DocumentUploader bookingId={booking.id} accessToken={accessToken} />
          </div>
        ) : addingIntake ? (
          <BookingIntakeStep bookingId={booking.id} accessToken={accessToken} onDone={() => void load().then(() => setAddingIntake(false))} />
        ) : (
          <div className="rounded-[var(--site-radius)] border border-border bg-muted/50 p-4 text-sm text-foreground/60">
            <p>Bu rezervasyon için henüz paylaşılmış bir şikâyet notu/belge yok.</p>
            <button type="button" onClick={() => setAddingIntake(true)} className="mt-2 text-xs font-medium text-primary hover:underline">
              Ekle
            </button>
          </div>
        )}
      </section>

      {booking.hasConsultationNote && (
        <section className="space-y-3">
          <div className="flex items-center justify-between print:hidden">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <StickyNote className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              Doktor Notu / Reçete
            </h2>
            {consultationNote && (
              <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="h-4 w-4" aria-hidden="true" />
                Yazdır
              </Button>
            )}
          </div>

          {consultationNoteError && <Alert variant="error">{consultationNoteError}</Alert>}

          {/* Yazdırmada görünen antet — ekranda gizli */}
          <div className="hidden print:block print:mb-6">
            <div className="flex items-start justify-between border-b border-border pb-4">
              <div>
                <p className="text-base font-semibold text-foreground">
                  {booking.doctor.title} {booking.doctor.fullName}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-foreground/50">Hasta</p>
                <p className="text-sm font-medium text-foreground">{booking.patientName}</p>
              </div>
            </div>
          </div>

          {consultationNote === undefined ? (
            <button
              type="button"
              onClick={() => void handleViewConsultationNote()}
              className="text-xs font-medium text-primary hover:underline"
            >
              Görüntüle
            </button>
          ) : (
            <div className="rounded-[var(--site-radius)] border border-border bg-surface p-4">
              <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: consultationNote ?? "" }} />
            </div>
          )}
        </section>
      )}

      <p className="text-xs text-foreground/40">
        <Link href={localize("/patient/bookings")} className="hover:underline">
          ← Tüm randevularım
        </Link>
      </p>
    </div>
  );
}
