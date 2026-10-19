"use client";

import { useState } from "react";
import { Headphones } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { Appointment, QaListenerTokenResponse } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

export const QA_LISTENER_REASON_MIN = 10;
export const QA_LISTENER_REASON_MAX = 500;

interface QaListenerJoinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment | null;
  onJoined: (appointment: Appointment, session: QaListenerTokenResponse) => void;
}

/**
 * Paket C — "Dinleyici olarak katıl" onayı. Gerekçe zorunludur ve audit log'a yazılır. Katılım
 * hasta ve doktora ekranda AÇIKÇA bildirilir; gizli katılım seçeneği yoktur.
 * Çağıran `key={appointment?.id}` verir; her açılışta form temiz kurulur.
 */
export function QaListenerJoinDialog({ open, onOpenChange, appointment, onJoined }: QaListenerJoinDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const trimmed = reason.trim();
  const reasonValid = trimmed.length >= QA_LISTENER_REASON_MIN;

  function handleOpenChange(next: boolean) {
    if (!submitting) onOpenChange(next);
  }

  async function handleConfirm() {
    if (!appointment || !reasonValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const session = await telehealthApi.requestQaListenerToken(appointment.id, trimmed);
      setSubmitting(false);
      onJoined(appointment, session);
      onOpenChange(false);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
              <Headphones className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle>Dinleyici olarak katıl</DialogTitle>
              <DialogDescription className="mt-1">
                Kalite kontrol amacıyla görüşmeye yalnızca dinleyici olarak katılacaksınız: mikrofonunuz ve kameranız
                kullanılmaz. Hasta ve doktorun ekranında, siz ayrılana kadar &quot;Kalite kontrol amacıyla yetkili bir WM
                Health personeli bu görüşmeyi dinliyor.&quot; uyarısı gösterilir. Katılımınız, gerekçeniz ve giriş/çıkış
                zamanlarınız kayıt altına alınır.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <Field
            id="qa-listener-reason"
            label="Katılım gerekçesi"
            required
            hint={`Zorunlu — en az ${QA_LISTENER_REASON_MIN} karakter. Denetim kaydında saklanır; hasta adı, T.C. kimlik no veya tanı yazmayın (amaç yeterli).`}
          >
            {(inputProps) => (
              <Textarea
                {...inputProps}
                rows={3}
                maxLength={QA_LISTENER_REASON_MAX}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Vazgeç
          </Button>
          <Button type="button" variant="warning" loading={submitting} disabled={!reasonValid} onClick={() => void handleConfirm()}>
            Dinleyici olarak katıl
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
