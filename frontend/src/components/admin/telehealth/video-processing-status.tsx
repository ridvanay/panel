"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDuration, formatMegabytesTr } from "@/lib/video-upload";

/** Paket AE-ek — yüklenen videonun sunucu tarafı dönüştürme durumu (rozet, sıra, boyut önce/sonra, hata + yeniden dene). */
export interface VideoProcessingView {
  status: "processing" | "ready" | "failed";
  error?: string | null;
  canRetry?: boolean;
  sourceSizeBytes?: number | null;
  outputSizeBytes?: number | null;
  sourceDurationSec?: number | null;
}

interface Props {
  processing: VideoProcessingView;
  /** Kuyruktaki sıra (1 tabanlı); bilinmiyorsa `null`/`undefined`. */
  queuePosition?: number | null;
  onRetry?: () => void;
  retrying?: boolean;
}

const LABELS = { processing: "İşleniyor", ready: "Hazır", failed: "Başarısız" } as const;
const TONES = { processing: "warning", ready: "success", failed: "danger" } as const;

export function VideoProcessingStatus({ processing, queuePosition, onRetry, retrying }: Props) {
  const { status } = processing;
  const sizes =
    processing.sourceSizeBytes != null && processing.outputSizeBytes != null
      ? `${formatMegabytesTr(processing.sourceSizeBytes)} → ${formatMegabytesTr(processing.outputSizeBytes)}`
      : processing.sourceSizeBytes != null
        ? formatMegabytesTr(processing.sourceSizeBytes)
        : null;
  const duration = processing.sourceDurationSec != null ? formatDuration(processing.sourceDurationSec) : null;

  return (
    <div className="space-y-1" data-testid="video-processing-status">
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-foreground/70">
        <Badge tone={TONES[status]} size="sm">
          {LABELS[status]}
        </Badge>
        {status === "processing" && queuePosition != null && <span>Sırada: {queuePosition}</span>}
        {sizes && <span>{sizes}</span>}
        {duration && <span>{duration}</span>}
      </p>
      {status === "failed" && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-xs text-danger">
            {processing.error || "Video dönüştürülemedi."}
          </p>
          {processing.canRetry && onRetry && (
            <Button type="button" variant="outline" size="sm" loading={retrying} onClick={onRetry}>
              Yeniden dene
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
