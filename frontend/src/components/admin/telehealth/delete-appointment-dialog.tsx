"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { Appointment, AppointmentDeletionCheck } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const dateTimeFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

/** İkinci onay adımında yazılması gereken ifade. */
export const DELETE_CONFIRMATION_PHRASE = "SİL";

interface DeleteAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment | null;
  onDeleted: () => void | Promise<void>;
}

type Step = "check" | "confirm";

/**
 * Test randevusunu kalıcı silme (YALNIZCA ADMIN). Adım 1: sunucudan uygunluk sorgulanır, engel
 * varsa nedenleri listelenir ve silme sunulmaz. Adım 2: "SİL" yazılınca kalıcı silme butonu açılır.
 * Çağıran `key={appointment?.id}` verir; her açılışta adımlar temiz state ile yeniden kurulur.
 */
export function DeleteAppointmentDialog({ open, onOpenChange, appointment, onDeleted }: DeleteAppointmentDialogProps) {
  const [step, setStep] = useState<Step>("check");
  const [check, setCheck] = useState<AppointmentDeletionCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open || !appointment) return;
    let cancelled = false;
    telehealthApi
      .getAppointmentDeletionCheck(appointment.id)
      .then((result) => {
        if (!cancelled) setCheck(result);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, appointment]);

  function handleOpenChange(next: boolean) {
    if (!deleting) onOpenChange(next);
  }

  async function handleDelete() {
    if (!appointment) return;
    setDeleting(true);
    setError(null);
    try {
      await telehealthApi.deleteAppointment(appointment.id);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      setDeleting(false);
      return;
    }
    setDeleting(false);
    toast.success("Randevu kalıcı olarak silindi.");
    await onDeleted();
    onOpenChange(false);
  }

  const phraseMatches = phrase.trim().toLocaleUpperCase("tr-TR") === DELETE_CONFIRMATION_PHRASE;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <Trash2 className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle>Randevuyu kalıcı olarak sil</DialogTitle>
              <DialogDescription className="mt-1">
                {appointment
                  ? `"${appointment.patientName}" — ${dateTimeFormatter.format(new Date(appointment.startsAt))}. Yalnızca ödeme, not, kayıt veya sağlık verisi olmayan test randevuları silinebilir. Bu işlem geri alınamaz.`
                  : undefined}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}

          {!check && !error && (
            <div className="flex justify-center py-4">
              <Spinner className="h-5 w-5 text-primary" />
            </div>
          )}

          {check && !check.deletable && (
            <Alert variant="warning">
              <p className="font-medium">Bu randevu silinemez:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5" data-testid="deletion-blockers">
                {check.blockers.map((blocker) => (
                  <li key={blocker.code}>{blocker.message}</li>
                ))}
              </ul>
            </Alert>
          )}

          {check?.deletable && step === "check" && (
            <Alert variant="info">Silme engeli bulunmadı. Devam ederseniz son bir onay istenecek.</Alert>
          )}

          {check?.deletable && step === "confirm" && (
            <Field
              id="delete-appointment-confirmation"
              label={`Onaylamak için "${DELETE_CONFIRMATION_PHRASE}" yazın`}
              hint="Silme işlemi denetim kaydına (audit log) yazılır."
            >
              {(inputProps) => <Input {...inputProps} autoComplete="off" value={phrase} onChange={(e) => setPhrase(e.target.value)} />}
            </Field>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={deleting}>
            {check && !check.deletable ? "Kapat" : "Vazgeç"}
          </Button>
          {check?.deletable && step === "check" && (
            <Button type="button" variant="destructive" onClick={() => setStep("confirm")}>
              Devam Et
            </Button>
          )}
          {check?.deletable && step === "confirm" && (
            <Button type="button" variant="destructive" loading={deleting} disabled={!phraseMatches} onClick={() => void handleDelete()}>
              Kalıcı Olarak Sil
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
