"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ContactChannels } from "@/lib/api/server-contact-channels";

/**
 * Paket X — site düzeni (SSR) iletişim kanallarını bir kez çeker ve buradan dağıtır. `whatsapp` yalnızca yönetici
 * WhatsApp'ı açıp numara girdiyse doludur; null iken hiçbir WhatsApp düğmesi çizilmez.
 */
interface ContactChannelsValue extends ContactChannels {
  /** Canlı destek açık mı (`SiteSettings.liveChatEnabled`). */
  chatEnabled: boolean;
  /** Dil önekli iletişim sayfası ("Sizi arayalım" / form). */
  contactHref: string;
}

const ContactChannelsContext = createContext<ContactChannelsValue>({ whatsapp: null, chatEnabled: false, contactHref: "/contact" });

export function ContactChannelsProvider({ value, children }: { value: ContactChannelsValue; children: ReactNode }) {
  return <ContactChannelsContext.Provider value={value}>{children}</ContactChannelsContext.Provider>;
}

export function useContactChannels(): ContactChannelsValue {
  return useContext(ContactChannelsContext);
}
