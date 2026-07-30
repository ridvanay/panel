"use client";

import { LogOut } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/admin/theme-toggle";
import { AccentColorPicker } from "@/components/admin/accent-color-picker";
import { NotificationCenter } from "@/components/admin/notification-center";

export function AdminTopbar() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-surface/80 px-4 py-3 shadow-sm backdrop-blur-xl">
      <SidebarTrigger />

      <div className="flex items-center gap-3">
        <ThemeToggle />
        <AccentColorPicker />
        <NotificationCenter />
        <Avatar name={user.name} src={user.avatarUrl} size={28} />
        <span className="hidden text-sm text-foreground/80 sm:inline">{user.name}</span>
        <Button size="sm" variant="ghost" onClick={() => logout()}>
          <LogOut />
          Çıkış yap
        </Button>
      </div>
    </header>
  );
}
