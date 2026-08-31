import type { VideoProvider } from "./types";

/**
 * §Faz "Medya & İnteraktif" — Video bloğu URL→embed dönüşümü. GÜVENLİK GEREĞİ: kullanıcının
 * girdiği ham `url` HİÇBİR ZAMAN doğrudan bir `<iframe src>`e YAZILMAZ. Bunun yerine buradaki
 * fonksiyonlar `url`den yalnızca alfasayısal bir VİDEO ID'si çıkarır (regex ile) ve embed URL'ini
 * SABİT, güvenilir bir sağlayıcı domaininden (youtube-nocookie.com / player.vimeo.com) KENDİLERİ
 * inşa eder — id regex'iyle eşleşmezse `null` döner (embed gösterilmez, hata fırlatılmaz).
 */

const YOUTUBE_ID_RE = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
const VIMEO_ID_RE = /vimeo\.com\/(?:video\/)?(\d+)/;

export function extractYouTubeId(url: string): string | null {
  return url.match(YOUTUBE_ID_RE)?.[1] ?? null;
}

export function extractVimeoId(url: string): string | null {
  return url.match(VIMEO_ID_RE)?.[1] ?? null;
}

/**
 * `mp4` sağlayıcısı için `null` döner — o durumda `<video src>` doğrudan (URL zaten backend'in
 *  güvenli-URL doğrulamasından geçmiş bir dosya bağlantısı) kullanılır, embed URL'i GEREKMEZ.
 *
 * `loop` — YENİ (mimar §2.6/R5). Sağlayıcıya göre FARKLI uygulanır: YouTube `loop=1` TEK BAŞINA
 * ÇALIŞMAZ, `playlist=<videoId>` de gerekir (aksi halde video yalnızca BİR KEZ döngüye girer);
 * Vimeo `loop=1` tek başına yeterlidir. `mp4` için bu fonksiyon zaten `null` döner — `loop`
 * `<video loop>` niteliğiyle çağıran taraf (`video-block.tsx`) tarafından uygulanır.
 */
export function getVideoEmbedUrl(
  provider: VideoProvider,
  url: string,
  options: { autoplay: boolean; muted: boolean; loop?: boolean }
): string | null {
  if (provider === "youtube") {
    const id = extractYouTubeId(url);
    if (!id) return null;
    const params = new URLSearchParams({ rel: "0" });
    if (options.autoplay) params.set("autoplay", "1");
    if (options.muted || options.autoplay) params.set("mute", "1");
    if (options.loop) {
      params.set("loop", "1");
      // YouTube embed API kısıtı: `loop=1` yalnızca `playlist` parametresi AYNI video id'sini
      // içerdiğinde tek video döngüsü yapar (bkz. fonksiyon başlığı).
      params.set("playlist", id);
    }
    return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
  }
  if (provider === "vimeo") {
    const id = extractVimeoId(url);
    if (!id) return null;
    const params = new URLSearchParams();
    if (options.autoplay) params.set("autoplay", "1");
    if (options.muted || options.autoplay) params.set("muted", "1");
    if (options.loop) params.set("loop", "1");
    return `https://player.vimeo.com/video/${id}${params.size > 0 ? `?${params.toString()}` : ""}`;
  }
  return null;
}
