import { CACHE_TAGS } from "../cache-tags";
import { fetchServerJson } from "./server-fetch";
import type { BlogPost } from "./types";

/** Sunucu bileşenlerinden çağrılır — bkz. server-plans.ts'teki apiFetch kullanılmama gerekçesi. */
export async function fetchBlogPostsServer(locale?: string): Promise<BlogPost[]> {
  const query = locale ? `&locale=${encodeURIComponent(locale)}` : "";
  const json = await fetchServerJson<{ data: BlogPost[] }>(`/blog?limit=50${query}`, { tags: [CACHE_TAGS.blog] });
  return json?.data ?? [];
}

export async function fetchBlogPostBySlugServer(slug: string, locale?: string): Promise<BlogPost | null> {
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  const json = await fetchServerJson<{ data: BlogPost }>(`/blog/${slug}${query}`, { tags: [CACHE_TAGS.blog] });
  return json?.data ?? null;
}
