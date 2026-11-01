"use client";

import { useEffect, useState } from "react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { ConsultationRecording } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConsultationStrings } from "@/lib/i18n/use-consultation-strings";

/**
 * `.claude/architect-scope-telehealth-recording.md` F1 — hasta rıza modalı. Metin compliance-agent'ın
 * bağlayıcı kararıdır, AYNEN kullanılır (değiştirilmez). "E2EE"/"uçtan uca şifreli" YOKTUR — doğru
 * terim "sunucuda (at-rest) AES-256 şifreleme"dir.
 *
 * İki buton EŞİT görsel ağırlıkta — hiçbiri varsayılan odaklı/vurgulu/"önerilen" DEĞİLDİR (`outline`
 * varyantı ikisinde de AYNI). Modalı kapatmak (X/escape/dışına tıklama) KARAR VERİLMEDİ sayılır —
 * `onOpenChange(false)` HİÇBİR istek GÖNDERMEZ, yalnızca `onDismiss()`'i çağırır; TTL
 * (`consentExpiresAt`) kendiliğinden dolar.
 */
// Paket AF — rıza metni `consultation` sözlüğüne taşındı (`recConsentText`); TR metin AYNEN korunur, diğer diller
// hukuki gözden geçirmeye tabidir (bkz. AF raporu).

interface RecordingConsentDialogProps {
  open: boolean;
  appointmentId: string;
  accessToken?: string;
  consentExpiresAt: string;
  onResolved: (recording: ConsultationRecording) => void;
  onDismiss: () => void;
}

/** `useJoinState` (`consultation-room.tsx`) İLE AYNI desen — "kalan süre" bir `setState` yerine bir saniyelik "şimdi" ticker'ından TÜRETİLİR. */
function useRemainingSeconds(targetIso: string, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  return Math.max(0, Math.round((new Date(targetIso).getTime() - now) / 1000));
}

export function RecordingConsentDialog({
  open,
  appointmentId,
  accessToken,
  consentExpiresAt,
  onResolved,
  onDismiss,
}: RecordingConsentDialogProps) {
  const { t, fmt } = useConsultationStrings();
  const remainingSeconds = useRemainingSeconds(consentExpiresAt, open);
  const [submitting, setSubmitting] = useState<"accept" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // TTL kendiliğinden dolduğunda — karar verilmedi sayılır, hiçbir istek gönderilmeden kapatılır.
  useEffect(() => {
    if (open && remainingSeconds <= 0) {
      onDismiss();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnızca süre 0'a ulaştığında tetiklenmeli
  }, [open, remainingSeconds]);

  async function respond(granted: boolean) {
    setSubmitting(granted ? "accept" : "deny");
    setError(null);
    try {
      const recording = await telehealthApi.submitRecordingConsent(appointmentId, granted, accessToken);
      onResolved(recording);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.recConsentTitle}</DialogTitle>
          <DialogDescription>{t.recConsentText}</DialogDescription>
        </DialogHeader>

        {error && <Alert variant="error">{error}</Alert>}

        <p className="text-center text-xs font-medium tabular-nums text-foreground/50" aria-live="polite">
          {remainingSeconds > 0 ? fmt(t.recConsentCountdown, { seconds: remainingSeconds }) : t.recConsentExpired}
        </p>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            loading={submitting === "deny"}
            disabled={submitting !== null}
            onClick={() => void respond(false)}
          >
            {t.recDeny}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            loading={submitting === "accept"}
            disabled={submitting !== null}
            onClick={() => void respond(true)}
          >
            {t.recAccept}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
