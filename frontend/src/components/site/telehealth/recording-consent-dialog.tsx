"use client";

import { useEffect, useState } from "react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { ConsultationRecording } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
const CONSENT_TEXT =
  "Doktorunuz bu görüşmeyi kaydetmek istiyor. Kayıt sunucuda AES-256 ile şifrelenerek saklanır, 30 gün sonra otomatik silinir ve yalnızca siz, doktorunuz ve sistem yöneticisi erişebilir. Reddetme hakkınız vardır; reddetmeniz görüşmeyi etkilemez.";

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
          <DialogTitle>Görüşme Kaydı İzni</DialogTitle>
          <DialogDescription>{CONSENT_TEXT}</DialogDescription>
        </DialogHeader>

        {error && <Alert variant="error">{error}</Alert>}

        <p className="text-center text-xs font-medium tabular-nums text-foreground/50" aria-live="polite">
          {remainingSeconds > 0 ? `${remainingSeconds}sn içinde otomatik olarak kapanacak` : "Süre doldu"}
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
            Reddediyorum
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            loading={submitting === "accept"}
            disabled={submitting !== null}
            onClick={() => void respond(true)}
          >
            Kabul Ediyorum
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
