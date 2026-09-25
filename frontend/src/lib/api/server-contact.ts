import { CACHE_TAGS } from "../cache-tags";
import { fetchServerJson } from "./server-fetch";
import type { ContactPageLocale, PublicContactPage, PublicContactForm } from "./types";

/**
 * Sunucu bileşenlerinden çağrılır — bkz. server-pages.ts'teki apiFetch kullanılmama gerekçesi.
 * `isEnabled=false` ise backend 404 döner; bu durumda `null` dönülür (istemci `notFound()` çağırır).
 */
export async function fetchPublicContactFormServer(): Promise<PublicContactForm | null> {
  const json = await fetchServerJson<{ data: PublicContactForm }>("/contact/form", { noStore: true });
  return json?.data ?? null;
}

/**
 * `/contact` sayfasının içeriği (dile göre) + onay metinleri. Form kapalıysa backend 404 → `null`
 * (sayfa `notFound()` çağırır). Admin kaydı site önbelleğini yeniler; ek olarak 60 sn ISR.
 */
export async function fetchContactPageServer(locale: ContactPageLocale): Promise<PublicContactPage | null> {
  const json = await fetchServerJson<{ data: PublicContactPage }>(`/contact/page?locale=${locale}`, { tags: [CACHE_TAGS.contactPage] });
  return json?.data ?? null;
}
