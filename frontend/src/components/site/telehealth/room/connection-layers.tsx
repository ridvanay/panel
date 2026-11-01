"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useConnectionState, useRoomContext } from "@livekit/components-react";
import { ConnectionState, RoomEvent, type Participant } from "livekit-client";
import { AlertTriangle, Loader2, MonitorSmartphone, SignalLow, UserX } from "lucide-react";
import { useConsultationStrings } from "@/lib/i18n/use-consultation-strings";
import { failureMessage } from "./connection-errors";
import { useParticipantLabeler } from "./label-context";
import { MAX_RECONNECT_ATTEMPTS, type AppReconnect } from "./use-app-reconnect";

/** `useConnectionState()` değişimini yeniden bağlanma makinesine bildirir (Connected → 60 sn hak yenileme zamanlayıcısı). */
export function ConnectionStateReporter({ reconnect }: { reconnect: AppReconnect }) {
  const state = useConnectionState();
  const { handleConnectionState } = reconnect;
  useEffect(() => {
    handleConnectionState(state === ConnectionState.Connected);
  }, [state, handleConnectionState]);
  return null;
}

type Counterpart = { isLocal: boolean; identity: string; metadata?: string };

/**
 * Paket AF (İş 4) — bağlantı durumu katmanları (görüşme ekranı arkada kalır):
 *  - "Bağlantı zayıf" bandı: yerel katılımcının kalitesi Poor/Lost iken (`ConnectionQualityChanged`),
 *  - "X bağlantıyı kaybetti, bekleniyor…": karşı taraf düşünce (`ParticipantDisconnected`), geri gelince kalkar,
 *  - "Yeniden bağlanılıyor…" yarı saydam katman: SDK yeniden bağlanması (`Reconnecting`/`SignalReconnecting` → `Reconnected`)
 *    ya da uygulama düzeyi deneme sürerken,
 *  - başarısızlık ve DUPLICATE_IDENTITY ekranları (açıklayıcı mesaj + düğme).
 * Oda/abonelik/yayın durumuna DOKUNMAZ; yalnızca olayları dinler.
 * Aşama 2: banner'lar üst-ortada (süre sayacının altında) durur — alttaki kontrol çubuğu, kayıt kontrolleri ve kendi
 * görüntü kutusu (varsayılan sağ-alt) ile çakışmaz.
 */
export function ConnectionLayers({
  reconnect,
  isCounterpart,
  topSlot,
}: {
  reconnect: AppReconnect;
  isCounterpart: (p: Counterpart) => boolean;
  /** Aşama 2: aynı üst-orta sütunda gösterilecek ek bilgi (ör. randevu bitişi uyarısı) — banner'larla çakışmasın. */
  topSlot?: ReactNode;
}) {
  const { t, fmt } = useConsultationStrings();
  const room = useRoomContext();
  const labeler = useParticipantLabeler();
  const [sdkReconnecting, setSdkReconnecting] = useState(false);
  const [weak, setWeak] = useState(false);
  const [lost, setLost] = useState<{ identity: string; name: string } | null>(null);

  useEffect(() => {
    const onReconnecting = () => setSdkReconnecting(true);
    const onReconnected = () => {
      setSdkReconnecting(false);
      setWeak(false);
    };
    const onQuality = (quality: unknown, participant: Participant) => {
      if (!participant?.isLocal) return;
      const q = String(quality);
      setWeak(q === "poor" || q === "lost");
    };
    const onLeft = (participant: Participant) => {
      if (!isCounterpart(participant)) return;
      setLost({ identity: participant.identity, name: labeler(participant) ?? "" });
    };
    const onJoined = (participant: Participant) => {
      if (!isCounterpart(participant)) return;
      setLost((prev) => (prev && prev.identity === participant.identity ? null : prev));
    };
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.SignalReconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.ConnectionQualityChanged, onQuality);
    room.on(RoomEvent.ParticipantDisconnected, onLeft);
    room.on(RoomEvent.ParticipantConnected, onJoined);
    return () => {
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.SignalReconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.ConnectionQualityChanged, onQuality);
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
      room.off(RoomEvent.ParticipantConnected, onJoined);
    };
  }, [room, isCounterpart, labeler]);

  const { phase } = reconnect;
  const recovering = phase.status === "waiting" || phase.status === "fetching";
  const showBanners = !sdkReconnecting && !recovering && phase.status === "idle";

  return (
    <>
      {(topSlot || (showBanners && (weak || lost))) && (
        <div className="pointer-events-none absolute inset-x-3 top-14 z-20 flex flex-col items-center gap-2">
          {topSlot}
          {showBanners && weak && (
            <div role="status" aria-live="polite" data-testid="weak-connection-banner" className="flex max-w-md items-center gap-2 rounded-[var(--site-radius)] bg-warning px-3 py-2 text-sm font-medium text-warning-foreground shadow-lg">
              <SignalLow className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t.weakConnection}
            </div>
          )}
          {showBanners && lost && (
            <div role="status" aria-live="polite" data-testid="participant-lost-banner" className="flex max-w-md items-center gap-2 rounded-[var(--site-radius)] bg-black/75 px-3 py-2 text-sm font-medium text-white shadow-lg">
              <UserX className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{fmt(t.participantLost, { name: lost.name })}</span>
            </div>
          )}
        </div>
      )}

      {(sdkReconnecting || recovering) && phase.status !== "failed" && phase.status !== "duplicate" && (
        <div
          role="status"
          aria-live="polite"
          data-testid="reconnecting-overlay"
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-6 text-center text-white backdrop-blur-sm"
        >
          <div className="flex max-w-sm flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
            <p className="text-lg font-semibold">{t.reconnectingTitle}</p>
            <p className="text-sm text-white/80">{t.reconnectingBody}</p>
            {(phase.status === "waiting" || phase.status === "fetching") && phase.attempt > 0 && (
              <p className="text-xs text-white/70" data-testid="reconnect-attempt">
                {fmt(t.reconnectAttempt, { current: phase.attempt, max: MAX_RECONNECT_ATTEMPTS })}
              </p>
            )}
          </div>
        </div>
      )}

      {phase.status === "failed" && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="reconnect-failed-title"
          data-testid="reconnect-failed"
          className="absolute inset-0 z-40 flex items-center justify-center bg-[#0F172A]/95 p-6 text-center text-white"
        >
          <div className="flex max-w-md flex-col items-center gap-4">
            <AlertTriangle className="h-8 w-8 text-warning" aria-hidden="true" />
            <h2 id="reconnect-failed-title" className="text-lg font-semibold">
              {t.reconnectFailedTitle}
            </h2>
            <p className="text-sm text-white/80" data-testid="reconnect-failed-message">
              {failureMessage(phase.kind, t)}
            </p>
            <button
              type="button"
              onClick={reconnect.retry}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-slate-900 hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {t.reconnectButton}
            </button>
          </div>
        </div>
      )}

      {phase.status === "duplicate" && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="duplicate-title"
          data-testid="duplicate-identity"
          className="absolute inset-0 z-40 flex items-center justify-center bg-[#0F172A]/95 p-6 text-center text-white"
        >
          <div className="flex max-w-md flex-col items-center gap-4">
            <MonitorSmartphone className="h-8 w-8 text-warning" aria-hidden="true" />
            <h2 id="duplicate-title" className="text-lg font-semibold">
              {t.duplicateTitle}
            </h2>
            <p className="text-sm text-white/80">{t.duplicateBody}</p>
            <button
              type="button"
              onClick={reconnect.takeOver}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-slate-900 hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {t.duplicateContinue}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
