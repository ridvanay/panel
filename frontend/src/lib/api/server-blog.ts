import { API_BASE_URL } from "../env";
import type { BlogPost } from "./types";

/** Sunucu bileşenlerinden çağrılır — bkz. server-plans.ts'teki apiFetch kullanılmama gerekçesi. */
export async function fetchBlogPostsServer(): Promise<BlogPost[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/blog?limit=50`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const json = (await res.json()) as { data: BlogPost[] };
    return json.data;
  } catch {
    return [];
  }
}

export async function fetchBlogPostBySlugServer(slug: string): Promise<BlogPost | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/blog/${slug}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: BlogPost };
    return json.data;
  } catch {
    return null;
  }
}
