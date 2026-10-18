"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { Appointment } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const dateTimeFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

interface CancelAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment | null;
  onCancelled: () => void | Promise<void>;
}

/**
 * Admin randevu iptali — `POST /appointments/{id}/cancel`, gerekçe opsiyonel (≤500 karakter).
 * Çağıran `key={appointment?.id}` verir; her açılışta form temiz state ile yeniden kurulur.
 */
export function CancelAppointmentDialog({ open, onOpenChange, appointment, onCancelled }: CancelAppointmentDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!submitting) onOpenChange(next);
  }

  async function handleConfirm() {
    if (!appointment) return;
    setSubmitting(true);
    setError(null);
    try {
      await telehealthApi.cancelAppointment(appointment.id, undefined, reason);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    toast.success("Randevu iptal edildi.");
    await onCancelled();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle>Randevuyu iptal et</DialogTitle>
              <DialogDescription className="mt-1">
                {appointment
                  ? `"${appointment.patientName}" için ${dateTimeFormatter.format(new Date(appointment.startsAt))} tarihli randevu iptal edilecek. Bu saat başka bir hastaya AÇILMAZ (slot kalıcı olarak kapalı kalır).`
                  : undefined}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <Field id="cancel-appointment-reason" label="İptal gerekçesi" hint="Opsiyonel — randevu kaydında saklanır.">
            {(inputProps) => (
              <Textarea {...inputProps} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            )}
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Vazgeç
          </Button>
          <Button type="button" variant="warning" loading={submitting} onClick={() => void handleConfirm()}>
            İptal Et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
