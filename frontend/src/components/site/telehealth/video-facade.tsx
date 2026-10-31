"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import type { DoctorShowcaseVideo } from "@/lib/api/types";
import { fillReview, useReviewStrings } from "@/lib/i18n/use-review-strings";

/** Savunma: iframe yalnızca bu host'lardan yüklenir. */
const EMBED_HOSTS = new Set(["www.youtube-nocookie.com", "player.vimeo.com"]);
function allowedUrl(raw: string | null | undefined, hosts: Set<string>): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && hosts.has(url.hostname) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Küçük resim YALNIZCA kendi sunucumuzdaki kopyadır (admin kaydında indirilir). Sağlayıcı alanlarından
 * gelen bir adres asla kullanılmaz → "Oynat"a basılana kadar youtube/ytimg/vimeo'ya istek gitmez.
 */
const THIRD_PARTY_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|googlevideo\.com|vimeo\.com|vimeocdn\.com|vumbnail\.com)$/i;
export function localThumbnail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, "http://local.invalid");
    return /^https?:$/.test(url.protocol) && !THIRD_PARTY_HOST.test(url.hostname) ? raw : null;
  } catch {
    return null;
  }
}

/** Kendi sunucumuzdan gelen medya adresi: yalnızca göreli ya da http(s) kabul edilir (javascript:/data: reddedilir). */
export function safeMediaUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, "http://local.invalid");
    return /^https?:$/.test(url.protocol) ? raw : null;
  } catch {
    return null;
  }
}

function withAutoplay(embedUrl: string): string {
  try {
    const url = new URL(embedUrl);
    url.searchParams.set("autoplay", "1");
    return url.toString();
  } catch {
    return embedUrl;
  }
}

/**
 * Paket Y — video "facade": ilk anda YALNIZCA küçük resim (yoksa yer tutucu) + oynat düğmesi vardır; `iframe`
 * (youtube-nocookie / Vimeo `dnt=1`) ancak kullanıcı oynat'a basınca yüklenir. Böylece sayfa açılışında
 * üçüncü taraf çerez/izleme isteği oluşmaz (KVKK). Küçük resim kendi sunucumuzdaki kopyadır (yoksa nötr yer tutucu).
 */
export function VideoFacade({ video }: { video: DoctorShowcaseVideo }) {
  const { t } = useReviewStrings();
  const [playing, setPlaying] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const title = video.title?.trim() || video.alt?.trim() || t.videoFallbackTitle;
  const embedUrl = allowedUrl(video.embedUrl, EMBED_HOSTS);
  const thumbnailUrl = localThumbnail(video.thumbnailUrl);

  // Oynat düğmesi DOM'dan kalkınca odak kaybolmasın: iframe'e taşınır.
  useEffect(() => {
    if (playing) iframeRef.current?.focus();
  }, [playing]);

  if (!embedUrl) return null;

  return (
    <>
    <div className="relative aspect-video w-full overflow-hidden rounded-[var(--site-radius)] border border-border bg-black">
      {playing ? (
        <iframe
          ref={iframeRef}
          tabIndex={-1}
          src={withAutoplay(embedUrl)}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={fillReview(t.playVideoAria, { title })}
          className="group absolute inset-0 flex h-full w-full items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- kendi sunucumuzdaki küçük resim kopyası (medya kütüphanesi)
            <img src={thumbnailUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-[var(--site-secondary)] to-black" />
          )}
          <span className="absolute inset-0 bg-black/25 transition-colors duration-300 group-hover:bg-black/35" aria-hidden="true" />
          <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition-transform duration-300 group-hover:scale-110" aria-hidden="true">
            <Play className="h-6 w-6 fill-current rtl:-scale-x-100" />
          </span>
        </button>
      )}
    </div>
    {!playing && <p className="mt-1.5 text-xs text-foreground/50">{fillReview(t.videoPrivacyNote, { provider: video.videoProvider === "vimeo" ? "Vimeo" : "YouTube" })}</p>}
    </>
  );
}
