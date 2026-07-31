"use client";

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

/**
 * `CommandPalette`'in açık/kapalı durumunu paylaşır — hem `Cmd/Ctrl+K` klavye kısayolu
 * hem topbar'daki "Ara..." butonu aynı state'i tetikleyebilsin diye.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <CommandPaletteContext value={{ open, setOpen }}>{children}</CommandPaletteContext>;
}

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette, <CommandPaletteProvider> içinde kullanılmalıdır.");
  return ctx;
}
