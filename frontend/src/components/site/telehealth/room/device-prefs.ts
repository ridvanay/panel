/**
 * Paket AF (Aşama 2) — görüşme odası tercihleri (cihaz seçimi, ses işleme anahtarları, yerleşim, kendi görüntü kutusu).
 * `localStorage`'da tek anahtar; okunamaz/yazılamazsa (gizli mod, kota, devre dışı) sessizce varsayılanlara düşer.
 *
 * ÖNEMLİ: Bu tercihler Room/bağlantı seçeneklerine (`options`, `connectOptions`) GİRMEZ. Cihaz kimliği ve ses kısıtları
 * yalnızca (a) katılımda `<LiveKitRoom video audio>` yakalama seçenekleri olarak, (b) odadayken `switchActiveDevice` /
 * `LocalTrack.restartTrack` ile iz düzeyinde uygulanır.
 */
export type PipCorner = "top-start" | "top-end" | "bottom-start" | "bottom-end";
export type PipSize = "small" | "medium" | "large";
export type StageLayout = "speaker" | "grid";

export interface DevicePrefs {
  videoinput?: string;
  audioinput?: string;
  audiooutput?: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  layout: StageLayout;
  pipSize: PipSize;
  pipCorner: PipCorner;
}

export const PREFS_STORAGE_KEY = "wmh.consultation.prefs.v1";

export const DEFAULT_PREFS: DevicePrefs = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  layout: "speaker",
  pipSize: "medium",
  pipCorner: "bottom-end",
};

const CORNERS: readonly PipCorner[] = ["top-start", "top-end", "bottom-start", "bottom-end"];
const SIZES: readonly PipSize[] = ["small", "medium", "large"];

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Her alan ayrı doğrulanır; bozuk/eksik değer varsayılana düşer. */
export function loadPrefs(): DevicePrefs {
  try {
    if (typeof window === "undefined") return { ...DEFAULT_PREFS };
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_PREFS };
    return {
      videoinput: str(parsed.videoinput),
      audioinput: str(parsed.audioinput),
      audiooutput: str(parsed.audiooutput),
      noiseSuppression: bool(parsed.noiseSuppression, DEFAULT_PREFS.noiseSuppression),
      echoCancellation: bool(parsed.echoCancellation, DEFAULT_PREFS.echoCancellation),
      autoGainControl: bool(parsed.autoGainControl, DEFAULT_PREFS.autoGainControl),
      layout: parsed.layout === "grid" ? "grid" : "speaker",
      pipSize: SIZES.includes(parsed.pipSize as PipSize) ? (parsed.pipSize as PipSize) : DEFAULT_PREFS.pipSize,
      pipCorner: CORNERS.includes(parsed.pipCorner as PipCorner) ? (parsed.pipCorner as PipCorner) : DEFAULT_PREFS.pipCorner,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Mevcut tercihlerle birleştirip yazar; yazılamazsa birleşik değeri yine döndürür (oturum içinde geçerli kalır). */
export function savePrefs(patch: Partial<DevicePrefs>): DevicePrefs {
  const next = { ...loadPrefs(), ...patch };
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Depolama yok/dolu — tercih bu oturumla sınırlı kalır.
  }
  return next;
}

/** `<LiveKitRoom video audio>` yakalama seçenekleri: kayıtlı bir şey yoksa AYNEN `true` (mevcut davranış). */
export interface CaptureOptions {
  video: true | { deviceId: string };
  audio: true | { deviceId?: string; noiseSuppression: boolean; echoCancellation: boolean; autoGainControl: boolean };
}

export function buildCaptureOptions(prefs: DevicePrefs): CaptureOptions {
  const video = prefs.videoinput ? { deviceId: prefs.videoinput } : (true as const);
  const processingChanged = !prefs.noiseSuppression || !prefs.echoCancellation || !prefs.autoGainControl;
  const audio =
    prefs.audioinput || processingChanged
      ? {
          ...(prefs.audioinput ? { deviceId: prefs.audioinput } : {}),
          noiseSuppression: prefs.noiseSuppression,
          echoCancellation: prefs.echoCancellation,
          autoGainControl: prefs.autoGainControl,
        }
      : (true as const);
  return { video, audio };
}

/** Hoparlör seçimi yalnızca `setSinkId` destekleyen tarayıcılarda (Chromium) sunulur. */
export function supportsSetSinkId(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}
