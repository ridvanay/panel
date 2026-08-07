import { API_BASE_URL } from "../env";
import type { PortfolioItem } from "./types";

/** Sunucu bileşenlerinden çağrılır — bkz. server-products.ts'teki apiFetch kullanılmama gerekçesi. */
export async function fetchPortfolioItemsServer(): Promise<PortfolioItem[]> {
  try {
    // Backend `orderBy: { order: "asc" }` ile döner (manuel sıralama) — burada TEKRAR sıralanmaz.
    const res = await fetch(`${API_BASE_URL}/portfolio?limit=50`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const json = (await res.json()) as { data: PortfolioItem[] };
    return json.data;
  } catch {
    return [];
  }
}

export async function fetchPortfolioItemBySlugServer(slug: string): Promise<PortfolioItem | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/portfolio/${slug}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: PortfolioItem };
    return json.data;
  } catch {
    return null;
  }
}
