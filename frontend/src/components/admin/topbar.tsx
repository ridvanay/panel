"use client";

import { LogOut, Languages, Search } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { useAdminLocale, useT } from "@/context/i18n-context";
import { useCommandPalette } from "@/context/command-palette-context";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/admin/theme-toggle";
import { AccentColorPicker } from "@/components/admin/accent-color-picker";
import { NotificationCenter } from "@/components/admin/notification-center";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AdminLocale } from "@/lib/i18n/dictionaries";

const LOCALE_OPTIONS: { value: AdminLocale; label: string }[] = [
  { value: "tr", label: "🇹🇷 TR" },
  { value: "en", label: "🇬🇧 EN" },
];

function AdminLocaleSwitcher() {
  const { adminLocale, setAdminLocale } = useAdminLocale();
  const t = useT();
  const current = LOCALE_OPTIONS.find((option) => option.value === adminLocale) ?? LOCALE_OPTIONS[0]!;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" size="sm" aria-label={t("topbar.language")} />}
      >
        <Languages className="h-4 w-4" />
        <span className="hidden sm:inline">{current.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALE_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setAdminLocale(option.value)}
            className={option.value === adminLocale ? "font-medium" : undefined}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AdminTopbar() {
  const { user, logout } = useAuth();
  const { setOpen } = useCommandPalette();
  const t = useT();
  if (!user) return null;

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-surface/80 px-4 py-3 shadow-sm backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <SidebarTrigger />
        <button
          type="button"
          aria-label="Komut menüsünü aç"
          onClick={() => setOpen(true)}
          className="hidden h-8 w-64 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground/40 transition-colors hover:text-foreground/60 md:flex"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Ara...</span>
          <kbd className="rounded border border-input px-1.5 py-0.5 font-mono text-[10px] text-foreground/40">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-3">
        <AdminLocaleSwitcher />
        <ThemeToggle />
        <AccentColorPicker />
        <NotificationCenter />
        <Avatar name={user.name} src={user.avatarUrl} size={28} />
        <span className="hidden text-sm text-foreground/80 sm:inline">{user.name}</span>
        <Button size="sm" variant="ghost" onClick={() => logout()}>
          <LogOut />
          {t("topbar.logout")}
        </Button>
      </div>
    </header>
  );
}
