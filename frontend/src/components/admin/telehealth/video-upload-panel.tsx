"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { AlertTriangle, Film, UploadCloud, X } from "lucide-react";
import * as mediaApi from "@/lib/api/media";
import type { VideoUploadInfo, VideoUploadWarning } from "@/lib/api/media";
import { isUploadAborted } from "@/lib/api/upload";
import { SHOWCASE_LOCALES } from "@/lib/api/doctor-showcase";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { Media } from "@/lib/api/types";
import {
  FRAME_CAPTURE_FAILED_MESSAGE,
  captureVideoFrame,
  formatDuration,
  formatMegabytes,
  validateCaptionsFile,
  validateVideoFile,
  warningsFromVideoInfo,
} from "@/lib/video-upload";
import { showMediaNotice } from "@/components/admin/media/media-notice";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";

export interface VideoUploadValue {
  video: Media | null;
  info: VideoUploadInfo | null;
  poster: Media | null;
  captions: Media | null;
  captionsLang: string;
}

interface Props {
  value: VideoUploadValue;
  onChange: (patch: Partial<VideoUploadValue>) => void;
  /** Ayardaki azami video boyutu (MB). */
  maxVideoMb: number;
  error?: string;
}

interface Progress {
  loaded: number;
  total: number;
  percent: number;
}

