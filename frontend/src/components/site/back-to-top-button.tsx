"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { COOKIE_BANNER_VISIBILITY_EVENT } from "@/components/site/cookie-consent-banner";

const SCROLL_THRESHOLD = 400;

export function BackToTopButton() {
  const [visible, setVisible] = useState(false);
  // Çerez bandı (aynı köşede, `fixed inset-x-0 bottom-0`, daha yüksek z-index) açıkken bu
  // butonun üstünü tamamen kapatıp tıklanamaz hale getiriyordu — bandın görünürlüğüne göre
  // butonu yukarı kaldırıyoruz (bkz. cookie-consent-banner.tsx'teki event).
  const [cookieBannerVisible, setCookieBannerVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => setVisible(window.scrollY > SCROLL_THRESHOLD);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    const handleCookieBannerVisibility = (event: Event) => {
      setCookieBannerVisible((event as CustomEvent<{ visible: boolean }>).detail.visible);
    };
    window.addEventListener(COOKIE_BANNER_VISIBILITY_EVENT, handleCookieBannerVisibility);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener(COOKIE_BANNER_VISIBILITY_EVENT, handleCookieBannerVisibility);
    };
  }, []);

  return (
    <button
      type="button"
      aria-label="Yukarı çık"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={`fixed right-6 z-40 flex size-10 items-center justify-center rounded-full bg-[var(--site-button)] text-[var(--site-button-text)] shadow-lg transition-all duration-300 ${
        cookieBannerVisible ? "bottom-24 sm:bottom-20" : "bottom-6"
      } ${visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}
    >
      <ArrowUp className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
