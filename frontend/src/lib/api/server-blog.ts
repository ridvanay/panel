import { SERVER_API_BASE_URL } from "../env";
import type { BlogPost } from "./types";

/** Sunucu bileşenlerinden çağrılır — bkz. server-plans.ts'teki apiFetch kullanılmama gerekçesi. */
export async function fetchBlogPostsServer(locale?: string): Promise<BlogPost[]> {
  try {
    const query = locale ? `&locale=${encodeURIComponent(locale)}` : "";
    const res = await fetch(`${SERVER_API_BASE_URL}/blog?limit=50${query}`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const json = (await res.json()) as { data: BlogPost[] };
    return json.data;
  } catch {
    return [];
  }
}

export async function fetchBlogPostBySlugServer(slug: string, locale?: string): Promise<BlogPost | null> {
  try {
    const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
    const res = await fetch(`${SERVER_API_BASE_URL}/blog/${slug}${query}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: BlogPost };
    return json.data;
  } catch {
    return null;
  }
}
