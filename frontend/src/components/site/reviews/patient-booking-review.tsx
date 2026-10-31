"use client";

import { useEffect, useState } from "react";
import * as reviewsApi from "@/lib/api/reviews";
import type { PatientBookingReviewState, PatientReviewStatus, SubmitReviewRequest } from "@/lib/api/types";
import { fillReview, useReviewStrings } from "@/lib/i18n/use-review-strings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ReviewForm } from "@/components/site/reviews/review-form";
import { StarRating } from "@/components/site/reviews/star-rating";

/**
 * Paket Y — hasta portalında tamamlanmış randevunun altındaki yorum alanı. `GET /patient/bookings/:id/review`
 * `eligible` ise aynı form; yorum varsa durumu ve "Yorumumu sil" (onay diyaloğu). Uç hata verirse
 * (ör. oturumsuz magic-link erişimi) bileşen sessizce hiçbir şey göstermez.
 */
export function PatientBookingReview({ bookingId }: { bookingId: string }) {
  const { t } = useReviewStrings();
  const [state, setState] = useState<PatientBookingReviewState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    reviewsApi
      .getPatientBookingReview(bookingId)
      .then((result) => !cancelled && setState(result))
      .catch(() => !cancelled && setState(null));
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  async function handleDelete() {
    if (!state?.review) return;
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await reviewsApi.deletePatientReview(state.review.id);
      setDeleted(true);
      setConfirmOpen(false);
      setState({ eligible: false, review: null });
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleting(false);
    }
  }

  if (deleted) {
    return (
      <Alert variant="success" className="mt-6">
        {t.deleteDone}
      </Alert>
    );
  }
  if (!state) return null;

  const statusText: Record<PatientReviewStatus, string> = {
    pending: t.portalReviewPending,
    approved: t.portalReviewApproved,
    rejected: t.portalReviewRejected,
    hidden: t.portalReviewHidden,
  };

  if (state.review) {
    return (
      <section aria-labelledby="patient-review-heading" className="rounded-[var(--site-radius)] border border-border bg-surface p-4 sm:p-5">
        <h2 id="patient-review-heading" className="text-base font-semibold text-foreground">
          {t.formTitle}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <StarRating rating={state.review.rating} label={fillReview(t.portalYourRating, { rating: state.review.rating })} />
          <span className="text-sm font-medium text-foreground">{state.review.title}</span>
        </div>
        <p className="mt-2 text-sm text-foreground/70">{statusText[state.review.status]}</p>
        {deleteFailed && (
          <Alert variant="error" className="mt-3">
            {t.errGeneric}
          </Alert>
        )}
        <Button type="button" variant="destructive" size="sm" className="mt-4" onClick={() => setConfirmOpen(true)}>
          {t.deleteMyReview}
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t.deleteConfirmTitle}
          description={t.deleteConfirmBody}
          confirmText={t.deleteConfirm}
          cancelText={t.deleteCancel}
          tone="danger"
          loading={deleting}
          onConfirm={() => void handleDelete()}
        />
      </section>
    );
  }

  if (!state.eligible) return null;

  return (
    <section aria-labelledby="patient-review-heading" className="rounded-[var(--site-radius)] border border-border bg-surface p-4 sm:p-6">
      <h2 id="patient-review-heading" className="sr-only">
        {t.formTitle}
      </h2>
      {/* Başarıda form kendi teşekkür ekranını gösterir; durum/silme görünümü sayfa yenilenince gelir. */}
      <ReviewForm submit={(input: SubmitReviewRequest) => reviewsApi.submitPatientBookingReview(bookingId, input)} />
    </section>
  );
}
