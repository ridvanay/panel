"use client";

import { useEffect } from "react";
import { useConnectionState, useRoomContext } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { loadPrefs, supportsSetSinkId } from "./device-prefs";

/**
 * Bağlanınca kayıtlı hoparlör tercihini uygular (`room.switchActiveDevice('audiooutput')`). Kamera/mikrofon tercihi zaten
 * katılımdaki yakalama seçenekleriyle (`<LiveKitRoom video audio>`) gelir. Room/bağlantı seçeneklerine dokunmaz; hata
 * sessizce yok sayılır (cihaz çıkarılmış olabilir).
 */
export function DeviceBootstrap() {
  const room = useRoomContext();
  const state = useConnectionState();
  useEffect(() => {
    if (state !== ConnectionState.Connected || !supportsSetSinkId()) return;
    const id = loadPrefs().audiooutput;
    if (!id) return;
    try {
      void Promise.resolve(room.switchActiveDevice("audiooutput", id)).catch(() => {});
    } catch {
      // Oda henüz hazır değil — bir sonraki bağlantı durumu değişiminde yeniden denenir.
    }
  }, [state, room]);
  return null;
}
