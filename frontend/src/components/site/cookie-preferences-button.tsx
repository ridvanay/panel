"use client";

import { openConsentPreferences } from "@/lib/crm/consent";

/** Paket N — footer'daki "Çerez tercihleri": onay bandının tercihler penceresini açar (onayı geri alma yolu). */
export function CookiePreferencesButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={openConsentPreferences} className="text-sm text-foreground/60 underline-offset-2 hover:text-[var(--site-link)] hover:underline">
      {label}
    </button>
  );
}
