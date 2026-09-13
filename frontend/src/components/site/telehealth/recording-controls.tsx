"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Video, VideoOff } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { ConsultationRecording } from "@/lib/api/types";
import { Button } from "@/components/ui/button";

/** Hasta reddettikten sonra "Kaydı Başlat" tekrar etkinleşene kadar geçmesi gereken süre. */
const CONSENT_RETRY_LOCK_MS = 60_000;

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

interface RecordingControlsProps {
  appointmentId: string;
  /** `null` = bu randevu için henüz hiç kayıt talebi oluşmamış — "Kaydı Başlat" durumuyla AYNI ele alınır. */
  recording: ConsultationRecording | null;
  onUpdate: (recording: ConsultationRecording) => void;
}

/**
 * `.claude/architect-scope-telehealth-recording.md` F3 — YALNIZCA doktora gösterilir
 * (`consultation-room.tsx` bu koşulu zaten uygular). Durum bazlı TEK aksiyon alanı.
 */
export function RecordingControls({ appointmentId, recording, onUpdate }: RecordingControlsProps) {
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifiedDenialRef = useRef<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Hasta reddettiğinde NÖTR bir bildirim — ISRARCI/SUÇLAYICI dil YASAK, her red anı için BİR KEZ
  // (`patientConsentDeniedAt` anahtarıyla, aynı red tekrar tekrar bildirim ÜRETMEZ).
  useEffect(() => {
    if (
      recording?.status === "CONSENT_DENIED" &&
      recording.patientConsentDeniedAt &&
      notifiedDenialRef.current !== recording.patientConsentDeniedAt
    ) {
      notifiedDenialRef.current = recording.patientConsentDeniedAt;
      toast("Hasta kaydı onaylamadı; görüşme kayıtsız devam ediyor.");
    }
  }, [recording?.status, recording?.patientConsentDeniedAt]);

  async function handleStart() {
    setPending(true);
    setError(null);
    try {
      onUpdate(await telehealthApi.startRecording(appointmentId));
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function handleStop() {
    setPending(true);
    setError(null);
    try {
      onUpdate(await telehealthApi.stopRecording(appointmentId));
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  const status = recording?.status;
  let content: ReactNode;

  if (status === "PENDING_CONSENT") {
    content = (
      <Button type="button" variant="outline" size="sm" loading>
        Hastanın onayı bekleniyor…
      </Button>
    );
  } else if (status === "RECORDING") {
    const startedAtMs = recording?.startedAt ? new Date(recording.startedAt).getTime() : null;
    content = (
      <div className="flex items-center gap-2">
        {startedAtMs !== null && (
          <span className="text-xs font-medium tabular-nums text-white/80">{formatDuration(now - startedAtMs)}</span>
        )}
        <Button type="button" variant="destructive" size="sm" loading={pending} onClick={() => void handleStop()}>
          <VideoOff className="h-3.5 w-3.5" aria-hidden="true" />
          Kaydı Durdur
        </Button>
      </div>
    );
  } else if (status === "PROCESSING") {
    content = (
      <Button type="button" variant="outline" size="sm" loading>
        Kayıt işleniyor…
      </Button>
    );
  } else {
    // Kayıt yok / `CONSENT_DENIED` / `FAILED` / `COMPLETED` — bu randevu için henüz aktif kayıt yok.
    const deniedAtMs =
      status === "CONSENT_DENIED" && recording?.patientConsentDeniedAt ? new Date(recording.patientConsentDeniedAt).getTime() : null;
    const lockRemainingMs = deniedAtMs !== null ? deniedAtMs + CONSENT_RETRY_LOCK_MS - now : 0;
    const locked = lockRemainingMs > 0;

    content = locked ? (
      <Button type="button" variant="outline" size="sm" disabled>
        Reddedildi, {Math.ceil(lockRemainingMs / 1000)}sn sonra tekrar deneyebilirsiniz
      </Button>
    ) : (
      <Button type="button" variant="outline" size="sm" loading={pending} onClick={() => void handleStart()}>
        <Video className="h-3.5 w-3.5" aria-hidden="true" />
        Kaydı Başlat
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1.5 rounded-[var(--site-radius)] bg-black/60 p-2 backdrop-blur-md">
      {content}
      {error && <p className="max-w-[220px] text-xs text-danger">{error}</p>}
    </div>
  );
}
