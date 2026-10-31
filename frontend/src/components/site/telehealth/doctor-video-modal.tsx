"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { DoctorShowcaseVideo } from "@/lib/api/types";
import { useReviewStrings } from "@/lib/i18n/use-review-strings";
import { useUiStrings } from "@/lib/i18n/use-ui-strings";
import { languageName } from "@/lib/review-format";
import { CONTROL_BUTTON_CLASS } from "@/components/site/blocks/gallery-lightbox";
import { VideoFacade, localThumbnail, safeMediaUrl } from "@/components/site/telehealth/video-facade";
import { cn } from "@/lib/utils";

/**
 * Paket AE — video modalı. Modal KAPALIYKEN hiçbir `<video>`/`<iframe>` yoktur (içerik yalnızca açılınca
 * oluşturulur) → MP4'e istek gitmez. YouTube/Vimeo mevcut facade ile (Oynat'a kadar üçüncü tarafa istek yok);
 * yüklenen MP4 `<video preload="none" poster controls playsInline>` + varsa `<track kind="captions">`.
 * Altyazı varsa `crossOrigin="anonymous"` (medya API origin'inden gelebilir; /uploads CORS başlığı verir).
 */
export function DoctorVideoModal({
  video,
  unsupportedLabel,
  onClose,
}: {
  video: DoctorShowcaseVideo | null;
  unsupportedLabel: string;
  onClose: () => void;
}) {
  const ui = useUiStrings();
  const { t, intlLocale } = useReviewStrings();
  const title = video ? video.title?.trim() || video.alt?.trim() || t.videoFallbackTitle : "";
  const src = video?.videoProvider === "upload" ? safeMediaUrl(video.videoUrl) : null;
  const captionsUrl = safeMediaUrl(video?.captionsUrl);
  const captionsLang = video?.captionsLang?.trim() || null;

  return (
    <DialogPrimitive.Root open={video !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/90 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          data-testid="doctor-video-modal"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 outline-none sm:p-10 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close aria-label={ui.close} className={cn(CONTROL_BUTTON_CLASS, "absolute end-3 top-3 z-10 sm:end-6 sm:top-6")}>
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
          {video && (
            <div className="w-full max-w-4xl">
              {video.videoProvider === "upload" ? (
                src ? (
                  <video
                    key={video.id}
                    className="aspect-video w-full rounded-[var(--site-radius)] bg-black"
                    preload="none"
                    poster={localThumbnail(video.thumbnailUrl) ?? undefined}
                    controls
                    playsInline
                    autoPlay
                    src={src}
                    aria-label={title}
                    {...(captionsUrl ? { crossOrigin: "anonymous" as const } : {})}
                  >
                    {captionsUrl && (
                      <track kind="captions" src={captionsUrl} srcLang={captionsLang ?? undefined} label={captionsLang ? languageName(captionsLang, intlLocale) : title} default />
                    )}
                    {unsupportedLabel}
                  </video>
                ) : null
              ) : (
                <VideoFacade video={video} />
              )}
              {video.description && <p className="mt-3 text-sm text-white/80">{video.description}</p>}
            </div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
