"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import "@livekit/components-styles";
import { LiveKitRoom, RoomAudioRenderer, TrackToggle, useParticipants, useRoomContext, useTracks } from "@livekit/components-react";
import { DisconnectReason, Track } from "livekit-client";
import { AlertTriangle, Circle, Languages, LogOut, RefreshCcw, Settings } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { fmt, useFriendlyError, usePortalStrings } from "@/lib/i18n/use-portal-strings";
import { fmt as fmtConsultation, useConsultationStrings } from "@/lib/i18n/use-consultation-strings";
import { useLocalizePath } from "@/context/locale-alternates-context";
import {
  getInterpreterRecordingStatus,
  leaveInterpreterSession,
  leaveInterpreterSessionOnUnload,
  listInterpreterAssignments,
  requestInterpreterToken,
} from "@/lib/api/interpreter";
import { isQaListenerParticipant, QaListenerNotice } from "@/components/site/telehealth/qa-listener-notice";
import { isInterpreterParticipant } from "@/components/site/interpreter/interpreter-participant";
import type { InterpreterAssignment, InterpreterTokenResponse } from "@/lib/api/types";
import { RoomParticipantTile } from "@/components/site/telehealth/room/participant-tile";
import { ParticipantLabelProvider } from "@/components/site/telehealth/room/label-context";
import type { LabelContext } from "@/components/site/telehealth/room/participant-label";
import { ConnectionLayers, ConnectionStateReporter } from "@/components/site/telehealth/room/connection-layers";
import { useAppReconnect } from "@/components/site/telehealth/room/use-app-reconnect";
import { disconnectKind } from "@/components/site/telehealth/room/disconnect-kind";
import { classifyConnectionError, classifyMediaFailure, failureMessage, warnRaw } from "@/components/site/telehealth/room/connection-errors";
// Paket AF (Aşama 2) — yalnızca arayüz: kamerayı çevir, cihaz ayarları, yerel önizleme aynalama. Yetki/token akışı değişmez.
import { RoomUiProvider, useRoomUi } from "@/components/site/telehealth/room/room-ui-context";
import { useCameraFlip, useSyncLocalFacing } from "@/components/site/telehealth/room/use-camera-flip";
import { SettingsPanel } from "@/components/site/telehealth/room/settings-panel";

/**
 * Paket AA — tercümanın görüşme ekranı. Hasta/doktor odası (`consultation-room.tsx`) KULLANILMAZ;
 * tercüman yalnızca şunları görür: hasta ve doktor videoları, kendi kamera/mikrofon kontrolleri,
 * "Ayrıl", kayıt açıksa "Bu görüşme kaydediliyor" uyarısı ve (varsa) kalite dinleyicisi uyarısı.
 * Kayıt başlatma/durdurma, belge paneli, not paneli ve randevu bilgisi YOKTUR; ekran paylaşımı token
 * düzeyinde kapalıdır.
 */
/** Hasta/doktor "karşı taraf" sayılır; dinleyici ve (diğer) tercüman sayılmaz. Modül düzeyinde (sabit referans). */
function isCounterpart(p: { isLocal: boolean; identity: string; metadata?: string }): boolean {
  return !p.isLocal && !isQaListenerParticipant(p) && !isInterpreterParticipant(p);
}

function InterpreterStage() {
  const { t } = usePortalStrings();
  const ui = useRoomUi();
  useSyncLocalFacing();
  const participants = useParticipants();
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  // Görüşmenin asıl katılımcıları (hasta ve doktor) — dinleyici yayın yapmaz, gösterilmez.
  const remote = tracks.filter((tr) => !tr.participant.isLocal && !isQaListenerParticipant(tr.participant) && !isInterpreterParticipant(tr.participant));
  const local = tracks.find((tr) => tr.participant.isLocal);
  const waiting = participants.filter((p) => !p.isLocal && !isQaListenerParticipant(p)).length === 0;

  return (
    <div className="relative h-full w-full p-3">
      {waiting || remote.length === 0 ? (
        <div className="flex h-full items-center justify-center text-center text-sm text-white/80">{t.interpreter.waitingParticipants}</div>
      ) : (
        <div className={remote.length > 1 ? "grid h-full grid-cols-1 gap-3 sm:grid-cols-2" : "h-full"}>
          {remote.map((tr) => (
            <RoomParticipantTile key={tr.participant.identity} trackRef={tr} className="h-full min-h-40 w-full rounded-[var(--site-radius)]" />
          ))}
        </div>
      )}
      {local && (
        <div
          data-local-camera="true"
          data-facing={ui.facing}
          data-mirrored={String(ui.facing === "user")}
          className="absolute bottom-20 end-4 z-10 h-24 w-32 overflow-hidden rounded-[var(--site-radius)] border border-white/20 shadow-lg lg:h-28 lg:w-40"
        >
          <RoomParticipantTile key="local-camera" trackRef={local} className="h-full w-full" />
        </div>
      )}
    </div>
  );
}

