"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  LayoutDashboard,
  FileText,
  Newspaper,
  BarChart3,
  Image as ImageIcon,
  Settings,
  PlusCircle,
  FilePlus2,
  Search,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandPalette } from "@/context/command-palette-context";
import { useT } from "@/context/i18n-context";

type PaletteItem = {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  keywords?: string[];
};

/**
 * `sidebar.tsx`'teki `navItems` ile birebir aynı liste (referans alındı, o dosyaya dokunulmadı).
 * Etiketler `t()` üzerinden çözümlenir (sözlük anahtarları `nav.*`/`commandPalette.*`).
 */
const pageItems: PaletteItem[] = [
  { href: "/admin", labelKey: "nav.overview", icon: LayoutDashboard },
  { href: "/admin/pages", labelKey: "nav.pages", icon: FileText },
  { href: "/admin/blog", labelKey: "nav.blog", icon: Newspaper },
  { href: "/admin/stats", labelKey: "nav.stats", icon: BarChart3 },
  { href: "/admin/media", labelKey: "nav.media", icon: ImageIcon },
  { href: "/admin/settings", labelKey: "nav.settings", icon: Settings },
  { href: "/admin/account", labelKey: "commandPalette.myAccount", icon: User, keywords: ["profil", "şifre", "avatar"] },
];

const quickActionItems: PaletteItem[] = [
  { href: "/admin/blog/new", labelKey: "commandPalette.newBlogPost", icon: PlusCircle, keywords: ["blog", "yazı", "yeni"] },
  { href: "/admin/pages/new", labelKey: "commandPalette.newPage", icon: FilePlus2, keywords: ["sayfa", "yeni"] },
];

const itemClassName =
  "flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground/70 outline-none transition-colors data-[selected=true]:bg-muted data-[selected=true]:text-foreground";

const groupClassName =
  "px-2 pb-2 [&_[cmdk-group-heading]]:px-1 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-foreground/40";

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const [search, setSearch] = useState("");
  const router = useRouter();
  const t = useT();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [setOpen]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) setSearch("");
    },
    [setOpen]
  );

  const runCommand = useCallback(
    (href: string) => {
      handleOpenChange(false);
      router.push(href);
    },
    [handleOpenChange, router]
  );

  return (
    <Command.Dialog
      open={open}
      onOpenChange={handleOpenChange}
      label={t("commandPalette.label")}
      loop
      overlayClassName="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      contentClassName={cn(
        "fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="h-4 w-4 shrink-0 text-foreground/40" />
        <Command.Input
          value={search}
          onValueChange={setSearch}
          autoFocus
          placeholder={t("commandPalette.placeholder")}
          className="h-12 w-full bg-transparent text-sm text-foreground placeholder:text-foreground/40 outline-none focus:ring-0"
        />
      </div>

      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-foreground/50">
          {t("commandPalette.noResults")}
        </Command.Empty>

        <Command.Group heading={t("commandPalette.pagesGroup")} className={groupClassName}>
          {pageItems.map((item) => {
            const label = t(item.labelKey);
            return (
              <Command.Item
                key={item.href}
                value={label}
                keywords={[item.href, ...(item.keywords ?? [])]}
                onSelect={() => runCommand(item.href)}
                className={itemClassName}
              >
                <item.icon className="h-4 w-4 shrink-0 text-foreground/50" />
                <span>{label}</span>
              </Command.Item>
            );
          })}
        </Command.Group>

        <Command.Group heading={t("commandPalette.quickActionsGroup")} className={groupClassName}>
          {quickActionItems.map((item) => {
            const label = t(item.labelKey);
            return (
              <Command.Item
                key={item.href}
                value={label}
                keywords={[item.href, ...(item.keywords ?? [])]}
                onSelect={() => runCommand(item.href)}
                className={itemClassName}
              >
                <item.icon className="h-4 w-4 shrink-0 text-primary" />
                <span>{label}</span>
              </Command.Item>
            );
          })}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