/** Paket AE — MP4 yükleme: ilerleme çubuğu + iptal, sunucu uyarıları, poster karesi, isteğe bağlı .vtt altyazı. */
export function VideoUploadPanel({ value, onChange, maxVideoMb, error }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const captionsRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<VideoUploadWarning[]>([]);

  const [seconds, setSeconds] = useState(1);
  const [duration, setDuration] = useState<number | null>(value.info?.durationSec ?? null);
  const [frame, setFrameState] = useState<{ blob: Blob; url: string } | null>(null);
  const frameUrlRef = useRef<string | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [posterUploading, setPosterUploading] = useState(false);
  const [captionsUploading, setCaptionsUploading] = useState(false);
  const [captionsError, setCaptionsError] = useState<string | null>(null);

  // Yerel dosya + saniye değişince kare yakala (kaydırıcıda kısa gecikme).
  useEffect(() => {
    if (!localFile) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setCapturing(true);
      setFrameError(null);
      try {
        const captured = await captureVideoFrame(localFile, seconds);
        if (cancelled) return;
        setFrame(captured.blob);
        setDuration(captured.duration || null);
      } catch {
        if (cancelled) return;
        setFrame(null);
        setFrameError(FRAME_CAPTURE_FAILED_MESSAGE);
      } finally {
        if (!cancelled) setCapturing(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [localFile, seconds]);

  function setFrame(blob: Blob | null) {
    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
    frameUrlRef.current = blob ? URL.createObjectURL(blob) : null;
    setFrameState(blob && frameUrlRef.current ? { blob, url: frameUrlRef.current } : null);
  }

  useEffect(
    () => () => {
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
    },
    [],
  );

  async function handleVideoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadError(null);
    const invalid = validateVideoFile(file, maxVideoMb);
    if (invalid) {
      setUploadError(invalid);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true);
    setProgress({ loaded: 0, total: file.size, percent: 0 });
    setWarnings([]);
    try {
      const result = await mediaApi.uploadVideo(file, { signal: controller.signal, onProgress: setProgress });
      onChange({ video: result.media, info: result.video, poster: null });
      setWarnings(result.warnings);
      setDuration(result.video.durationSec);
      setFrame(null);
      setFrameError(null);
      setSeconds(1);
      setLocalFile(file);
      toast.success("Video yüklendi.");
    } catch (err) {
      if (isUploadAborted(err)) {
        setUploadError("Yükleme iptal edildi.");
      } else {
        const message = friendlyErrorMessage(err);
        setUploadError(message);
        toast.error(message);
      }
    } finally {
      setUploading(false);
      setProgress(null);
      abortRef.current = null;
    }
  }

  function cancelUpload() {
    abortRef.current?.abort();
  }

  function removeVideo() {
    onChange({ video: null, info: null, poster: null });
    setLocalFile(null);
    setFrame(null);
    setWarnings([]);
    setDuration(null);
  }

  async function applyFrame() {
    if (!frame) return;
    setPosterUploading(true);
    try {
      const file = new File([frame.blob], `poster-${Math.round(seconds * 10) / 10}s.jpg`, { type: "image/jpeg" });
      const media = await mediaApi.uploadMedia(file, null, showMediaNotice);
      onChange({ poster: media });
      toast.success("Kapak görseli kaydedildi.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setPosterUploading(false);
    }
  }

  async function handleCaptionsChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setCaptionsError(null);
    const invalid = validateCaptionsFile(file);
    if (invalid) {
      setCaptionsError(invalid);
      return;
    }
    setCaptionsUploading(true);
    try {
      const media = await mediaApi.uploadCaptions(file);
      onChange({ captions: media });
      toast.success("Altyazı yüklendi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setCaptionsError(message);
      toast.error(message);
    } finally {
      setCaptionsUploading(false);
    }
  }

  const shownWarnings = warnings.length > 0 ? warnings : warningsFromVideoInfo(value.info);
  const maxSeconds = duration && duration > 0 ? Math.max(0, Math.floor(duration * 10) / 10) : 0;

  return (
    <div className="space-y-4" data-testid="video-upload-panel">
      <div className="space-y-2">
        <span className="block text-sm font-medium text-foreground">
          MP4 video
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        </span>

        {value.video && !uploading && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2">
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <Film className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden="true" />
              <span className="truncate" title={value.video.filename}>
                {value.video.filename}
              </span>
              <span className="text-xs text-foreground/60">
                {formatMegabytes(value.video.sizeBytes)} · {formatDuration(value.info?.durationSec)}
              </span>
              {value.info?.codec && (
                <Badge tone="neutral" size="sm">
                  {value.info.codec}
                </Badge>
              )}
            </span>
            <Button type="button" variant="ghost" size="sm" aria-label="Yüklenen videoyu kaldır" onClick={removeVideo}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {uploading && progress && (
          <div className="space-y-1" data-testid="video-upload-progress">
            <div
              role="progressbar"
              aria-label="Video yükleme ilerlemesi"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
              className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
            >
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress.percent}%` }} />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-foreground/70">
              <span>
                %{progress.percent} · {formatMegabytes(progress.loaded)} / {formatMegabytes(progress.total)}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={cancelUpload}>
                İptal
              </Button>
            </div>
          </div>
        )}

        {!uploading && (
          <div>
            <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
              <UploadCloud className="h-4 w-4" />
              {value.video ? "Videoyu değiştir" : "MP4 seç ve yükle"}
            </Button>
            <input ref={fileRef} type="file" accept="video/mp4,.mp4" aria-label="Bilgisayardan MP4 video yükle" className="hidden" onChange={handleVideoChange} />
            <p className="mt-1 text-xs text-foreground/60">Yalnızca MP4, en fazla {maxVideoMb} MB.</p>
          </div>
        )}

        {(uploadError || error) && (
          <p role="alert" className="text-xs text-danger">
            {uploadError ?? error}
          </p>
        )}

        {shownWarnings.length > 0 && (
          <Alert variant="warning">
            <ul className="space-y-1" data-testid="video-warnings">
              {shownWarnings.map((w) => (
                <li key={w.code} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{w.message}</span>
                </li>
              ))}
            </ul>
          </Alert>
        )}
      </div>

      {value.video && (
        <div className="space-y-3 rounded-lg border border-border p-3" data-testid="poster-section">
          <h4 className="text-sm font-semibold text-foreground">Kapak görseli (poster)</h4>
          {localFile && (
            <div className="space-y-2">
              {frame ? (
                // eslint-disable-next-line @next/next/no-img-element -- yerel blob önizlemesi
                <img src={frame.url} alt="Videodan yakalanan kare önizlemesi" className="max-h-48 rounded-md border border-border" />
              ) : (
                !frameError && <p className="text-xs text-foreground/60">{capturing ? "Kare yakalanıyor…" : "Kare hazırlanıyor…"}</p>
              )}
              {frameError && <Alert variant="warning">{frameError}</Alert>}
              {maxSeconds > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <label htmlFor="poster-seconds" className="text-xs text-foreground/70">
                    Saniye
                  </label>
                  <input
                    id="poster-seconds"
                    type="range"
                    min={0}
                    max={maxSeconds}
                    step={0.1}
                    value={Math.min(seconds, maxSeconds)}
                    onChange={(e) => setSeconds(Number(e.target.value))}
                    aria-label="Kapak karesi için saniye"
                    className="flex-1"
                  />
                  <input
                    type="number"
                    min={0}
                    max={maxSeconds}
                    step={0.1}
                    value={Math.min(seconds, maxSeconds)}
                    onChange={(e) => setSeconds(Math.min(maxSeconds, Math.max(0, Number(e.target.value) || 0)))}
                    aria-label="Kapak karesi saniyesi (sayı)"
                    className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm"
                  />
                </div>
              )}
              <Button type="button" variant="secondary" size="sm" loading={posterUploading} disabled={!frame} onClick={() => void applyFrame()}>
                Bu kareyi kullan
              </Button>
            </div>
          )}
          <MediaSelectField
            id="doctor-media-poster"
            label={localFile ? "Ya da kendi kapak görselinizi seçin/yükleyin" : "Kapak görseli"}
            value={value.poster}
            onChange={(poster) => onChange({ poster })}
            hint="İsteğe bağlı; yoksa oynatıcı kapaksız açılır."
          />
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-border p-3" data-testid="captions-section">
        <h4 className="text-sm font-semibold text-foreground">Altyazı (isteğe bağlı, .vtt)</h4>
        {value.captions ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate" title={value.captions.filename}>
              {value.captions.filename}
            </span>
            <Button type="button" variant="ghost" size="sm" aria-label="Altyazıyı kaldır" onClick={() => onChange({ captions: null })}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div>
            <Button type="button" variant="secondary" size="sm" loading={captionsUploading} onClick={() => captionsRef.current?.click()}>
              <UploadCloud className="h-4 w-4" />
              .vtt yükle
            </Button>
            <input ref={captionsRef} type="file" accept=".vtt,text/vtt" aria-label="Altyazı (.vtt) yükle" className="hidden" onChange={handleCaptionsChange} />
          </div>
        )}
        {captionsError && (
          <p role="alert" className="text-xs text-danger">
            {captionsError}
          </p>
        )}
        {value.captions && (
          <Field id="media-captions-lang" label="Altyazı dili">
            {(inputProps) => (
              <Select {...inputProps} value={value.captionsLang} onChange={(e) => onChange({ captionsLang: e.target.value })}>
                {SHOWCASE_LOCALES.map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
    </div>
  );
}
