"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ConsentStrings } from "@/lib/i18n/site-dictionaries/types";
import {
  OPEN_CONSENT_PREFERENCES_EVENT,
  readConsent,
  saveConsent,
  type ConsentAction,
} from "@/lib/crm/consent";

/** `BackToTopButton` bu event'i dinler — aynı köşede (sağ alt) çakışmayı önlemek için
 *  banner görünürken butonu yukarı kaldırır (bkz. back-to-top-button.tsx). */
export const COOKIE_BANNER_VISIBILITY_EVENT = "cookie-consent-banner-visibility";

interface CookieConsentBannerProps {
  dict: ConsentStrings;
  policyHref: string | null;
  locale: string;
}

/**
 * Paket N (2026-10-23) — açık rızaya dayalı çerez bandı. Eski "gezinmeye devam ederek kabul" davranışı
 * KALDIRILDI (analitik için geçerli onay değildir). Üç seçenek: Tümünü kabul et / Tümünü reddet /
 * Tercihler. "Reddet" ile "Kabul et" AYNI görsel ağırlıkta (aynı sınıflar). Kategoriler: zorunlu (her
 * zaman açık), analitik (CRM takibi), pazarlama (gclid/Ads) — ikisi de varsayılan KAPALI.
 *
 * Footer'daki "Çerez tercihleri" bağlantısı `OPEN_CONSENT_PREFERENCES_EVENT` ile tercihler penceresini açar;
 * kullanıcı onayını oradan geri alabilir. Metinler site sözlüğünden (6 dil); yerleşim mantıksal
 * özelliklerle yazıldı, RTL'de (ar) ayna görüntüsü doğal olarak oluşur.
 */
export function CookieConsentBanner({ dict, policyHref, locale }: CookieConsentBannerProps) {
  // İlk render'da HER ZAMAN gizli (SSR/hydration uyumu) — client'ta hemen sonra localStorage kontrolü yapılır.
  const [visible, setVisible] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!readConsent()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount sonrası tek seferlik localStorage okuması (theme-toggle.tsx deseni)
      setVisible(true);
      window.dispatchEvent(new CustomEvent(COOKIE_BANNER_VISIBILITY_EVENT, { detail: { visible: true } }));
    }
    const open = () => {
      const current = readConsent();
      setAnalytics(current?.analytics ?? false);
      setMarketing(current?.marketing ?? false);
      setDialogOpen(true);
    };
    window.addEventListener(OPEN_CONSENT_PREFERENCES_EVENT, open);
    return () => window.removeEventListener(OPEN_CONSENT_PREFERENCES_EVENT, open);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialogOpen && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!dialogOpen && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [dialogOpen]);

  function decide(choice: { analytics: boolean; marketing: boolean }, action: ConsentAction) {
    saveConsent(choice, action, locale);
    setDialogOpen(false);
    if (visible) {
      setVisible(false);
      window.dispatchEvent(new CustomEvent(COOKIE_BANNER_VISIBILITY_EVENT, { detail: { visible: false } }));
    }
  }

  // Kabul ve Reddet BİREBİR aynı sınıf — hiçbiri öne çıkarılmaz (karanlık desen yok).
  const choiceButton =
    "inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-900 transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
  const dialogChoiceButton =
    "inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-100";

  return (
    <>
      {visible && (
        <div
          data-bottom-bar=""
          data-crm-ignore=""
          role="region"
          aria-label={dict.bannerTitle}
          className="fixed inset-x-0 bottom-0 z-50 bg-neutral-900 text-white shadow-lg"
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:gap-6">
            <div className="min-w-0 flex-1 text-start">
              <p className="text-sm font-semibold">{dict.bannerTitle}</p>
              <p className="mt-1 text-sm text-white/85">
                {dict.bannerText}{" "}
                {policyHref && (
                  <a href={policyHref} className="underline underline-offset-2 hover:text-white">
                    {dict.policyLink}
                  </a>
                )}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button type="button" className={choiceButton} onClick={() => decide({ analytics: false, marketing: false }, "REJECT_ALL")}>
                {dict.rejectAll}
              </button>
              <button type="button" className={choiceButton} onClick={() => decide({ analytics: true, marketing: true }, "ACCEPT_ALL")}>
                {dict.acceptAll}
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-white underline underline-offset-2 hover:text-white/80"
                onClick={() => {
                  setAnalytics(false);
                  setMarketing(false);
                  setDialogOpen(true);
                }}
              >
                {dict.preferences}
              </button>
            </div>
          </div>
        </div>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-crm-ignore=""
        onCancel={(event) => {
          event.preventDefault();
          setDialogOpen(false);
        }}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-black/50"
      >
        {dialogOpen && (
          <div className="space-y-4 p-5 text-start">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">
                {dict.dialogTitle}
              </h2>
              <p id={descId} className="mt-1 text-sm text-neutral-600">
                {dict.dialogDescription}
              </p>
            </div>

            <ul className="space-y-3">
              <ConsentRow title={dict.necessaryTitle} text={dict.necessaryText} checked disabled stateLabel={dict.alwaysOn} />
              <ConsentRow
                title={dict.analyticsTitle}
                text={dict.analyticsText}
                checked={analytics}
                onChange={(value) => {
                  setAnalytics(value);
                  if (!value) setMarketing(false);
                }}
              />
              <ConsentRow
                title={dict.marketingTitle}
                text={dict.marketingText}
                checked={marketing}
                disabled={!analytics}
                onChange={setMarketing}
              />
            </ul>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" className={dialogChoiceButton} onClick={() => decide({ analytics: false, marketing: false }, "REJECT_ALL")}>
                {dict.rejectAll}
              </button>
              <button type="button" className={dialogChoiceButton} onClick={() => decide({ analytics: true, marketing: true }, "ACCEPT_ALL")}>
                {dict.acceptAll}
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
                onClick={() => decide({ analytics, marketing: analytics && marketing }, "CUSTOM")}
              >
                {dict.save}
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
                onClick={() => setDialogOpen(false)}
              >
                {dict.close}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

function ConsentRow({
  title,
  text,
  checked,
  disabled,
  stateLabel,
  onChange,
}: {
  title: string;
  text: string;
  checked: boolean;
  disabled?: boolean;
  stateLabel?: string;
  onChange?: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <li className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="text-sm font-semibold">
          {title}
        </label>
        <p className="mt-0.5 text-xs text-neutral-600">{text}</p>
      </div>
      {stateLabel ? (
        <span className="shrink-0 text-xs font-medium text-neutral-500">
          <input id={id} type="checkbox" role="switch" checked readOnly disabled className="sr-only" />
          {stateLabel}
        </span>
      ) : (
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 accent-neutral-900 disabled:opacity-40"
        />
      )}
    </li>
  );
}
