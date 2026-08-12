"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { dictionaries, type AdminLocale } from "@/lib/i18n/dictionaries";

const STORAGE_KEY = "adminLocale";

interface I18nContextValue {
  adminLocale: AdminLocale;
  setAdminLocale: (locale: AdminLocale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function isAdminLocale(value: string | null): value is AdminLocale {
  return value === "tr" || value === "en";
}

/** Admin panel arayüz dili (sidebar/topbar) — `localStorage`'da kalıcı, routing gerektirmez. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [adminLocale, setAdminLocaleState] = useState<AdminLocale>("tr");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isAdminLocale(stored)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- next-themes benzeri, localStorage istemciye özel
      setAdminLocaleState(stored);
    }
  }, []);

  const setAdminLocale = useCallback((locale: AdminLocale) => {
    setAdminLocaleState(locale);
    window.localStorage.setItem(STORAGE_KEY, locale);
  }, []);

  const value = useMemo(() => ({ adminLocale, setAdminLocale }), [adminLocale, setAdminLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useAdminLocale(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useAdminLocale must be used within an I18nProvider");
  return ctx;
}

/**
 * `t("nav.pages")` gibi anahtar tabanlı çeviri erişimi. Anahtar sözlükte yoksa anahtarın
 * kendisini döner. `params` verilirse şablondaki `{ad}` yer tutucuları değiştirilir
 * (ör. `t("content.deleted", { count: 3 })` → sözlükte `"{count} içerik silindi"`).
 */
export function useT() {
  const { adminLocale } = useAdminLocale();
  return useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const template = dictionaries[adminLocale][key] ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match
      );
    },
    [adminLocale]
  );
}
