export type Facing = "user" | "environment";

interface TrackLike {
  mediaStreamTrack?: { getSettings?: () => MediaTrackSettings; label?: string } | null;
}

/**
 * Yerel kamera izinin yönü: önce `getSettings().facingMode`, yoksa cihaz etiketinden tahmin ("back/rear/arka"), yoksa
 * masaüstü web kamerası gibi "user". Yalnızca YEREL ÖNİZLEMENİN aynalanıp aynalanmayacağına karar verir (CSS);
 * karşıya giden görüntü hiçbir durumda değiştirilmez.
 */
export function readFacing(track: TrackLike | null | undefined): Facing {
  const mst = track?.mediaStreamTrack;
  const settings = mst?.getSettings?.();
  if (settings?.facingMode === "environment") return "environment";
  if (settings?.facingMode === "user") return "user";
  if (/back|rear|environment|arka|trasera|hinten|arrière|задн|خلف/i.test(mst?.label ?? "")) return "environment";
  return "user";
}

export function deviceIdOf(track: TrackLike | null | undefined): string | undefined {
  return track?.mediaStreamTrack?.getSettings?.().deviceId;
}
