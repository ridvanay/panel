import { CACHE_TAGS } from "../cache-tags";
import { fetchServerJson } from "./server-fetch";
import type { BlogPost, PublicBlogDetail, PublicBlogPreviewDetail, PublicBlogList, PublicBlogReviewerItem, PublicBlogTopicGroup } from "./types";

/**
 * Sunucu bileşenlerinden çağrılır — bkz. server-plans.ts'teki apiFetch kullanılmama gerekçesi.
 * Paket Z1 — `all: true` (sitemap/llms): 100 yazı tek istekte sığmaz; imleçle TÜM yayındaki yazılar okunur
 * (üst sınır 20 sayfa × 100, güvenlik freni).
 */
export async function fetchBlogPostsServer(locale?: string, options: { all?: boolean } = {}): Promise<BlogPost[]> {
  const localeQuery = locale ? `&locale=${encodeURIComponent(locale)}` : "";
  if (!options.all) {
    const json = await fetchServerJson<{ data: BlogPost[] }>(`/blog?limit=50${localeQuery}`, { tags: [CACHE_TAGS.blog] });
    return json?.data ?? [];
  }
  const all: BlogPost[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i += 1) {
    const cursorQuery: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const json: { data: BlogPost[]; meta?: { nextCursor?: string | null } } | null = await fetchServerJson(`/blog?limit=100${localeQuery}${cursorQuery}`, { tags: [CACHE_TAGS.blog] });
    if (!json) break;
    all.push(...json.data);
    cursor = json.meta?.nextCursor ?? null;
    if (!cursor) break;
  }
  return all;
}

export interface BlogListQuery {
  locale?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  topic?: string | undefined;
  q?: string | undefined;
}

const EMPTY_LIST: PublicBlogList = { items: [], total: 0, page: 1, pageSize: 12, featured: null };

/** Paket Z1 — `GET /blog/posts` (filtre + arama + sayfalama). 404'te boş liste. */
export async function fetchBlogListServer(query: BlogListQuery): Promise<PublicBlogList> {
  const params = new URLSearchParams();
  if (query.locale) params.set("locale", query.locale);
  params.set("page", String(query.page ?? 1));
  params.set("pageSize", String(query.pageSize ?? 12));
  if (query.topic) params.set("topic", query.topic);
  if (query.q) params.set("q", query.q);
  const json = await fetchServerJson<{ data: PublicBlogList }>(`/blog/posts?${params.toString()}`, { tags: [CACHE_TAGS.blog] });
  return json?.data ?? { ...EMPTY_LIST, page: query.page ?? 1 };
}

/** Paket Z1 — `GET /blog/topics` (uzmanlık grupları + konu sayıları). */
export async function fetchBlogTopicsServer(locale?: string): Promise<PublicBlogTopicGroup[]> {
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  const json = await fetchServerJson<{ data: PublicBlogTopicGroup[] }>(`/blog/topics${query}`, { tags: [CACHE_TAGS.blog] });
  return json?.data ?? [];
}

/**
 * Paket Z1 — `GET /blog/posts/:slug`. Taslak, silinmiş ya da O DİLDE çevirisi olmayan yazı 404 → `null`
 * (çağıran `notFound()` çağırır; eski `/blog/:slug` kanonik metne düşerdi, bu uç düşmez).
 */
export async function fetchBlogDetailServer(slug: string, locale?: string): Promise<PublicBlogDetail | null> {
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  const json = await fetchServerJson<{ data: PublicBlogDetail }>(`/blog/posts/${encodeURIComponent(slug)}${query}`, { tags: [CACHE_TAGS.blog] });
  return json?.data ?? null;
}

/**
 * Paket Z1-ek - `GET /blog/reviewers` (en az bir yaziyi onaylamis, herkese acik hekimler).
 * Uc henuz yoksa (404) ya da gecici hata olursa bos liste: sayfa "onayli hekim yok" cumlesini gosterir.
 */
export async function fetchBlogReviewersServer(locale?: string): Promise<PublicBlogReviewerItem[]> {
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  try {
    const json = await fetchServerJson<{ data: { items: PublicBlogReviewerItem[] } }>(`/blog/reviewers${query}`, { tags: [CACHE_TAGS.blog] });
    return json?.data?.items ?? [];
  } catch {
    return [];
  }
}

/**
 * Taslak önizleme — `GET /blog/preview/:postId?t=`. Önbelleğe ALINMAZ (`no-store`); belirteç yok/geçersiz/
 * süresi dolmuş/iptal edilmiş ya da yazı bulunamadı → 404 → `null` (çağıran `notFound()` çağırır).
 */
export async function fetchBlogPreviewServer(postId: string, token: string, locale?: string): Promise<PublicBlogPreviewDetail | null> {
  const query = `?t=${encodeURIComponent(token)}${locale ? `&locale=${encodeURIComponent(locale)}` : ""}`;
  const json = await fetchServerJson<{ data: PublicBlogPreviewDetail }>(`/blog/preview/${encodeURIComponent(postId)}${query}`, { noStore: true });
  return json?.data ?? null;
}
