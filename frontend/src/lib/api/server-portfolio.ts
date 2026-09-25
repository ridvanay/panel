import { fetchServerJson } from "./server-fetch";
import type { PortfolioItem } from "./types";

/** Sunucu bileşenlerinden çağrılır — bkz. server-products.ts'teki apiFetch kullanılmama gerekçesi. */
export async function fetchPortfolioItemsServer(locale?: string): Promise<PortfolioItem[]> {
  // Backend `orderBy: { order: "asc" }` ile döner (manuel sıralama) — burada TEKRAR sıralanmaz.
  const query = locale ? `&locale=${encodeURIComponent(locale)}` : "";
  const json = await fetchServerJson<{ data: PortfolioItem[] }>(`/portfolio?limit=50${query}`);
  return json?.data ?? [];
}

export async function fetchPortfolioItemBySlugServer(slug: string, locale?: string): Promise<PortfolioItem | null> {
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  const json = await fetchServerJson<{ data: PortfolioItem }>(`/portfolio/${slug}${query}`);
  return json?.data ?? null;
}
