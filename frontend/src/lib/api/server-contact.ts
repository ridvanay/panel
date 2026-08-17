import { SERVER_API_BASE_URL } from "../env";
import type { PublicContactForm } from "./types";

/**
 * Sunucu bileşenlerinden çağrılır — bkz. server-pages.ts'teki apiFetch kullanılmama gerekçesi.
 * `isEnabled=false` ise backend 404 döner; bu durumda `null` dönülür (istemci `notFound()` çağırır).
 */
export async function fetchPublicContactFormServer(): Promise<PublicContactForm | null> {
  try {
    const res = await fetch(`${SERVER_API_BASE_URL}/contact/form`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: PublicContactForm };
    return json.data;
  } catch {
    return null;
  }
}
