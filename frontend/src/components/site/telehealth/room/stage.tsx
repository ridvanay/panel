"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useParticipants, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { ArrowLeftRight, Eye, EyeOff, Loader2, Maximize2, User } from "lucide-react";
import { InterpreterPresence } from "@/components/site/interpreter/interpreter-presence";
import { isInterpreterParticipant } from "@/components/site/interpreter/interpreter-participant";
import { useConsultationStrings } from "@/lib/i18n/use-consultation-strings";
import { cn } from "@/lib/utils";
import { RoomParticipantTile } from "./participant-tile";
import { useLabelContext } from "./label-context";
import { resolveExpectedCounterpartName } from "./participant-label";
import { isCounterpart } from "./participant-kind";
import { useRoomUi } from "./room-ui-context";
import { useSyncLocalFacing } from "./use-camera-flip";
import { useDelayedSpeaker } from "./use-delayed-speaker";
import { useSelfViewGestures } from "./use-self-view-gestures";
import { assignRoles, CORNER_CLASS, gridColumnsClass, oppositeCorner, SIZE_CLASS, thumbShiftPx, type StageTileInfo, type TileRole } from "./stage-layout";
import type { PipCorner } from "./device-prefs";

type TileTrackRef = Parameters<typeof RoomParticipantTile>[0]["trackRef"];

const BOX_BASE = "overflow-hidden rounded-[var(--site-radius)] border border-white/20 shadow-lg";

/** Rol + köşe + boyut → sınıflar. Tailwind tam sınıf adlarını taradığı için parçalar `stage-layout.ts`'te sabit. */
function roleClassName(role: TileRole, opts: { corner: PipCorner; size: keyof typeof SIZE_CLASS; bubble: boolean; thumbCorner: PipCorner }): string {
  switch (role) {
    case "main":
      return "absolute inset-0 z-0";
    case "grid":
      return "relative min-h-0 min-w-0 overflow-hidden rounded-[var(--site-radius)]";
    case "thumb":
      return cn("absolute z-10 aspect-[4/3] w-[8.5rem]", BOX_BASE, CORNER_CLASS[opts.thumbCorner]);
    case "pip":
      return opts.bubble
        ? cn("absolute z-10 h-12 w-12 overflow-hidden rounded-full border border-white/30 shadow-lg", CORNER_CLASS[opts.corner])
        : cn("group absolute z-10 aspect-[4/3] touch-none select-none", BOX_BASE, SIZE_CLASS[opts.size], CORNER_CLASS[opts.corner]);
  }
}

