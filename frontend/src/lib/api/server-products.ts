import { SERVER_API_BASE_URL } from "../env";
import type { Product } from "./types";

/** Sunucu bileşenlerinden çağrılır — bkz. server-blog.ts'teki apiFetch kullanılmama gerekçesi. */
export async function fetchProductsServer(locale?: string): Promise<Product[]> {
  try {
    const query = locale ? `&locale=${encodeURIComponent(locale)}` : "";
    const res = await fetch(`${SERVER_API_BASE_URL}/products?limit=50${query}`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const json = (await res.json()) as { data: Product[] };
    return json.data;
  } catch {
    return [];
  }
}

export async function fetchProductBySlugServer(slug: string, locale?: string): Promise<Product | null> {
  try {
    const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
    const res = await fetch(`${SERVER_API_BASE_URL}/products/${slug}${query}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: Product };
    return json.data;
  } catch {
    return null;
  }
}
