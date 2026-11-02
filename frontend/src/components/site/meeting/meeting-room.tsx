"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import "@livekit/components-styles";
import { LiveKitRoom, RoomAudioRenderer, useRoomContext } from "@livekit/components-react";
import { DisconnectReason } from "livekit-client";
import { X } from "lucide-react";
import type { MeetingTokenResponse } from "@/lib/api/types";
import { fmt as fmtConsultation, useConsultationStrings } from "@/lib/i18n/use-consultation-strings";
import { fmt, useMeetingStrings } from "@/lib/i18n/use-meeting-strings";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ParticipantLabelProvider } from "@/components/site/telehealth/room/label-context";
import type { LabelContext } from "@/components/site/telehealth/room/participant-label";
import { ConnectionLayers, ConnectionStateReporter } from "@/components/site/telehealth/room/connection-layers";
import { useAppReconnect } from "@/components/site/telehealth/room/use-app-reconnect";
import { disconnectKind } from "@/components/site/telehealth/room/disconnect-kind";
import { classifyConnectionError, classifyMediaFailure, failureMessage, warnRaw } from "@/components/site/telehealth/room/connection-errors";
import { RoomUiProvider } from "@/components/site/telehealth/room/room-ui-context";
import { SessionTimer, ENDING_SOON_MS } from "@/components/site/telehealth/room/session-timer";
import { DeviceBootstrap } from "@/components/site/telehealth/room/device-bootstrap";
import { RoomControlBar } from "@/components/site/telehealth/room/control-bar";
import { buildCaptureOptions, loadPrefs } from "@/components/site/telehealth/room/device-prefs";
import { MeetingStage } from "./meeting-stage";
import { MeetingGuestControlBar } from "./meeting-guest-control-bar";

/**
 * Paket AG İş 3 — toplantı odası kabuğu (`<LiveKitRoom>`), ev sahibi ve misafir modları için ORTAK. AF oda bileşenlerini
 * yeniden kullanır (ad etiketleri, bağlantı katmanları, uygulama içi yeniden bağlanma, cihaz tercihleri, süre sayacı);
 * `consultation-room.tsx`, `room/stage.tsx` ve `room/control-bar.tsx` DEĞİŞMEZ. Kayıt, tercüman ve dinleyici bileşenleri
 * içe aktarılmaz — toplantılar kaydedilmez. Ekran paylaşımı yalnızca ev sahibinin çubuğundadır.
 */

export type MeetingExitReason = "left" | "removed" | "ended" | "failed";

export interface MeetingRoomProps {
  mode: "host" | "guest";
  initialToken: MeetingTokenResponse;
  /** Yeniden bağlanma için taze token (ev sahibi: `host-token`; misafir: aynı `guestSession` ile `join`). */
  fetchToken: () => Promise<MeetingTokenResponse>;
  /** Toplantı bitiş zamanı (ISO) — süre uyarısı ve "çıkarıldı / sona erdi" ayrımı için. */
  endsAt: string;
  /** Oda terminal bir nedenle kapandı; `detail` yalnızca `failed` için çevrilmiş mesajdır. */
  onExit: (reason: MeetingExitReason, detail?: string) => void;
}

/** Karşı taraf = yerel olmayan herkes. Modül düzeyinde (sabit referans). */
function isRemote(p: { isLocal: boolean }): boolean {
  return !p.isLocal;
}

/** Bitişe ≤ 5 dk kala kapatılabilir bilgi uyarısı. Metin toplantıya özgüdür (görüşme uyarısı "kesilmez" der; burada herkes çıkarılır). */
function MeetingEndingNotice({ endsAt }: { endsAt: string }) {
  const { t } = useMeetingStrings();
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const end = new Date(endsAt).getTime();
  const remaining = end - now;
  if (dismissed || Number.isNaN(end) || remaining <= 0 || remaining > ENDING_SOON_MS) return null;
  const minutes = Math.max(1, Math.ceil(remaining / 60_000));
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="meeting-ending-soon"
      className="pointer-events-auto flex max-w-md items-center gap-2 rounded-[var(--site-radius)] bg-black/75 py-1 ps-3 pe-1 text-sm font-medium text-white shadow-lg backdrop-blur-md"
    >
      <span className="min-w-0 flex-1">{fmt(t.endingSoon, { minutes })}</span>
      <button
        type="button"
        aria-label={t.dialogCancel}
        onClick={() => setDismissed(true)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/80 hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Ev sahibi: AF `RoomControlBar` (ekran paylaşımı dahil) + ayrılma onayı. */
function HostControls({ stageRef }: { stageRef: RefObject<HTMLDivElement | null> }) {
  const { t } = useMeetingStrings();
  const room = useRoomContext();
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <RoomControlBar stageRef={stageRef} onEndCall={() => setConfirmOpen(true)} />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t.leaveAria}
        confirmText={t.leave}
        cancelText={t.dialogCancel}
        tone="warning"
        onConfirm={() => {
          setConfirmOpen(false);
          void room.disconnect();
        }}
      />
    </>
  );
}

