import { cn } from "@/lib/utils";
import { getVideoEmbedUrl } from "@/lib/page-builder/video-embed";
import type { BlockChrome, VideoBlock } from "@/lib/page-builder/types";

export function VideoBlockView({ block, chrome }: { block: VideoBlock; chrome: BlockChrome }) {
  const { provider, url, autoplay, muted } = block.data;
  if (!url) return null;
  const embedUrl = provider === "mp4" ? null : getVideoEmbedUrl(provider, url, { autoplay, muted });

  return (
    <section className={cn(chrome === "page" && "px-4 py-8 sm:px-6")}>
      <div className="relative mx-auto aspect-video w-full max-w-3xl overflow-hidden rounded-lg bg-black">
        {provider === "mp4" && (
          <video src={url} controls autoPlay={autoplay} muted={muted || autoplay} className="h-full w-full" />
        )}
        {provider !== "mp4" && embedUrl && (
          <iframe
            src={embedUrl}
            title="Video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        )}
      </div>
    </section>
  );
}
