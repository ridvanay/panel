import { SERVER_API_BASE_URL } from "../env";

/** Periyodik yedek yenileme — asıl tazeleme admin kaydındaki etiket/path yenilemesidir. */
export const SERVER_FETCH_REVALIDATE_SECONDS = 60;

/**
 * Backend 404 DIŞINDA başarısız döndü (429, 5xx) — "bulunamadı" DEĞİL, geçici bir hatadır.
 * Fırlatılır ki Next.js bu render'ı önbelleğe ALMASIN: önbellekte eski sayfa varsa o sunulmaya
 * devam eder, yoksa `(site)/error.tsx` gösterilir. Eskiden bu durumda `null`/`[]`/varsayılanlar
 * dönülüyordu → 429'da `notFound()` veya logosuz sayfa 60 sn önbellekte kalıyordu.
 */
export class ServerFetchError extends Error {
  constructor(
    readonly status: number,
    readonly path: string
  ) {
    super(`Backend ${status} döndü: ${path}`);
    this.name = "ServerFetchError";
  }
}

interface ServerFetchOptions {
  /** Admin kaydında yenilenecek önbellek etiketleri (bkz. `lib/cache-tags.ts`). */
  tags?: string[];
  /** Hiç önbelleklenmeyen istekler (form durumu vb.). */
  noStore?: boolean;
  /** Ham gövdeye JSON.parse ÖNCESİ uygulanır (ör. `toInternalMediaUrl`). */
  transformText?: (text: string) => string;
}

/**
 * Sunucu bileşenleri için ortak backend okuması: YALNIZCA gerçek 404'te `null` döner; diğer
 * başarısız yanıtlar ve ağ hataları fırlatır. Next.js yalnızca 200 yanıtları veri önbelleğine yazar.
 */
export async function fetchServerJson<T>(path: string, options: ServerFetchOptions = {}): Promise<T | null> {
  const init: RequestInit = options.noStore
    ? { cache: "no-store" }
    : { next: { revalidate: SERVER_FETCH_REVALIDATE_SECONDS, ...(options.tags?.length ? { tags: options.tags } : {}) } };
  const res = await fetch(`${SERVER_API_BASE_URL}${path}`, init);
  if (res.status === 404) return null;
  if (!res.ok) throw new ServerFetchError(res.status, path);
  const text = await res.text();
  return JSON.parse(options.transformText ? options.transformText(text) : text) as T;
}

/**
 * Build sırasında önceden üretilen rotalar (`sitemap.xml`, `robots.txt` — statik + `revalidate`)
 * için: Docker imajı derlenirken backend'e ulaşılamaz. YALNIZCA `next build` aşamasında hata
 * `fallback`'e çevrilir (değişiklik öncesi build davranışı); çalışma zamanında fırlatır ki
 * başarısız yeniden üretim önbellekteki eski sürümün üzerine yazılmasın.
 */
export async function withBuildTimeFallback<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (process.env.NEXT_PHASE === "phase-production-build") return fallback;
    throw err;
  }
}
