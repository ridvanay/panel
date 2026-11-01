"use client";

import { useCallback, useEffect, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { Track } from "livekit-client";
import { deviceIdOf, readFacing } from "./camera-facing";
import { loadPrefs, savePrefs } from "./device-prefs";
import { useRoomUi } from "./room-ui-context";

export type DeviceKind = "videoinput" | "audioinput" | "audiooutput";

export interface DeviceOption {
  deviceId: string;
  label: string;
}

/** `enumerateDevices` + `devicechange`. İzin verilmeden etiketler boş gelir; boş etiketi arayüz (çevrilmiş ad + sıra) doldurur. */
export function useDeviceList(kind: DeviceKind): DeviceOption[] {
  const [devices, setDevices] = useState<DeviceOption[]>([]);

  useEffect(() => {
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md?.enumerateDevices) return;
    let cancelled = false;
    const refresh = () => {
      md.enumerateDevices()
        .then((all) => {
          if (cancelled) return;
          const list = all
            .filter((d) => d.kind === kind && d.deviceId)
            .map((d) => ({ deviceId: d.deviceId, label: d.label }));
          setDevices(list);
        })
        .catch(() => {});
    };
    refresh();
    md.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      md.removeEventListener?.("devicechange", refresh);
    };
  }, [kind]);

  return devices;
}

/** Odadayken cihaz değişimi: `room.switchActiveDevice` (yayın kapatılıp açılmaz, oda yeniden kurulmaz). */
export function useDeviceActions() {
  const room = useRoomContext();
  const { setFacing } = useRoomUi();

  /** Başarılıysa tercihi kaydeder; `false` döner → çağıran çevrilmiş hata gösterir. */
  const selectDevice = useCallback(
    async (kind: DeviceKind, deviceId: string): Promise<boolean> => {
      try {
        const ok = await room.switchActiveDevice(kind, deviceId);
        if (ok === false) return false;
        savePrefs({ [kind]: deviceId });
        if (kind === "videoinput") {
          setFacing(readFacing(room.localParticipant?.getTrackPublication(Track.Source.Camera)?.videoTrack));
        }
        return true;
      } catch {
        return false;
      }
    },
    [room, setFacing]
  );

  const activeDevice = useCallback((kind: DeviceKind): string | undefined => room.getActiveDevice?.(kind), [room]);

  /**
   * Ses işleme anahtarları: mikrofon izi YENİ kısıtlarla `restartTrack` edilir (yayın kapatılıp açılmaz). Not: LiveKit
   * `restart`, `deviceId` verilmezse ses kısıtlarını düşürür; bu yüzden etkin mikrofonun kimliği HER ZAMAN eklenir.
   */
  const applyAudioProcessing = useCallback(
    async (next: { noiseSuppression: boolean; echoCancellation: boolean; autoGainControl: boolean }): Promise<boolean> => {
      savePrefs(next);
      const track = room.localParticipant?.getTrackPublication(Track.Source.Microphone)?.audioTrack;
      if (!track) return true; // Henüz yayın yok — tercih kayıtlı, bir sonraki yakalamada uygulanır.
      try {
        const deviceId = room.getActiveDevice?.("audioinput") ?? deviceIdOf(track) ?? loadPrefs().audioinput;
        await track.restartTrack({ ...(deviceId ? { deviceId } : {}), ...next });
        return true;
      } catch {
        return false;
      }
    },
    [room]
  );

  return { selectDevice, activeDevice, applyAudioProcessing };
}
