"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "@livekit/components-styles";
import { LiveKitRoom, RoomAudioRenderer, useConnectionState, useParticipants } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { Headphones, LogOut } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { Appointment, QaListenerTokenResponse } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isQaListenerParticipant } from "@/components/site/telehealth/qa-listener-notice";

/** `lib/livekit.ts::buildParticipantIdentity` — `patient:<id>` / `doctor:<id>`; PII içermez. */
export function describeParticipant(participant: { identity: string; metadata?: string }): string {
  if (isQaListenerParticipant(participant)) return "Kalite kontrol dinleyicisi";
  if (participant.identity.startsWith("doctor:")) return "Doktor";
  if (participant.identity.startsWith("patient:")) return "Hasta";
  return "Katılımcı";
}

function ListenerRoomStatus() {
  const state = useConnectionState();
  const participants = useParticipants().filter((p) => !p.isLocal);
  const connected = state === ConnectionState.Connected;

  return (
    <div className="space-y-2">
      <Badge tone={connected ? "success" : "warning"} size="sm">
        {connected ? "Bağlandı — yalnızca dinleme" : "Bağlanıyor…"}
      </Badge>
      {connected && (
        <ul className="space-y-1 text-sm text-foreground/70" aria-label="Odadaki katılımcılar">
          {participants.length === 0 ? (
            <li>Odada başka katılımcı yok.</li>
          ) : (
            participants.map((p) => <li key={p.identity}>{describeParticipant(p)}</li>)
          )}
        </ul>
      )}
    </div>
  );
}

interface QaListenerSessionPanelProps {
  appointment: Appointment;
  session: QaListenerTokenResponse;
  onEnded: () => void;
}

/**
 * Paket C — admin dinleme oturumu. YALNIZCA SES: `audio={false} video={false}` (admin hiçbir şey
 * yayınlamaz; token zaten yayın yetkisi taşımaz), uzak video ÇİZİLMEZ (veri minimizasyonu —
 * architect kararı), `adaptiveStream` görünmeyen video katmanlarını duraklatır.
 * Ayrılış (`leave`) üç yoldan biriyle TEK KEZ bildirilir: "Ayrıl" düğmesi, bağlantı kopması,
 * sayfadan çıkış (`pagehide`, keepalive). `meeting-token` ucu bu bileşende KULLANILMAZ.
 */
/** Paket G — sunucu tarafı azami dinleme süresi (backend `QA_LISTENER_MAX_SESSION_MS` ile aynı). */
export const QA_LISTENER_MAX_SESSION_MS = 60 * 60 * 1000;

export function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function QaListenerSessionPanel({ appointment, session, onEnded }: QaListenerSessionPanelProps) {
  const leftRef = useRef(false);
  // Kalan süre yalnızca bilgilendirme — asıl sınırı sunucu uygular (oturum açılış anından 60 dk).
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remainingMs = startedAt + QA_LISTENER_MAX_SESSION_MS - now;
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const reportLeave = useCallback(
    (options: { keepalive?: boolean } = {}) => {
      if (leftRef.current) return;
      leftRef.current = true;
      void telehealthApi.leaveQaListenerSession(appointment.id, session.sessionId, options);
    },
    [appointment.id, session.sessionId]
  );

  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // StrictMode'un geliştirmedeki sahte unmount/mount turu oturumu kapatmasın diye ayrılış bir
    // tik ertelenir; yeniden mount olursa iptal edilir.
    if (unmountTimerRef.current) clearTimeout(unmountTimerRef.current);
    const handlePageHide = () => reportLeave({ keepalive: true });
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      // Bileşen kaldırıldığında (ör. başka sayfaya geçiş) oturum da kapanır.
      unmountTimerRef.current = setTimeout(() => reportLeave(), 0);
    };
  }, [reportLeave]);

  function handleLeave() {
    reportLeave();
    onEnded();
  }

  return (
    <section
      aria-label="Dinleyici oturumu"
      className="space-y-3 rounded-[var(--site-radius)] border border-warning/40 bg-warning/5 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
            <Headphones className="h-4 w-4" />
          </span>
          <div>
            <h2 className="font-semibold text-foreground">Dinleyici oturumu açık</h2>
            <p className="text-sm text-foreground/60">
              {appointment.doctor.title} {appointment.doctor.fullName} · {appointment.patientName}. Hasta ve doktor ekranında
              dinlendiklerine dair uyarı görüyor.
            </p>
            <p className="mt-1 text-xs text-foreground/50">
              Oturum en fazla 60 dakika sürer; süre dolunca otomatik sonlanır. Kalan süre:{" "}
              <span className="font-mono tabular-nums">{formatRemaining(remainingMs)}</span>
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={handleLeave}>
          <LogOut className="h-3.5 w-3.5" />
          Ayrıl
        </Button>
      </div>

      {connectionError && <Alert variant="error">{connectionError}</Alert>}

      <LiveKitRoom
        token={session.token}
        serverUrl={session.serverUrl}
        connect
        audio={false}
        video={false}
        options={{ adaptiveStream: true }}
        onError={(err) => setConnectionError(err.message || "Görüşmeye bağlanılamadı.")}
        onDisconnected={handleLeave}
      >
        <RoomAudioRenderer />
        <ListenerRoomStatus />
      </LiveKitRoom>
    </section>
  );
}
