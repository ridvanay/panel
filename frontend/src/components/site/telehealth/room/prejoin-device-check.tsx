"use client";

import { useCallback, useEffect, useId, useRef, useState, type MutableRefObject } from "react";
import { Camera, Loader2, Square, Volume2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { useConsultationStrings } from "@/lib/i18n/use-consultation-strings";
import { classifyConnectionError, failureMessage, warnRaw, type ConnectionFailureKind } from "./connection-errors";
import { loadPrefs, savePrefs, supportsSetSinkId } from "./device-prefs";
import { useDeviceList, type DeviceKind } from "./use-devices";
import { playTestTone } from "./test-tone";

export interface PrejoinCheckHandle {
  /** Önizleme izlerini DURDURUR (katılımdan önce çağrılır; tek kameralı telefonlarda cihaz serbest kalsın). */
  stop: () => void;
}

type Status = "idle" | "starting" | "running" | "error";

function errorKindOf(error: unknown): ConnectionFailureKind {
  if (typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia) return "media";
  const kind = classifyConnectionError(error);
  return kind === "generic" || kind === "unreachable" ? "media" : kind;
}

/** RMS (0..1) → görünür çubuk seviyesi (konuşma düzeyi için biraz büyütülür). */
export function levelFromSamples(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = (samples[i]! - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / Math.max(1, samples.length)) * 3);
}

