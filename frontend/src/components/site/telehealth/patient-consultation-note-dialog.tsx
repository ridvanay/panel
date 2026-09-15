"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AppointmentBooking } from "@/lib/api/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.8.4 KARAR O (son fıkra) — `/patient/prescriptions`
 * "Görüntüle" aksiyonu, `patient-booking-detail-panel.tsx`teki epikriz görüntüleme mantığının
 * (`getConsultationNote` + `dangerouslySetInnerHTML` prose render + yazdırma) BİREBİR AYNISI —
 * yalnızca o panelin tek-booking gövdesinden BAĞIMSIZ, tıklanabilir bir dialog'a taşınmış hali
 * (o bileşen YENİDEN YAZILMADI, mantık kopyalandı — §9.8.4'ün açıkça izin verdiği tek istisna).
 * İçerik yalnızca dialog AÇILDIĞINDA çekilir (fan-out yasağı, §9.8.4).
 */
export function PatientConsultationNoteDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: AppointmentBooking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Bu bileşen `noteBooking && <PatientConsultationNoteDialog .../>` deseniyle (`booking-documents-dialog.tsx`
  // çağıranlarındaki AYNI koşullu render deseni) yalnızca `open` iken mount edilir — kapanışta
  // tamamen UNMOUNT olur, bir sonraki açılışta state doğal olarak sıfırlanır (ayrı bir sıfırlama
  // efekti GEREKMEZ, `react-hooks/set-state-in-effect` uyarısını da doğar).
  const [note, setNote] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadNote() {
    setLoading(true);
    setError(null);
    try {
      const result = await telehealthApi.getConsultationNote(booking.id);
      setNote(result.html);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader className="print:hidden">
          <DialogTitle>Doktor Notu / Reçete</DialogTitle>
          <DialogDescription>
            {booking.doctor.title} {booking.doctor.fullName} tarafından oluşturulan konsültasyon notu.
          </DialogDescription>
        </DialogHeader>

        {error && <Alert variant="error">{error}</Alert>}

        {/* Yazdırmada görünen antet — `patient-booking-detail-panel.tsx` İLE AYNI desen, ekranda gizli. */}
        <div className="hidden print:block print:mb-6">
          <div className="flex items-start justify-between border-b border-border pb-4">
            <p className="text-base font-semibold text-foreground">
              {booking.doctor.title} {booking.doctor.fullName}
            </p>
            <div className="text-right">
              <p className="text-xs text-foreground/50">Hasta</p>
              <p className="text-sm font-medium text-foreground">{booking.patientName}</p>
            </div>
          </div>
        </div>

        {note === undefined ? (
          loading ? (
            <Skeleton className="h-40 w-full rounded-[var(--site-radius)]" />
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => void loadNote()}>
              Görüntüle
            </Button>
          )
        ) : (
          <>
            <div className="flex justify-end print:hidden">
              <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="h-4 w-4" aria-hidden="true" />
                Yazdır
              </Button>
            </div>
            <div className="rounded-[var(--site-radius)] border border-border bg-surface p-4">
              <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: note ?? "" }} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
