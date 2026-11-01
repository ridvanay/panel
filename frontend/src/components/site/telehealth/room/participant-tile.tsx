"use client";

import { memo, useMemo, type ComponentProps } from "react";
import { ParticipantTile, VideoTrack, isTrackReference, useConnectionQualityIndicator, useTrackMutedIndicator } from "@livekit/components-react";
import { Track } from "livekit-client";
import { MicOff, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConsultationStrings } from "@/lib/i18n/use-consultation-strings";
import { useLabelContext } from "./label-context";
import { resolveParticipantLabel, resolveScreenShareLabel } from "./participant-label";

type TileTrackRef = NonNullable<ComponentProps<typeof ParticipantTile>["trackRef"]>;

/**
 * Hazır `ParticipantTile`'ın varsayılan alt çubuğu `name || identity` gösterir (teknik kimlik sızar). Bu yüzden
 * LiveKit'in kutusu YALNIZCA video + yer tutucu ile (children) kullanılır; ad etiketi, mikrofon-kapalı ve bağlantı
 * kalitesi aşağıdaki kendi alt çubuğumuzdadır. LiveKit kutusu korunduğu için `data-lk-*` öznitelikleri (ör. yerel ön
 * kamerada `data-lk-facing-mode="user"` aynalama) ve video abonelik/`adaptiveStream` davranışı değişmez.
 */
function TileMedia({ trackRef }: { trackRef: TileTrackRef }) {
  const showVideo =
    isTrackReference(trackRef) &&
    (trackRef.publication?.kind === "video" || trackRef.source === Track.Source.Camera || trackRef.source === Track.Source.ScreenShare);
  return (
    <>
      {showVideo && isTrackReference(trackRef) ? <VideoTrack trackRef={trackRef} /> : null}
      <div className="lk-participant-placeholder">
        <User aria-hidden="true" />
      </div>
    </>
  );
}

/** Bağlantı kalitesi → dolu çubuk sayısı (3 çubuk). */
export function qualityBars(quality: string): 0 | 1 | 2 | 3 {
  switch (quality) {
    case "excellent":
      return 3;
    case "good":
      return 2;
    case "poor":
      return 1;
    default:
      return 0;
  }
}

function QualityBars({ quality }: { quality: string }) {
  const { t, fmt } = useConsultationStrings();
  const filled = qualityBars(quality);
  const level =
    quality === "excellent"
      ? t.qualityExcellent
      : quality === "good"
        ? t.qualityGood
        : quality === "poor"
          ? t.qualityPoor
          : quality === "lost"
            ? t.qualityLost
            : t.qualityUnknown;
  return (
    <span
      role="img"
      aria-label={fmt(t.qualityLabel, { level })}
      data-quality={quality}
      className="flex h-3.5 shrink-0 items-end gap-[2px]"
    >
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          aria-hidden="true"
          className={cn(
            "w-[3px] rounded-[1px]",
            bar === 1 ? "h-1.5" : bar === 2 ? "h-2.5" : "h-3.5",
            bar <= filled ? (filled === 1 ? "bg-red-400" : "bg-white") : "bg-white/30"
          )}
        />
      ))}
    </span>
  );
}

/** Kamera kutusu durum simgeleri (ekran paylaşımı kutusunda gösterilmez). */
function TileStatus({ participant }: { participant: TileTrackRef["participant"] }) {
  const { t } = useConsultationStrings();
  const micRef = useMemo(() => ({ participant, source: Track.Source.Microphone }), [participant]);
  const { isMuted } = useTrackMutedIndicator(micRef);
  const { quality } = useConnectionQualityIndicator({ participant });
  return (
    <>
      {isMuted && (
        <span role="img" aria-label={t.micOffIndicator} className="flex shrink-0 items-center text-white">
          <MicOff className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      )}
      <QualityBars quality={String(quality)} />
    </>
  );
}

/**
 * Paket AF (İş 1) — kişi adlı video kutusu. Alt köşede HER ZAMAN görünen (hover'a bağlı olmayan) çubuk: ad etiketi,
 * mikrofon kapalı simgesi, 3 çubuklu bağlantı kalitesi. Identity ASLA görünmez (`participant-label.ts`). `memo` +
 * sabit `trackRef` ile gereksiz yeniden render'da video elemanı sökülüp takılmaz.
 */
export const RoomParticipantTile = memo(function RoomParticipantTile({ trackRef, className }: { trackRef: TileTrackRef; className?: string }) {
  const ctx = useLabelContext();
  const { participant, source } = trackRef;
  const isScreen = source === Track.Source.ScreenShare;
  const label = isScreen ? resolveScreenShareLabel(participant, ctx) : resolveParticipantLabel(participant, ctx);

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <ParticipantTile trackRef={trackRef} className="h-full w-full">
        <TileMedia trackRef={trackRef} />
      </ParticipantTile>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-4 text-xs font-medium text-white">
        <span className="min-w-0 flex-1 truncate" data-testid="tile-label">
          {label ? <bdi>{label}</bdi> : null}
        </span>
        {!isScreen && <TileStatus participant={participant} />}
      </div>
    </div>
  );
});
