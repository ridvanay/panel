/**
 * Paket Y — video bağlantısından sağlayıcı + kimlik ayıklama (admin formu).
 * Desteklenen: youtu.be/ID, youtube.com/watch?v=ID, youtube.com/embed|shorts|live/ID, vimeo.com/ID,
 * player.vimeo.com/video/ID. Çıplak kimlik de kabul edilir (11 karakter = YouTube, rakam = Vimeo).
 * Kurallar backend `DoctorMediaBodySchema` ile aynıdır (YouTube 11 karakter, Vimeo 6-12 rakam).
 */
export type VideoProvider = "youtube" | "vimeo";
export interface VideoRef {
  provider: VideoProvider;
  videoId: string;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;

export function isValidVideoId(provider: VideoProvider, id: string): boolean {
  return provider === "youtube" ? YOUTUBE_ID.test(id) : VIMEO_ID.test(id);
}

export function extractVideoRef(input: string, hint?: VideoProvider): VideoRef | null {
  const value = input.trim();
  if (!value) return null;

  if (!/[/.]/.test(value)) {
    if (hint && isValidVideoId(hint, value)) return { provider: hint, videoId: value };
    if (VIMEO_ID.test(value) && hint !== "youtube") return { provider: "vimeo", videoId: value };
    if (YOUTUBE_ID.test(value) && hint !== "vimeo") return { provider: "youtube", videoId: value };
    return null;
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    const id = parts[0] ?? "";
    return YOUTUBE_ID.test(id) ? { provider: "youtube", videoId: id } : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    const fromQuery = url.searchParams.get("v");
    if (fromQuery && YOUTUBE_ID.test(fromQuery)) return { provider: "youtube", videoId: fromQuery };
    if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0]) && YOUTUBE_ID.test(parts[1])) {
      return { provider: "youtube", videoId: parts[1] };
    }
    return null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = [...parts].reverse().find((p) => VIMEO_ID.test(p));
    return id ? { provider: "vimeo", videoId: id } : null;
  }
  return null;
}