export function MeetingRoom({ mode, initialToken, fetchToken, endsAt, onExit }: MeetingRoomProps) {
  const { t: ct } = useConsultationStrings();
  const { t } = useMeetingStrings();
  const [token, setToken] = useState<MeetingTokenResponse>(initialToken);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [mediaMessage, setMediaMessage] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const reconnect = useAppReconnect<MeetingTokenResponse>({
    fetchToken,
    onToken: setToken,
    // Odadan çıkarılma / oda kapanması bitiştir; yeniden bağlanılmaz.
    isTerminalReason: (reason) =>
      reason !== undefined &&
      (reason === DisconnectReason.PARTICIPANT_REMOVED || reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.ROOM_CLOSED),
  });
  const resetReconnect = reconnect.reset;

  // Etiket bağlamı: toplantıda hasta/doktor kavramı yok; `meet-host:`/`meet-guest:` etiketi token `name`'inden gelir.
  const labelContext = useMemo<LabelContext>(() => ({ viewer: "patient", t: ct, fmt: fmtConsultation }), [ct]);

  function handleDisconnected(reason?: DisconnectReason) {
    const outcome = reconnect.handleDisconnected(disconnectKind(reason), reason as number | undefined);
    if (outcome === "terminal") {
      const past = Date.now() >= new Date(endsAt).getTime();
      onExit(reason === DisconnectReason.PARTICIPANT_REMOVED && !past ? "removed" : "ended");
    } else if (outcome === "user-left") {
      onExit("left");
    }
  }

  function handleConnectionError(err: unknown) {
    warnRaw("meeting LiveKitRoom onError", err);
    if (reconnect.handleConnectFailure(err)) return;
    resetReconnect();
    onExit("failed", failureMessage(classifyConnectionError(err), ct));
  }

  // Kamera/mikrofon hatası odayı kapatmaz (dinleyerek katılmaya devam edilebilir); odada kapatılabilir uyarı olarak gösterilir.
  function handleMediaFailure(failure?: string) {
    warnRaw("meeting LiveKitRoom onMediaDeviceFailure", failure);
    setMediaMessage(failureMessage(classifyMediaFailure(failure), ct));
  }

  // Kararlı geri çağrılar (bkz. consultation-room.tsx): her render'da yeni kimlik eski token ile yeniden `connect()` çağırırdı.
  const latest = useRef({ handleDisconnected, handleConnectionError, handleMediaFailure });
  useEffect(() => {
    latest.current = { handleDisconnected, handleConnectionError, handleMediaFailure };
  });
  const stableDisconnected = useCallback((reason?: DisconnectReason) => latest.current.handleDisconnected(reason), []);
  const stableError = useCallback((err: unknown) => latest.current.handleConnectionError(err), []);
  const stableMediaFailure = useCallback((failure?: string) => latest.current.handleMediaFailure(failure), []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- bilinçli: yeni token (yeniden kurulum) = tercihler yeniden okunur
  const capture = useMemo(() => buildCaptureOptions(loadPrefs()), [token.token]);

  return (
    <ParticipantLabelProvider value={labelContext}>
      <RoomUiProvider>
        <LiveKitRoom
          key={token.token}
          ref={stageRef}
          token={token.token}
          serverUrl={token.serverUrl}
          video={capture.video}
          audio={capture.audio}
          connect
          options={{ adaptiveStream: true, dynacast: true }}
          onDisconnected={stableDisconnected}
          onError={stableError}
          onMediaDeviceFailure={stableMediaFailure}
          data-testid="meeting-room"
          data-mode={mode}
          className="relative aspect-[3/4] max-h-[calc(100dvh-2rem)] w-full overflow-hidden rounded-[var(--site-radius)] bg-[#0F172A] sm:aspect-video lg:max-h-[calc(100dvh-6rem)]"
        >
          <RoomAudioRenderer />
          <ConnectionStateReporter reconnect={reconnect} />
          <DeviceBootstrap />
          <SessionTimer startedAt={startedAt} onStart={setStartedAt} />
          <MeetingStage />
          {mode === "host" ? <HostControls stageRef={stageRef} /> : <MeetingGuestControlBar />}
          <ConnectionLayers reconnect={reconnect} isCounterpart={isRemote} topSlot={
              <>
                {mediaMessage && (
                  <div
                    role="alert"
                    data-testid="meeting-media-alert"
                    className="pointer-events-auto flex max-w-md items-center gap-2 rounded-[var(--site-radius)] bg-warning py-1 ps-3 pe-1 text-sm font-medium text-warning-foreground shadow-lg"
                  >
                    <span className="min-w-0 flex-1">{mediaMessage}</span>
                    <button
                      type="button"
                      aria-label={t.dialogCancel}
                      onClick={() => setMediaMessage(null)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-current"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
                <MeetingEndingNotice endsAt={endsAt} />
              </>
            }
          />
        </LiveKitRoom>
      </RoomUiProvider>
    </ParticipantLabelProvider>
  );
}

/** Oda dışı ekranlar için ortak, sade durum kartı (sona erdi / çıkarıldı / geçersiz …). */
export function MeetingNotice({
  icon,
  title,
  body,
  actions,
  testId,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  actions?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-[var(--site-radius)] border border-border bg-surface p-8 text-center"
    >
      <div className="text-foreground/50" aria-hidden="true">
        {icon}
      </div>
      <h1 className="font-heading text-lg font-semibold text-foreground">{title}</h1>
      {body && <p className="text-sm text-foreground/70">{body}</p>}
      {actions && <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
