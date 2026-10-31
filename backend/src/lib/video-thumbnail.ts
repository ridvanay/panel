import type { FastifyInstance } from "fastify";
import { imageSize } from "image-size";
import { storage } from "./storage";
import { detectImageMimeType, extensionForMimeType } from "./mime-detect";

/**
 * Paket Y (kullanıcı kararı) — video küçük resmi, admin videoyu kaydettiğinde sunucuda BİR KEZ indirilip
 * mevcut Media modülüne kaydedilir; sitede yalnızca bu yerel kopya gösterilir. Böylece ziyaretçi "Oynat"a
 * basana kadar youtube / ytimg / vimeo alanlarına hiçbir istek gitmez.
 *
 * SSRF koruması: URL'ler yalnızca doğrulanmış video kimliğinden kurulur; yalnızca HTTPS ve izin listesindeki
 * alanlar (i.ytimg.com, i.vimeocdn.com, vumbnail.com; Vimeo oEmbed için vimeo.com) çağrılır; yönlendirme
 * yalnızca yine izin listesindeki bir alana izlenir; boyut (2 MB) ve süre (5 sn) sınırı; içerik türü
 * baytlardan doğrulanır (JPEG/PNG/WEBP; SVG yok). Başarısızlıkta `null` döner → sitede nötr yer tutucu.
 */
export const THUMBNAIL_IMAGE_HOSTS = new Set(["i.ytimg.com", "i.vimeocdn.com", "vumbnail.com"]);
const OEMBED_HOSTS = new Set(["vimeo.com"]);
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 2;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Yalnızca HTTPS + izin listesindeki alan; kullanıcı adı/parola ya da standart dışı port yok. */
export function isAllowedUrl(raw: string, hosts: Set<string>): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && hosts.has(url.hostname) && !url.username && !url.password && (url.port === "" || url.port === "443");
  } catch {
    return false;
  }
}

async function safeFetch(fetchImpl: FetchLike, url: string, hosts: Set<string>): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedUrl(current, hosts)) return null;
    const res = await fetchImpl(current, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "image/*,application/json" } });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      current = new URL(location, current).toString();
      continue;
    }
    return res.ok ? res : null;
  }
  return null;
}

async function readLimited(res: Response): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.byteLength > MAX_BYTES ? null : buf;
}

async function candidateUrls(fetchImpl: FetchLike, provider: string, videoId: string): Promise<string[]> {
  if (provider === "youtube" && YOUTUBE_ID.test(videoId)) return [`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`];
  if (provider === "vimeo" && VIMEO_ID.test(videoId)) {
    const urls: string[] = [];
    try {
      const res = await safeFetch(fetchImpl, `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${videoId}`)}&width=640`, OEMBED_HOSTS);
      const data = res ? ((await res.json()) as { thumbnail_url?: unknown }) : null;
      if (data && typeof data.thumbnail_url === "string" && isAllowedUrl(data.thumbnail_url, THUMBNAIL_IMAGE_HOSTS)) urls.push(data.thumbnail_url);
    } catch {
      // oEmbed başarısız → aşağıdaki statik adres denenir.
    }
    urls.push(`https://vumbnail.com/${videoId}.jpg`);
    return urls;
  }
  return [];
}

/** Küçük resmi indirip Media satırı olarak kaydeder; başarısızsa `null` (yer tutucu). */
export async function importVideoThumbnail(app: FastifyInstance, provider: string, videoId: string, fetchImpl: FetchLike = fetch): Promise<string | null> {
  try {
    for (const url of await candidateUrls(fetchImpl, provider, videoId)) {
      const res = await safeFetch(fetchImpl, url, THUMBNAIL_IMAGE_HOSTS);
      if (!res) continue;
      const buffer = await readLimited(res);
      if (!buffer) continue;
      const detected = detectImageMimeType(buffer);
      if (!detected.mimeType || detected.isSvg || !ALLOWED_IMAGE_TYPES.has(detected.mimeType)) continue;
      const filename = `video-thumb-${provider}-${videoId}${extensionForMimeType(detected.mimeType)}`;
      const saved = await storage.save({ buffer, filename, mimeType: detected.mimeType });
      let width: number | null = null;
      let height: number | null = null;
      try {
        const dim = imageSize(buffer);
        width = dim.width ?? null;
        height = dim.height ?? null;
      } catch {
        // boyut okunamadıysa null kalır
      }
      const media = await app.prisma.media.create({
        data: { path: saved.path, url: saved.url, filename, mimeType: detected.mimeType, sizeBytes: buffer.byteLength, width, height, altText: null },
      });
      return media.id;
    }
  } catch (err) {
    app.log.warn({ err: (err as Error).message, provider, videoId }, "Video küçük resmi indirilemedi; yer tutucu gösterilecek");
  }
  return null;
}
