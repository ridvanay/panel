"use client";

import { useEffect, useRef, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";

export const SPEAKER_SWITCH_DELAY_MS = 2_000;

/**
 * Konuşmacı görünümü için "büyük ekrandaki kişi": adaylardan (uzak katılımcıların kimlikleri) biri en az `delayMs`
 * (2 sn) kesintisiz konuşmadan büyük ekran DEĞİŞMEZ — kısa sesler ve ani geçişler yok sayılır. Sessizlikte son kişi kalır.
 * Yalnızca `RoomEvent.ActiveSpeakersChanged` dinlenir; oda/abonelik durumuna dokunmaz.
 */
export function useDelayedSpeaker(candidates: readonly string[], defaultId: string | null, delayMs: number = SPEAKER_SWITCH_DELAY_MS): string | null {
  const room = useRoomContext();
  const [chosen, setChosen] = useState<string | null>(null);
  const candidatesRef = useRef(candidates);
  const latestSpeakerRef = useRef<string | null>(null);
  const pendingRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const chosenRef = useRef<string | null>(null);
  const defaultIdRef = useRef(defaultId);

  useEffect(() => {
    candidatesRef.current = candidates;
    defaultIdRef.current = defaultId;
    chosenRef.current = chosen;
  });

  useEffect(() => {
    const clearPending = () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timer);
        pendingRef.current = null;
      }
    };

    const onSpeakers = (speakers: ReadonlyArray<{ identity: string; isLocal?: boolean }> | undefined) => {
      const allowed = candidatesRef.current;
      const speaking = (speakers ?? []).find((s) => !s.isLocal && allowed.includes(s.identity))?.identity ?? null;
      latestSpeakerRef.current = speaking;

      const current = chosenRef.current ?? defaultIdRef.current;
      if (!speaking || speaking === current) {
        clearPending();
        return;
      }
      if (pendingRef.current?.id === speaking) return;
      clearPending();
      const timer = setTimeout(() => {
        pendingRef.current = null;
        // Süre dolduğunda hâlâ aynı kişi konuşuyorsa geçilir.
        if (latestSpeakerRef.current === speaking) {
          chosenRef.current = speaking;
          setChosen(speaking);
        }
      }, delayMs);
      pendingRef.current = { id: speaking, timer };
    };

    room.on(RoomEvent.ActiveSpeakersChanged, onSpeakers as never);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, onSpeakers as never);
      clearPending();
    };
  }, [room, delayMs]);

  // Seçilen kişi odadan çıktıysa varsayılana dönülür.
  return chosen && candidates.includes(chosen) ? chosen : defaultId;
}
