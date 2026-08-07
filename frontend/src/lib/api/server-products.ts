import { API_BASE_URL } from "../env";
import type { Product } from "./types";

/** Sunucu bileşenlerinden çağrılır — bkz. server-blog.ts'teki apiFetch kullanılmama gerekçesi. */
export async function fetchProductsServer(): Promise<Product[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/products?limit=50`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const json = (await res.json()) as { data: Product[] };
    return json.data;
  } catch {
    return [];
  }
}

export async function fetchProductBySlugServer(slug: string): Promise<Product | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/products/${slug}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: Product };
    return json.data;
  } catch {
    return null;
  }
}
