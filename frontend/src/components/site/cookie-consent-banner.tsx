"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "cookie-consent-accepted";
/** `BackToTopButton` bu event'i dinler — aynı köşede (sağ alt) çakışmayı önlemek için
 *  banner görünürken butonu yukarı kaldırır (bkz. back-to-top-button.tsx). */
export const COOKIE_BANNER_VISIBILITY_EVENT = "cookie-consent-banner-visibility";

// Admin formundaki `COOKIE_BANNER_TEXT_PLACEHOLDER` ile AYNI metin (bkz. admin/appearance/page.tsx).
const DEFAULT_TEXT =
  "Bu site deneyiminizi iyileştirmek için çerezler kullanır. Sitede gezinmeye devam ederek çerez kullanımını kabul etmiş olursunuz.";

interface CookieConsentBannerProps {
  text: string;
  policyHref: string | null;
}

export function CookieConsentBanner({ text, policyHref }: CookieConsentBannerProps) {
  // İlk render'da HER ZAMAN gizli (SSR/hydration uyumu) — client'ta hemen sonra localStorage kontrolü yapılır.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // SSR/hydration uyumu için ilk render'da her zaman gizli — localStorage kontrolü yalnızca
    // client'ta, mount sonrası bir kez senkron yapılabilir (theme-toggle.tsx'teki AYNI desen).
    if (window.localStorage.getItem(STORAGE_KEY) !== "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true);
      window.dispatchEvent(new CustomEvent(COOKIE_BANNER_VISIBILITY_EVENT, { detail: { visible: true } }));
    }
  }, []);

  if (!visible) return null;

  const handleAccept = () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
    window.dispatchEvent(new CustomEvent(COOKIE_BANNER_VISIBILITY_EVENT, { detail: { visible: false } }));
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 bg-[var(--site-secondary)] text-white shadow-lg">
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm text-white/90">
          {text || DEFAULT_TEXT}{" "}
          {policyHref && (
            <a href={policyHref} className="underline hover:text-white">
              Gizlilik Politikası
            </a>
          )}
        </p>
        <button
          type="button"
          onClick={handleAccept}
          aria-label="Çerez kullanımını kabul et"
          className="shrink-0 rounded-lg bg-[var(--site-button)] px-4 py-2 text-sm font-medium text-[var(--site-button-text)] transition-all duration-300 hover:opacity-85"
        >
          Kabul Et
        </button>
      </div>
    </div>
  );
}
