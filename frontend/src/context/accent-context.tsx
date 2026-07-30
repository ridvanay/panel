"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ACCENT_COLORS, DEFAULT_ACCENT, type AccentColorKey, type AccentPalette } from "@/lib/accent-colors";

const STORAGE_KEY = "admin-accent-color";

interface AccentContextValue {
  accent: AccentColorKey;
  setAccent: (accent: AccentColorKey) => void;
  palette: AccentPalette;
}

const AccentContext = createContext<AccentContextValue | null>(null);

function isAccentColorKey(value: string | null): value is AccentColorKey {
  return !!value && Object.prototype.hasOwnProperty.call(ACCENT_COLORS, value);
}

export function AccentProvider({ children }: { children: ReactNode }) {
  const [accent, setAccent] = useState<AccentColorKey>(DEFAULT_ACCENT);

  useEffect(() => {
    // localStorage yalnızca istemcide mevcut; ilk client render'dan sonra bir kez okunur
    // (mount öncesi sunucu/istemci uyuşmazlığını önlemek için standart desen).
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isAccentColorKey(stored)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAccent(stored);
    }
  }, []);

  useEffect(() => {
    const palette = ACCENT_COLORS[accent];
    const root = document.documentElement;
    root.style.setProperty("--accent-300", palette[300]);
    root.style.setProperty("--accent-400", palette[400]);
    root.style.setProperty("--accent-500", palette[500]);
    root.style.setProperty("--accent-600", palette[600]);
    root.style.setProperty("--accent-700", palette[700]);
    root.style.setProperty("--accent-rgb-400", palette.rgb400);
    root.style.setProperty("--accent-rgb-500", palette.rgb500);
    window.localStorage.setItem(STORAGE_KEY, accent);
  }, [accent]);

  const value: AccentContextValue = {
    accent,
    setAccent,
    palette: ACCENT_COLORS[accent],
  };

  return <AccentContext value={value}>{children}</AccentContext>;
}

export function useAccent(): AccentContextValue {
  const ctx = useContext(AccentContext);
  if (!ctx) throw new Error("useAccent, <AccentProvider> içinde kullanılmalıdır.");
  return ctx;
}
