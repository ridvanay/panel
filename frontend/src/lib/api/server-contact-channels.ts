import { CACHE_TAGS } from "../cache-tags";
import { fetchServerJson } from "./server-fetch";

/** Paket X — WhatsApp yalnızca açık VE numara girilmişse dolu gelir; aksi halde null (düğmeler hiç çizilmez). */
export interface ContactChannels {
  whatsapp: { number: string; message: string } | null;
}

export async function fetchContactChannelsServer(locale?: string): Promise<ContactChannels> {
  try {
    const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
    const json = await fetchServerJson<{ data: ContactChannels }>(`/contact-channels${query}`, { tags: [CACHE_TAGS.contactChannels] });
    return json?.data ?? { whatsapp: null };
  } catch {
    // Telehealth modülü kapalıysa (404) ya da geçici hata: WhatsApp gösterilmez, diğer kanallar çalışır.
    return { whatsapp: null };
  }
}
