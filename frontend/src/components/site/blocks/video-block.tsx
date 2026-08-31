"use client";

import { useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getVideoEmbedUrl } from "@/lib/page-builder/video-embed";
import { CONTROL_BUTTON_CLASS } from "./gallery-lightbox";
import type { BlockChrome, VideoBlock } from "@/lib/page-builder/types";

/** Bir sağlayıcının (iframe VEYA `<video>`) gerçek oynatıcı elemanını üretir — `playStyle`ten
 *  BAĞIMSIZ, hem inline hem lightbox modalinde aynen kullanılır. `forceAutoplay` yalnızca
 *  lightbox açılışında (kullanıcı zaten tıkladı — bir kullanıcı hareketi) devreye girer. */
function VideoPlayer({
  block,
  forceAutoplay,
  className,
}: {
  block: VideoBlock;
  forceAutoplay?: boolean;
  className?: string;
}) {
  const { provider, url, autoplay, muted, loop } = block.data;
  const effectiveAutoplay = forceAutoplay || autoplay;
  const embedUrl = provider === "mp4" ? null : getVideoEmbedUrl(provider, url, { autoplay: effectiveAutoplay, muted, loop });

  if (provider === "mp4") {
    return (
      <video
        src={url}
        controls
        autoPlay={effectiveAutoplay}
        muted={muted || effectiveAutoplay}
        loop={loop}
        className={cn("h-full w-full", className)}
      />
    );
  }

  if (!embedUrl) return null;

  return (
    <iframe
      src={embedUrl}
      title="Video"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      className={cn("h-full w-full", className)}
    />
  );
}

/** ui-designer §4.1 — kapak + oynat rozeti tetikleyici kartı (`playStyle: "lightbox"`). */
function LightboxTrigger({ block }: { block: VideoBlock }) {
  const [open, setOpen] = useState(false);
  const { coverUrl } = block.data;

  return (
    <>
      <button
        type="button"
        aria-label="Videoyu oynat"
        onClick={() => setOpen(true)}
        className="group relative block w-full overflow-hidden rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div className="relative aspect-video w-full bg-black">
          {coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- image-block.tsx ile AYNI gerekçe
            <img
              src={coverUrl}
              alt=""
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          )}
          <div className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/30" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-foreground shadow-lg transition-transform duration-200 group-hover:scale-110 group-hover:bg-white">
              <Play className="h-6 w-6 translate-x-0.5 fill-current" />
            </span>
          </span>
        </div>
      </button>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
          <DialogPrimitive.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none sm:p-10 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0">
            <DialogPrimitive.Title className="sr-only">Video</DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Kapat"
              className={cn(CONTROL_BUTTON_CLASS, "absolute right-3 top-3 z-10 sm:right-6 sm:top-6")}
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
            <div className="aspect-video w-full max-w-4xl overflow-hidden rounded-lg bg-black shadow-2xl">
              {open && <VideoPlayer block={block} forceAutoplay />}
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

export function VideoBlockView({ block, chrome }: { block: VideoBlock; chrome: BlockChrome }) {
  const { url, playStyle } = block.data;
  if (!url) return null;

  const resolvedPlayStyle = playStyle ?? "inline";

  if (resolvedPlayStyle === "lightbox") {
    return (
      <section className={cn(chrome === "page" && "px-4 py-8 sm:px-6")}>
        <div className="mx-auto w-full max-w-3xl">
          <LightboxTrigger block={block} />
        </div>
      </section>
    );
  }

  return (
    <section className={cn(chrome === "page" && "px-4 py-8 sm:px-6")}>
      <div className="relative mx-auto aspect-video w-full max-w-3xl overflow-hidden rounded-lg bg-black">
        <VideoPlayer block={block} />
      </div>
    </section>
  );
}
