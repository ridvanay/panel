/**
 * Paket V — sayfa içindeki "Canlı destek" düğmeleri (destek bandı, uzmanlık koordinatör kutusu) sohbet
 * penceresini açar. Kendi sohbet bileşenimiz (`live-chat-widget.tsx`) bu olayı dinler; harici
 * sağlayıcılarda (Crisp, Tawk.to) onların kendi açma çağrısı kullanılır.
 */
export const OPEN_LIVE_CHAT_EVENT = "wm:open-live-chat";

type ChatWindow = Window & { $crisp?: unknown[]; Tawk_API?: { maximize?: () => void } };

/** Paket X — `context`: sohbetin hangi sayfa/paketten açıldığı (ör. paket adı). Kişisel/sağlık verisi verilmez. */
export interface OpenLiveChatDetail {
  context?: string;
}

export function openLiveChat(context?: string): void {
  const w = window as ChatWindow;
  if (Array.isArray(w.$crisp)) w.$crisp.push(["do", "chat:open"]);
  w.Tawk_API?.maximize?.();
  const detail: OpenLiveChatDetail = context ? { context: context.slice(0, 120) } : {};
  window.dispatchEvent(new CustomEvent<OpenLiveChatDetail>(OPEN_LIVE_CHAT_EVENT, { detail }));
}
