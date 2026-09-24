"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

const SCROLL_THRESHOLD = 400;

/**
 * Sağ alt köşe. Konum ortak mekanizmayla hesaplanır: alta sabit bir çubuk (çerez bildirimi,
 * randevu/sepet çubuğu — bkz. `bottom-bar-inset.tsx`) varsa onun üstüne, iPhone güvenli alanı
 * kadar yukarı çıkar; canlı sohbet düğmesi aynı (sağ) köşedeyse onun da üstüne yığılır
 * (`--site-chat-stack-right`, bkz. `live-chat-widget.tsx`).
 */
export function BackToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => setVisible(window.scrollY > SCROLL_THRESHOLD);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label="Yukarı çık"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      style={{
        bottom: "calc(1.5rem + var(--site-bottom-inset, 0px) + var(--site-chat-stack-right, 0px) + env(safe-area-inset-bottom, 0px))",
      }}
      className={`fixed right-6 z-40 flex size-10 items-center justify-center rounded-full bg-[var(--site-button)] text-[var(--site-button-text)] shadow-lg transition-all duration-300 ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
      }`}
    >
      <ArrowUp className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
