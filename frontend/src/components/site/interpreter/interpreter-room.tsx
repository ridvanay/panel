"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import "@livekit/components-styles";
import { LiveKitRoom, ParticipantTile, RoomAudioRenderer, TrackToggle, useParticipants, useRoomContext, useTracks } from "@livekit/components-react";
import { DisconnectReason, Track } from "livekit-client";
import { AlertTriangle, Circle, Languages, LogOut } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { fmt, useFriendlyError, usePortalStrings } from "@/lib/i18n/use-portal-strings";
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

/**
 * Paket AA — tercümanın görüşme ekranı. Hasta/doktor odası (`consultation-room.tsx`) KULLANILMAZ;
 * tercüman yalnızca şunları görür: hasta ve doktor videoları, kendi kamera/mikrofon kontrolleri,
 * "Ayrıl", kayıt açıksa "Bu görüşme kaydediliyor" uyarısı ve (varsa) kalite dinleyicisi uyarısı.
 * Kayıt başlatma/durdurma, belge paneli, not paneli ve randevu bilgisi YOKTUR; ekran paylaşımı token
 * düzeyinde kapalıdır.
 */
function InterpreterStage() {
  const { t } = usePortalStrings();
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
            <ParticipantTile key={tr.participant.identity} trackRef={tr} className="h-full min-h-40 w-full overflow-hidden rounded-[var(--site-radius)]" />
          ))}
        </div>
      )}
      {local && (
        <div className="absolute bottom-20 end-4 z-10 h-24 w-32 overflow-hidden rounded-[var(--site-radius)] border border-white/20 shadow-lg lg:h-28 lg:w-40">
          <ParticipantTile trackRef={local} className="h-full w-full" />
        </div>
      )}
    </div>
  );
}

const TOGGLE_CLASS =
  "inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow hover:bg-white data-[lk-enabled=false]:bg-red-600 data-[lk-enabled=false]:text-white";

function InterpreterControls() {
  const { t } = usePortalStrings();
  const room = useRoomContext();
  return (
    <div className="absolute inset-x-0 bottom-3 z-20 flex justify-center gap-2">
      <TrackToggle source={Track.Source.Microphone} aria-label={t.interpreter.microphone} title={t.interpreter.microphone} className={TOGGLE_CLASS} />
      <TrackToggle source={Track.Source.Camera} aria-label={t.interpreter.camera} title={t.interpreter.camera} className={TOGGLE_CLASS} />
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

  async function join() {
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
        <LiveKitRoom
          key={meeting.token}
          token={meeting.token}
          serverUrl={meeting.serverUrl}
          video
          audio
          connect
          options={{ adaptiveStream: true, dynacast: true }}
          onDisconnected={(reason) => {
            if (reason === DisconnectReason.PARTICIPANT_REMOVED) setRemoved(true);
            leave();
          }}
          onError={(err) => setError(friendlyError(err))}
          onMediaDeviceFailure={() => setError(friendlyError(new Error("media")))}
          className="relative aspect-[3/4] max-h-[calc(100dvh-8rem)] w-full overflow-hidden rounded-[var(--site-radius)] bg-[#0F172A] sm:aspect-video"
          data-testid="interpreter-room"
        >
          <RoomAudioRenderer />
          <QaListenerNotice />
          <RecordingNotice assignmentId={assignmentId} />
          <InterpreterStage />
          <InterpreterControls />
        </LiveKitRoom>
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
