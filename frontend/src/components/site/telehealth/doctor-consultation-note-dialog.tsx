"use client";

import { useEffect, useState } from "react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { AppointmentBooking } from "@/lib/api/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConsultationNoteEditor } from "@/components/site/telehealth/consultation-note-editor";

/**
 * `.claude/design-notes-doctor-portfolio-console.md` §3.4.4 — "Konsültasyon Notu Ekle" butonu,
 * mevcut Tiptap tabanlı `ConsultationNoteEditor`'ı bir `Dialog` içinde açar. [DPI] §3.3 gereği
 * YENİ bir not-yazma ucu İCAT EDİLMEZ — okuma `GET .../consultation-note`, yazma
 * `POST /appointments/{id}/complete` (`booking-list-view.tsx`'in "Seansı Tamamla" mini-modalıyla
 * AYNI iki uç, `telehealth.livekit.routes.ts`'in idempotency notu: randevu zaten `COMPLETED`
 * iken bu uç yeniden çağrılırsa yalnızca not güncellenir, `endedAt` KAYMAZ).
 */
interface DoctorConsultationNoteDialogProps {
  booking: Pick<AppointmentBooking, "id" | "patientName" | "appointments">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function DoctorConsultationNoteDialog({ booking, open, onOpenChange, onSaved }: DoctorConsultationNoteDialogProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const firstAppointment = booking.appointments[0];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open) return;
      if (!cancelled) {
        setContent(null);
        setLoadError(null);
        setSaveError(null);
      }
      try {
        const note = await telehealthApi.getConsultationNote(booking.id);
        if (!cancelled) setContent(note.html ?? "");
      } catch (err) {
        if (!cancelled) setLoadError(friendlyErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, booking.id]);

  async function handleSave() {
    if (!firstAppointment || content === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      await telehealthApi.completeAppointment(firstAppointment.id, undefined, content);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setSaveError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Konsültasyon Notu Ekle</DialogTitle>
          <DialogDescription>{booking.patientName} için epikriz/reçete notu.</DialogDescription>
        </DialogHeader>

        {loadError && <Alert variant="error">{loadError}</Alert>}
        {saveError && <Alert variant="error">{saveError}</Alert>}

        {content === null && !loadError ? (
          <Skeleton className="h-60 w-full rounded-[var(--site-radius)]" />
        ) : (
          <ConsultationNoteEditor content={content ?? ""} onChange={setContent} />
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button type="button" loading={saving} disabled={content === null} onClick={() => void handleSave()}>
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
