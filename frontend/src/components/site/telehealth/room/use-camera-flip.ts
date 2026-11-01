"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, Track } from "livekit-client";
import { deviceIdOf, readFacing, type Facing } from "./camera-facing";
import { savePrefs } from "./device-prefs";
import { useDeviceList } from "./use-devices";
import { useRoomUi } from "./room-ui-context";

/**
 * Yerel kamera yönünü izden okuyup bağlama yazar (cihaz değişimi/yeniden başlatma sonrası ön-arka kamera ayrımı için).
 * Yalnızca okur; odaya yazmaz.
 */
export function useSyncLocalFacing() {
  const room = useRoomContext();
  const { setFacing } = useRoomUi();
  useEffect(() => {
    const sync = () => {
      const track = room.localParticipant?.getTrackPublication(Track.Source.Camera)?.videoTrack;
      if (track) setFacing(readFacing(track));
    };
    sync();
    room.on(RoomEvent.ActiveDeviceChanged, sync);
    room.on(RoomEvent.LocalTrackPublished, sync);
    return () => {
      room.off(RoomEvent.ActiveDeviceChanged, sync);
      room.off(RoomEvent.LocalTrackPublished, sync);
    };
  }, [room, setFacing]);
}

/**
 * Mobil "Kamerayı çevir": `facingMode` user ↔ environment. Önce `LocalVideoTrack.restartTrack({ facingMode })` (yayın
 * kapatılıp açılmaz; yalnızca yakalama kaynağı değişir, abonelik/yayın/Room sabit). Tarayıcı `facingMode` desteklemiyorsa ya
 * da kamera gerçekte değişmediyse (iki web kameralı masaüstü) cihaz listesinden sıradaki kamera `switchActiveDevice` ile seçilir.
 * Düğme yalnızca birden çok kamera varsa gösterilir.
 */
export function useCameraFlip(): { canFlip: boolean; flip: () => Promise<boolean>; busy: boolean; facing: Facing } {
  const room = useRoomContext();
  const { facing, setFacing } = useRoomUi();
  const cameras = useDeviceList("videoinput");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const flip = useCallback(async (): Promise<boolean> => {
    if (busyRef.current) return false;
    const track = room.localParticipant?.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (!track) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      const current = readFacing(track);
      const next: Facing = current === "user" ? "environment" : "user";
      const beforeId = deviceIdOf(track);

      const facingSupported = Boolean(navigator.mediaDevices?.getSupportedConstraints?.().facingMode);
      if (facingSupported) {
        try {
          await track.restartTrack({ facingMode: next });
          const afterId = deviceIdOf(track);
          const after = readFacing(track);
          if (after === next || (afterId && afterId !== beforeId)) {
            setFacing(after);
            return true;
          }
        } catch {
          // Bu cihaz istenen yönü veremedi — aşağıda cihaz listesinden sıradaki kameraya geçilir.
        }
      }

      const all = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
      const cams = all.filter((d) => d.kind === "videoinput" && d.deviceId);
      if (cams.length < 2) return false;
      const activeId = room.getActiveDevice?.("videoinput") ?? deviceIdOf(track);
      const index = cams.findIndex((d) => d.deviceId === activeId);
      const target = cams[(index + 1) % cams.length]!;
      const ok = await room.switchActiveDevice("videoinput", target.deviceId);
      if (ok === false) return false;
      savePrefs({ videoinput: target.deviceId });
      setFacing(readFacing(track));
      return true;
    } catch {
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [room, setFacing]);

  return { canFlip: cameras.length > 1, flip, busy, facing };
}