const TOGGLE_CLASS =
  "inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow hover:bg-white data-[lk-enabled=false]:bg-red-600 data-[lk-enabled=false]:text-white";

function InterpreterControls() {
  const { t } = usePortalStrings();
  const { t: ct } = useConsultationStrings();
  const room = useRoomContext();
  const { canFlip, flip, busy } = useCameraFlip();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const panelId = useId();
  return (
    <>
    {/* Panel, konumlandırma için sahnenin (LiveKitRoom) kökünü baz almalı → kontrol satırının DIŞINDA çizilir. */}
    {settingsOpen && <SettingsPanel id={panelId} onClose={() => setSettingsOpen(false)} />}
    <div className="absolute inset-x-0 bottom-3 z-20 flex flex-wrap justify-center gap-2 px-2">
      <TrackToggle source={Track.Source.Microphone} aria-label={t.interpreter.microphone} title={t.interpreter.microphone} className={TOGGLE_CLASS} />
      <TrackToggle source={Track.Source.Camera} aria-label={t.interpreter.camera} title={t.interpreter.camera} className={TOGGLE_CLASS} />
      {canFlip && (
        <button type="button" aria-label={ct.flipCamera} title={ct.flipCamera} disabled={busy} onClick={() => void flip()} className={TOGGLE_CLASS} data-testid="interpreter-flip-camera">
          <RefreshCcw className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        aria-label={ct.settingsOpen}
        title={ct.settingsOpen}
        aria-expanded={settingsOpen}
        aria-controls={settingsOpen ? panelId : undefined}
        onClick={() => setSettingsOpen((open) => !open)}
        className={TOGGLE_CLASS}
        data-testid="interpreter-settings"
      >
        <Settings className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        data-testid="interpreter-leave"
        // Ayrılış kaydı `LiveKitRoom.onDisconnected` üzerinden tek noktadan yazılır.
        onClick={() => void room.disconnect()}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {t.interpreter.leave}
      </button>
    </div>
    </>
  );
}

function RecordingNotice({ assignmentId }: { assignmentId: string }) {
  const { t } = usePortalStrings();
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      getInterpreterRecordingStatus(assignmentId)
        .then((r) => !cancelled && setRecording(r.status === "RECORDING"))
        .catch(() => {});
    void poll();
    const timer = window.setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [assignmentId]);
  if (!recording) return null;
  return (
    <div role="status" data-testid="interpreter-recording-notice" className="absolute end-4 top-4 z-20 flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white">
      <Circle className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
      {t.interpreter.recordingNotice}
    </div>
  );
}

export function InterpreterRoom({ assignmentId }: { assignmentId: string }) {
  const { t } = usePortalStrings();
  const { t: ct } = useConsultationStrings();
  const friendlyError = useFriendlyError();
  const localize = useLocalizePath();
  const [assignment, setAssignment] = useState<InterpreterAssignment | null | undefined>(undefined);
  const [meeting, setMeeting] = useState<InterpreterTokenResponse | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    listInterpreterAssignments()
      .then((items) => setAssignment(items.find((a) => a.id === assignmentId) ?? null))
      .catch((err) => {
        setAssignment(null);
        setError(friendlyError(err));
      });
  }, [assignmentId, friendlyError]);

  const leave = useCallback(() => {
    setMeeting(null);
    void leaveInterpreterSession(assignmentId).catch(() => {});
  }, [assignmentId]);

  // Sekme kapanırsa ayrılış kaydı yine düşsün.
  useEffect(() => {
    if (!meeting) return;
    const onHide = () => leaveInterpreterSessionOnUnload(assignmentId);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [meeting, assignmentId]);

  /**
   * Paket AF (İş 4) — tercüman odasında da aynı uygulama düzeyi yeniden bağlanma. Yetki kuralları ve token ucu DEĞİŞMEZ
   * (`requestInterpreterToken`). Kopma anında ayrılış kaydı YAZILMAZ (sunucu "ayrılış gelmeden yeniden katılım"ı zaten
   * `rejoin` olarak kapatır; DUPLICATE_IDENTITY'de öbür sekme bağlıyken kaydı LEFT yapmak yanlış olurdu); yalnızca
   * kullanıcı ayrılınca, odadan çıkarılınca ya da tüm denemeler tükenince yazılır. Odadan çıkarılma (PARTICIPANT_REMOVED)
   * bitiş sayılır, yeniden bağlanılmaz.
   */
  const reconnect = useAppReconnect<InterpreterTokenResponse>({
    fetchToken: () => requestInterpreterToken(assignmentId),
    onToken: setMeeting,
    isTerminalReason: (reason) => reason !== undefined && reason === DisconnectReason.PARTICIPANT_REMOVED,
    onGiveUp: () => void leaveInterpreterSession(assignmentId).catch(() => {}),
  });
  const resetReconnect = reconnect.reset;

  // Etiket bağlamı: tercüman hastayı yalnızca baş harflerle ("Z. K.") görür; doktor adı token `name`'inden (yedek: atama).
  const labelContext = useMemo<LabelContext>(
    () => ({
      viewer: "interpreter",
      patientInitial: assignment?.patientInitial ?? null,
      doctorFallbackName: assignment?.doctorDisplayName ?? null,
      t: ct,
      fmt: fmtConsultation,
    }),
    [assignment?.patientInitial, assignment?.doctorDisplayName, ct]
  );

  function handleDisconnected(reason?: DisconnectReason) {
    const outcome = reconnect.handleDisconnected(disconnectKind(reason), reason as number | undefined);
    if (outcome === "terminal") {
      if (reason === DisconnectReason.PARTICIPANT_REMOVED) setRemoved(true);
      leave();
    } else if (outcome === "user-left") {
      leave();
    }
  }

  function handleConnectionError(err: unknown) {
    warnRaw("interpreter LiveKitRoom onError", err);
    if (reconnect.handleConnectFailure(err)) return;
    // İlk bağlantı kurulamadı: ham SDK metni yerine nedene göre çevrilmiş mesajla katılım ekranına dön.
    resetReconnect();
    setError(failureMessage(classifyConnectionError(err), ct));
    leave();
  }

  function handleMediaFailure(failure?: string) {
    warnRaw("interpreter LiveKitRoom onMediaDeviceFailure", failure);
    setError(failureMessage(classifyMediaFailure(failure), ct));
  }

  // Kararlı geri çağrılar: `useLiveKitRoom` bağlanma efekti `onError`'u izler; her render'da yeni kimlik eski token ile yeniden
  // `room.connect()` çağırırdı (bkz. consultation-room.tsx).
  const latestHandlers = useRef({ handleDisconnected, handleConnectionError, handleMediaFailure });
  useEffect(() => {
    latestHandlers.current = { handleDisconnected, handleConnectionError, handleMediaFailure };
  });
  const stableDisconnected = useCallback((reason?: DisconnectReason) => latestHandlers.current.handleDisconnected(reason), []);
  const stableError = useCallback((err: unknown) => latestHandlers.current.handleConnectionError(err), []);
  const stableMediaFailure = useCallback((failure?: string) => latestHandlers.current.handleMediaFailure(failure), []);

  async function join() {
    resetReconnect();
    setRequesting(true);
    setError(null);
    try {
      setMeeting(await requestInterpreterToken(assignmentId));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setRequesting(false);
    }
  }

  const title = assignment ? fmt(t.interpreter.roomTitle, { language: assignment.languageName }) : t.interpreter.panelTitle;

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 font-heading text-xl font-semibold text-foreground sm:text-2xl">
          <Languages className="h-6 w-6 text-[var(--site-primary)]" aria-hidden="true" />
          <bdi>{title}</bdi>
        </h1>
        <Link href={localize("/interpreter")} className="text-sm font-medium text-[var(--site-link,var(--site-primary))] hover:underline">
          {t.interpreter.backToPanel}
        </Link>
      </div>

      {removed && (
        <div role="alert">
          <Alert variant="warning">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t.interpreter.removedNotice}
            </span>
          </Alert>
        </div>
      )}
      {error && <Alert variant="error">{error}</Alert>}

      {meeting ? (
        <ParticipantLabelProvider value={labelContext}>
          <RoomUiProvider>
          <LiveKitRoom
            key={meeting.token}
            token={meeting.token}
            serverUrl={meeting.serverUrl}
            video
            audio
            connect
            options={{ adaptiveStream: true, dynacast: true }}
            onDisconnected={stableDisconnected}
            onError={stableError}
            onMediaDeviceFailure={stableMediaFailure}
            className="relative aspect-[3/4] max-h-[calc(100dvh-8rem)] w-full overflow-hidden rounded-[var(--site-radius)] bg-[#0F172A] sm:aspect-video"
            data-testid="interpreter-room"
          >
            <RoomAudioRenderer />
            <ConnectionStateReporter reconnect={reconnect} />
            <QaListenerNotice />
            <RecordingNotice assignmentId={assignmentId} />
            <InterpreterStage />
            <InterpreterControls />
            <ConnectionLayers reconnect={reconnect} isCounterpart={isCounterpart} />
          </LiveKitRoom>
          </RoomUiProvider>
        </ParticipantLabelProvider>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-[var(--site-radius)] border border-border bg-surface p-8 text-center">
          {assignment && (
            <p className="text-sm text-foreground/70">
              {assignment.doctorDisplayName} · {assignment.patientInitial}
            </p>
          )}
          <Button type="button" onClick={() => void join()} loading={requesting} disabled={!assignment?.canJoin || removed} data-testid="interpreter-join">
            {assignment?.canJoin ? t.interpreter.join : t.interpreter.notJoinable}
          </Button>
        </div>
      )}
    </div>
  );
}
