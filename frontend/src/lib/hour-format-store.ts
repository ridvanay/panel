"use client";

import { useSyncExternalStore } from "react";

/**
 * Paket R — hastanın "12 saat / 24 saat" tercihi (saat dilimi seçicisinden değiştirilir). Tarayıcıda
 * saklanır; aynı sayfadaki tüm saat gösterimleri (bant, slotlar, özet) birlikte güncellenir.
 * Tercih yoksa `null` → biçim bölgeden çıkarılır (`country-display.ts::defaultHour12`).
 */
export const HOUR_FORMAT_STORAGE_KEY = "wm-hour-format";
export type HourFormatPreference = "12" | "24";

const listeners = new Set<() => void>();
let memory: HourFormatPreference | null | undefined;

function read(): HourFormatPreference | null {
  if (memory !== undefined) return memory;
  try {
    const value = window.localStorage.getItem(HOUR_FORMAT_STORAGE_KEY);
    memory = value === "12" || value === "24" ? value : null;
  } catch {
    memory = null;
  }
  return memory;
}

export function setHourFormatPreference(value: HourFormatPreference | null): void {
  memory = value;
  try {
    if (value) window.localStorage.setItem(HOUR_FORMAT_STORAGE_KEY, value);
    else window.localStorage.removeItem(HOUR_FORMAT_STORAGE_KEY);
  } catch {
    // Engelli depolama — tercih bu sayfa için geçerli kalır.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** SSR'da `null` (hidrasyon güvenli); istemcide saklı tercih. */
export function useHourFormatPreference(): HourFormatPreference | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

/** Testler için: bellek önbelleğini sıfırlar. */
export function resetHourFormatStoreForTests(): void {
  memory = undefined;
  for (const listener of listeners) listener();
}
