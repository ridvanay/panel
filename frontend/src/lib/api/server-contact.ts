import { SERVER_API_BASE_URL } from "../env";
import type { ContactPageLocale, PublicContactPage, PublicContactForm } from "./types";

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

/**
 * `/contact` sayfasının içeriği (dile göre) + onay metinleri. Form kapalıysa backend 404 → `null`
 * (sayfa `notFound()` çağırır). Admin kaydı site önbelleğini yeniler; ek olarak 60 sn ISR.
 */
export async function fetchContactPageServer(locale: ContactPageLocale): Promise<PublicContactPage | null> {
  try {
    const res = await fetch(`${SERVER_API_BASE_URL}/contact/page?locale=${locale}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: PublicContactPage };
    return json.data;
  } catch {
    return null;
  }
}
