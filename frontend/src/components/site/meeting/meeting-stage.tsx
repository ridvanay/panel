"use client";

import { useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { cn } from "@/lib/utils";
import { useMeetingStrings } from "@/lib/i18n/use-meeting-strings";
import { RoomParticipantTile } from "@/components/site/telehealth/room/participant-tile";
import { useRoomUi } from "@/components/site/telehealth/room/room-ui-context";
import { useSyncLocalFacing } from "@/components/site/telehealth/room/use-camera-flip";

/**
 * Paket AG İş 3 — toplantı sahnesi (en çok 8 kutu). `ConsultationStage` 1:1 tasarlandığı için (tek karşı taraf, tercüman
 * gömülü) yeniden kullanılmaz; yalnızca `RoomParticipantTile` (ad etiketi token `name`'inden gelir, identity ASLA görünmez)
 * ve `useSyncLocalFacing` kullanılır. Ekran paylaşımı varsa ana kutudur, diğerleri alttaki şeritte küçülür.
 */

/** Izgara sınıfı: 1 kutu tek sütun; 2 kutu yan yana; 3-4 iki sütun; 5-6 üç sütun; 7-8 dört sütun (geniş ekran). */
export function meetingGridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  if (count <= 4) return "grid-cols-2";
  if (count <= 6) return "grid-cols-2 lg:grid-cols-3";
  return "grid-cols-2 lg:grid-cols-4";
}

const TILE_CLASS = "h-full min-h-28 w-full rounded-[var(--site-radius)]";

export function MeetingStage() {
  const { t } = useMeetingStrings();
  const ui = useRoomUi();
  useSyncLocalFacing();
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);

  const screens = tracks.filter((tr) => tr.source === Track.Source.ScreenShare);
  const cameras = tracks.filter((tr) => tr.source === Track.Source.Camera).slice(0, 8);
  const main = screens[0] ?? null;
  const alone = cameras.length <= 1;

  function renderCamera(tr: (typeof cameras)[number], className: string) {
    const key = `${tr.participant.identity}:camera`;
    if (tr.participant.isLocal) {
      return (
        <div
          key={key}
          data-local-camera="true"
          data-facing={ui.facing}
          data-mirrored={String(ui.facing === "user")}
          className={cn("overflow-hidden", className)}
        >
          <RoomParticipantTile trackRef={tr} className="h-full w-full" />
        </div>
      );
    }
    return <RoomParticipantTile key={key} trackRef={tr} className={className} />;
  }

  return (
    <div className="absolute inset-0 flex flex-col gap-2 p-3 pb-24 pt-14" data-testid="meeting-stage" data-tile-count={cameras.length}>
      {alone && (
        <p role="status" className="pointer-events-none absolute inset-x-0 top-14 z-10 text-center text-sm text-white/80" data-testid="meeting-waiting-others">
          {t.waitingForOthers}
        </p>
      )}
      {main ? (
        <>
          <div className="min-h-0 flex-1" data-testid="meeting-main-tile">
            <RoomParticipantTile key={`${main.participant.identity}:screen`} trackRef={main} className={TILE_CLASS} />
          </div>
          <div className="flex h-24 shrink-0 gap-2 overflow-x-auto sm:h-28" data-testid="meeting-strip">
            {cameras.map((tr) => renderCamera(tr, "h-full w-32 shrink-0 rounded-[var(--site-radius)] sm:w-40"))}
          </div>
        </>
      ) : (
        <div
          className={cn("grid min-h-0 flex-1 auto-rows-fr gap-2", meetingGridClass(cameras.length))}
          data-testid="meeting-grid"
        >
          {cameras.map((tr) => renderCamera(tr, TILE_CLASS))}
        </div>
      )}
    </div>
  );
}