function PipControls({ revealed, canHide }: { revealed: boolean; canHide: boolean }) {
  const { t, fmt } = useConsultationStrings();
  const ui = useRoomUi();
  const sizeLabel = ui.pipSize === "small" ? t.sizeSmall : ui.pipSize === "medium" ? t.sizeMedium : t.sizeLarge;
  const btn =
    "flex h-11 w-11 shrink-0 items-center justify-center text-white transition-colors duration-150 hover:bg-white/25 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white";
  return (
    <div
      data-revealed={revealed}
      className="pointer-events-none absolute inset-x-0 top-0 flex justify-center bg-black/55 opacity-0 transition-opacity duration-300 focus-within:pointer-events-auto focus-within:opacity-100 data-[revealed=true]:pointer-events-auto data-[revealed=true]:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
    >
      <button type="button" aria-label={fmt(t.selfViewSize, { size: sizeLabel })} title={fmt(t.selfViewSize, { size: sizeLabel })} onClick={ui.cyclePipSize} className={btn}>
        <Maximize2 className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" aria-label={t.selfViewSwap} title={t.selfViewSwap} onClick={ui.toggleSwap} className={btn}>
        <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
      </button>
      {canHide && (
        <button type="button" aria-label={t.selfViewHide} title={t.selfViewHide} onClick={() => ui.setPipHidden(true)} className={btn}>
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

interface StageTileProps {
  trackRef: TileTrackRef;
  isLocal: boolean;
  role: TileRole;
  thumbIndex: number;
  containerRef: RefObject<HTMLElement | null>;
}

/**
 * Tek video kutusu. DOM'daki yeri ve `key`'i değişmez; yerleşim/PiP değişimleri YALNIZCA sınıf/stil günceller
 * (aynı katılımcının `<video>` elemanı sökülüp takılmaz, abonelik/kalite `adaptiveStream`'e kalır).
 */
function StageTile({ trackRef, isLocal, role, thumbIndex, containerRef }: StageTileProps) {
  const { t } = useConsultationStrings();
  const ui = useRoomUi();
  const [revealed, setRevealed] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
    },
    []
  );

  const isPip = role === "pip";
  const bubble = isPip && isLocal && ui.pipHidden;
  const gestures = useSelfViewGestures({
    containerRef,
    enabled: isPip && !bubble,
    onCorner: ui.setPipCorner,
    onSizeStep: ui.stepPipSize,
    onTap: () => {
      setRevealed(true);
      if (revealTimer.current) clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(() => setRevealed(false), 4_000);
    },
    onDoubleTap: ui.toggleSwap,
  });

  const thumbCorner = oppositeCorner(ui.pipCorner);
  const shift = role === "thumb" ? thumbShiftPx(thumbCorner, thumbIndex) : 0;
  const style: CSSProperties | undefined = gestures.offset
    ? { transform: `translate(${gestures.offset.x}px, ${gestures.offset.y}px)`, transition: "none" }
    : shift
      ? { transform: `translateY(${shift}px)` }
      : undefined;

  const mirrored = isLocal && ui.facing === "user";

  return (
    <div
      data-tile-role={role}
      data-pip-size={isPip ? ui.pipSize : undefined}
      data-pip-corner={isPip ? ui.pipCorner : undefined}
      data-pip-hidden={isPip && isLocal ? String(bubble) : undefined}
      data-local-camera={isLocal ? "true" : undefined}
      data-facing={isLocal ? ui.facing : undefined}
      data-mirrored={isLocal ? String(mirrored) : undefined}
      role={isLocal && isPip ? "group" : undefined}
      aria-label={isLocal && isPip ? t.selfViewRegion : undefined}
      style={style}
      className={roleClassName(role, { corner: ui.pipCorner, size: ui.pipSize, bubble, thumbCorner })}
      {...(isPip && !bubble ? gestures.handlers : {})}
    >
      <RoomParticipantTile trackRef={trackRef} className={cn("h-full w-full", bubble && "hidden")} />
      {bubble && (
        <button
          type="button"
          aria-label={t.selfViewShow}
          title={t.selfViewShow}
          onClick={() => ui.setPipHidden(false)}
          className="absolute inset-0 flex items-center justify-center bg-slate-700 text-white hover:bg-slate-600 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
        >
          <User className="h-5 w-5" aria-hidden="true" />
          <Eye className="absolute bottom-1 end-1 h-3 w-3 opacity-80" aria-hidden="true" />
        </button>
      )}
      {isPip && !bubble && <PipControls revealed={revealed} canHide={isLocal} />}
    </div>
  );
}

/** §6.1 — bekleme odası paneli (yerel görüntü yokken): nötr/sakin, `primary` tint + `Loader2` + `animate-ping`. */
function WaitingPanel({ name }: { name: string }) {
  const { t, fmt } = useConsultationStrings();
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3 rounded-[var(--site-radius)] border border-primary/20 bg-primary/5 p-8 text-center">
        <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" aria-hidden="true" />
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
        </span>
        <h3 className="font-semibold text-foreground">{t.waitingRoomTitle}</h3>
        <p className="max-w-xs text-sm font-medium text-foreground/80">
          <bdi>{fmt(t.waitingForName, { name })}</bdi>
        </p>
        <p className="max-w-xs text-sm text-foreground/60">{t.waitingRoomBody}</p>
      </div>
    </div>
  );
}

/** Karşı taraf yokken kendi görüntüsü büyük; üzerinde adla bekleme metni. */
function WaitingOverlay({ name }: { name: string }) {
  const { t, fmt } = useConsultationStrings();
  return (
    <div role="status" aria-live="polite" data-testid="waiting-overlay" className="pointer-events-none absolute inset-x-3 bottom-[6.5rem] z-10 flex justify-center lg:bottom-32">
      <div className="flex max-w-md items-center gap-3 rounded-[var(--site-radius)] bg-black/70 px-4 py-3 text-white shadow-lg backdrop-blur-md">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/70">{t.waitingRoomTitle}</p>
          <p className="text-sm font-semibold">
            <bdi>{fmt(t.waitingForName, { name })}</bdi>
          </p>
          <p className="text-xs text-white/70">{t.waitingRoomBody}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Video düzeni. Konuşmacı görünümü (varsayılan): büyük ekranda ekran paylaşımı ya da (2 sn gecikmeli) konuşan karşı taraf,
 * kendi görüntüsü sürüklenebilir küçük kutu; ızgara görünümü: herkes eşit. Karşı taraf yokken kendi görüntüsü büyük ve
 * "X birazdan katılacak". Yerleşim/PiP yalnızca görseldir — kutular sabit sırada ve sabit `key` ile kalır.
 */
export function ConsultationStage({ appointmentId, isDoctor }: { appointmentId: string; isDoctor: boolean }) {
  const participants = useParticipants();
  // `onlySubscribed` varsayılanı: yalnızca GERÇEKTEN abone olunmuş izler (bkz. önceki tur notu); `withPlaceholder` karşı taraf
  // hiç yayın yapmıyorsa nötr avatarı korur.
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);
  const ui = useRoomUi();
  const labelCtx = useLabelContext();
  const containerRef = useRef<HTMLDivElement | null>(null);
  useSyncLocalFacing();

  const hasRemoteParticipant = participants.some(isCounterpart);
  const interpreter = participants.find((p) => !p.isLocal && isInterpreterParticipant(p)) ?? null;

  const screenTrack = hasRemoteParticipant ? tracks.find((tr) => isCounterpart(tr.participant) && tr.source === Track.Source.ScreenShare) : undefined;
  const counterpartTrack = hasRemoteParticipant ? tracks.find((tr) => isCounterpart(tr.participant) && tr.source === Track.Source.Camera) : undefined;
  const localTrack = tracks.find((tr) => tr.participant.isLocal && tr.source === Track.Source.Camera);

  const counterpartId = counterpartTrack?.participant.identity ?? null;
  const candidateIds = useMemo(() => [counterpartId, interpreter?.identity].filter((id): id is string => Boolean(id)), [counterpartId, interpreter?.identity]);
  const speakerId = useDelayedSpeaker(candidateIds, counterpartId);
  const speakerKind = interpreter && speakerId === interpreter.identity ? "interpreter" : "counterpart";

  const tiles = useMemo(() => {
    const list: Array<StageTileInfo & { trackRef: TileTrackRef }> = [];
    if (screenTrack) list.push({ key: `${screenTrack.participant.identity}:${screenTrack.source}`, kind: "screen", trackRef: screenTrack });
    if (counterpartTrack) list.push({ key: `${counterpartTrack.participant.identity}:${counterpartTrack.source}`, kind: "counterpart", trackRef: counterpartTrack });
    if (localTrack) list.push({ key: "local-camera", kind: "local", trackRef: localTrack });
    return list;
  }, [screenTrack, counterpartTrack, localTrack]);

  const roleInput = useMemo(() => [...tiles.map(({ key, kind }) => ({ key, kind })), ...(interpreter ? [{ key: "interpreter", kind: "interpreter" as const }] : [])], [tiles, interpreter]);
  const roles = assignRoles({ layout: ui.layout, swapped: ui.swapped, tiles: roleInput, speakerKind });

  const expectedName = resolveExpectedCounterpartName(labelCtx);
  const gridCount = roleInput.length;
  const interpreterRole = roles.get("interpreter");
  const thumbCorner = oppositeCorner(ui.pipCorner);

  return (
    <div
      ref={containerRef}
      data-layout={ui.layout}
      className={cn("relative h-full w-full", ui.layout === "grid" && cn("grid auto-rows-fr gap-2 p-2 pb-20 lg:pb-24", gridColumnsClass(gridCount)))}
    >
      {!localTrack && !(hasRemoteParticipant && (counterpartTrack || screenTrack)) && <WaitingPanel name={expectedName} />}

      {tiles.map((tile) => {
        const assigned = roles.get(tile.key) ?? { role: "main" as const, thumbIndex: 0 };
        return (
          <StageTile
            key={tile.key}
            trackRef={tile.trackRef}
            isLocal={tile.kind === "local"}
            role={assigned.role}
            thumbIndex={assigned.thumbIndex}
            containerRef={containerRef}
          />
        );
      })}

      {/* Tercüman (Paket AA): kendi kutusu, bildirimi ve "çıkar" akışı InterpreterPresence'ta; konum/boyut sınıfı buradan verilir. */}
      <InterpreterPresence
        appointmentId={appointmentId}
        isDoctor={isDoctor}
        tileRole={interpreterRole?.role}
        tileClassName={interpreterRole ? roleClassName(interpreterRole.role, { corner: ui.pipCorner, size: ui.pipSize, bubble: false, thumbCorner }) : undefined}
        tileStyle={interpreterRole?.role === "thumb" ? { transform: `translateY(${thumbShiftPx(thumbCorner, interpreterRole.thumbIndex)}px)` } : undefined}
      />

      {localTrack && !hasRemoteParticipant && <WaitingOverlay name={expectedName} />}
    </div>
  );
}
