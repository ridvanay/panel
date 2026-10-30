/**
 * Paket V — sayfa içindeki "Canlı destek" düğmeleri (destek bandı, uzmanlık koordinatör kutusu) sohbet
 * penceresini açar. Kendi sohbet bileşenimiz (`live-chat-widget.tsx`) bu olayı dinler; harici
 * sağlayıcılarda (Crisp, Tawk.to) onların kendi açma çağrısı kullanılır.
 */
export const OPEN_LIVE_CHAT_EVENT = "wm:open-live-chat";

type ChatWindow = Window & { $crisp?: unknown[]; Tawk_API?: { maximize?: () => void } };

export function openLiveChat(): void {
  const w = window as ChatWindow;
  if (Array.isArray(w.$crisp)) w.$crisp.push(["do", "chat:open"]);
  w.Tawk_API?.maximize?.();
  window.dispatchEvent(new CustomEvent(OPEN_LIVE_CHAT_EVENT));
}