/** Mikrofon seviye çubuğu: kendi AudioContext/AnalyserNode'unu yönetir (üst bileşen her karede yeniden çizilmesin). */
function MicLevelMeter({ stream }: { stream: MediaStream }) {
  const { t } = useConsultationStrings();
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (stream.getAudioTracks().length === 0) return;
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    let raf: number | null = null;
    let cancelled = false;
    const ctx = new AudioCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buffer = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (cancelled) return;
      analyser.getByteTimeDomainData(buffer);
      setLevel(levelFromSamples(buffer));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (raf !== null) cancelAnimationFrame(raf);
      void ctx.close().catch(() => {});
    };
  }, [stream]);

  const percent = Math.round(level * 100);
  return (
    <div className="mx-auto flex max-w-md items-center gap-3">
      <span className="shrink-0 text-xs text-foreground/70">{t.deviceCheckMicLevel}</span>
      <div
        role="meter"
        aria-label={t.deviceCheckMicLevel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        data-testid="prejoin-level"
        className="h-2.5 flex-1 overflow-hidden rounded-full bg-foreground/15"
      >
        <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-75" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function PrejoinSelect({
  id,
  kind,
  label,
  devices,
  value,
  onSelect,
}: {
  id: string;
  kind: DeviceKind;
  label: string;
  devices: { deviceId: string; label: string }[];
  value: string;
  onSelect: (kind: DeviceKind, deviceId: string) => void;
}) {
  const { t } = useConsultationStrings();
  const current = devices.some((d) => d.deviceId === value) ? value : "";
  return (
    <div className="space-y-1 text-start">
      <label htmlFor={id} className="block text-xs font-medium text-foreground/70">
        {label}
      </label>
      <select
        id={id}
        data-testid={`prejoin-select-${kind}`}
        value={current}
        disabled={devices.length === 0}
        onChange={(e) => e.target.value && onSelect(kind, e.target.value)}
        className="min-h-11 w-full rounded-[var(--site-radius)] border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60"
      >
        {(devices.length === 0 || current === "") && <option value="">{devices.length === 0 ? t.settingsNoDevice : t.settingsDeviceDefault}</option>}
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Katılımdan ÖNCE cihaz testi: kamera önizlemesi, mikrofon seviye çubuğu (WebAudio AnalyserNode), hoparlör test sesi ve cihaz
 * seçimi. Önizleme kullanıcı "Test et" dediğinde başlar (izin penceresi sayfa açılışında sürpriz çıkmasın). Seçimler
 * `localStorage`'a yazılır ve katılımda `<LiveKitRoom video audio>` yakalama seçenekleri olarak kullanılır — Room/bağlantı
 * seçeneklerine DOKUNULMAZ. İzin reddedilirse çevrilmiş açıklama gösterilir.
 */
export function PrejoinDeviceCheck({ handleRef }: { handleRef: MutableRefObject<PrejoinCheckHandle | null> }) {
  const { t } = useConsultationStrings();
  const [status, setStatus] = useState<Status>("idle");
  const [errorKind, setErrorKind] = useState<ConnectionFailureKind | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [selected, setSelected] = useState(() => {
    const prefs = loadPrefs();
    return { videoinput: prefs.videoinput ?? "", audioinput: prefs.audioinput ?? "", audiooutput: prefs.audiooutput ?? "" };
  });
  const [toneError, setToneError] = useState(false);
  const cameras = useDeviceList("videoinput");
  const microphones = useDeviceList("audioinput");
  const speakers = useDeviceList("audiooutput");
  const canPickSpeaker = supportsSetSinkId();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef(0);
  const titleId = useId();

  const stop = useCallback(() => {
    sessionRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStream(null);
    setStatus((prev) => (prev === "error" ? prev : "idle"));
  }, []);

  useEffect(() => {
    handleRef.current = { stop };
    return () => {
      handleRef.current = null;
      stop();
    };
  }, [handleRef, stop]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) {
      // Bazı ortamlarda (eski tarayıcı/jsdom) `play()` söz döndürmez.
      const playing = el.play?.() as Promise<void> | undefined;
      playing?.catch?.(() => {});
    }
  }, [stream, status]);

  const start = useCallback(
    async (choice: { videoinput: string; audioinput: string }) => {
      stop();
      const session = sessionRef.current;
      setStatus("starting");
      setErrorKind(null);
      try {
        const md = navigator.mediaDevices;
        if (!md?.getUserMedia) throw new Error("mediaDevices unavailable");
        const media = await md.getUserMedia({
          video: choice.videoinput ? { deviceId: { ideal: choice.videoinput } } : true,
          audio: choice.audioinput ? { deviceId: { ideal: choice.audioinput } } : true,
        });
        if (session !== sessionRef.current) {
          // Bu arada durduruldu/yeniden başlatıldı — gelen izleri hemen bırak.
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = media;
        setStream(media);
        setStatus("running");
      } catch (error) {
        if (session !== sessionRef.current) return;
        warnRaw("prejoin device check failed", error);
        setErrorKind(errorKindOf(error));
        setStatus("error");
      }
    },
    [stop]
  );

  function handleSelect(kind: DeviceKind, deviceId: string) {
    const next = { ...selected, [kind]: deviceId };
    setSelected(next);
    savePrefs({ [kind]: deviceId });
    if (kind !== "audiooutput" && (status === "running" || status === "starting")) void start(next);
  }

  async function handleTone() {
    setToneError(false);
    try {
      await playTestTone(canPickSpeaker ? selected.audiooutput || undefined : undefined);
    } catch {
      setToneError(true);
    }
  }

  const running = status === "running";
  return (
    <section aria-labelledby={titleId} data-testid="prejoin-device-check" className="rounded-[var(--site-radius)] border border-border bg-surface p-4 sm:p-6">
      <h2 id={titleId} className="text-center text-sm font-semibold text-foreground">
        {t.deviceCheckTitle}
      </h2>
      <p className="mx-auto mt-1 max-w-md text-center text-xs text-foreground/60">{t.deviceCheckHint}</p>

      <div className="mt-4 flex justify-center">
        {running || status === "starting" ? (
          <button
            type="button"
            onClick={stop}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-5 text-sm font-medium text-foreground hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-primary"
          >
            <Square className="h-4 w-4" aria-hidden="true" />
            {t.deviceCheckStop}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start(selected)}
            data-testid="prejoin-test-start"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/40 bg-primary/5 px-5 text-sm font-medium text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary"
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
            {t.deviceCheckStart}
          </button>
        )}
      </div>

      {status === "error" && errorKind && (
        <div className="mt-3" role="alert" data-testid="prejoin-error">
          <Alert variant="error">{failureMessage(errorKind, t)}</Alert>
        </div>
      )}

      {(running || status === "starting") && (
        <div className="mt-4 space-y-3">
          <div className="relative mx-auto aspect-video w-full max-w-md overflow-hidden rounded-[var(--site-radius)] bg-black">
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              aria-label={t.deviceCheckPreviewLabel}
              data-testid="prejoin-preview"
              className="h-full w-full -scale-x-100 object-cover"
            />
            {status === "starting" && (
              <span className="absolute inset-0 flex items-center justify-center text-white">
                <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              </span>
            )}
          </div>

          {stream && <MicLevelMeter stream={stream} />}

          <div className="mx-auto grid max-w-md gap-3">
            <PrejoinSelect id={`${titleId}-v`} kind="videoinput" label={t.settingsCamera} devices={cameras} value={selected.videoinput} onSelect={handleSelect} />
            <PrejoinSelect id={`${titleId}-a`} kind="audioinput" label={t.settingsMicrophone} devices={microphones} value={selected.audioinput} onSelect={handleSelect} />
            {canPickSpeaker && <PrejoinSelect id={`${titleId}-o`} kind="audiooutput" label={t.settingsSpeaker} devices={speakers} value={selected.audiooutput} onSelect={handleSelect} />}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void handleTone()}
                data-testid="prejoin-tone"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-5 text-sm font-medium text-foreground hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Volume2 className="h-4 w-4" aria-hidden="true" />
                {t.deviceCheckSpeakerTest}
              </button>
            </div>
            {toneError && <p className="text-center text-xs text-danger">{t.settingsApplyError}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
