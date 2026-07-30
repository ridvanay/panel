"use client";

import { useAuth } from "@/context/auth-context";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function AdminTopbar() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
      <SidebarTrigger />

      <div className="flex items-center gap-3">
        <Avatar name={user.name} src={user.avatarUrl} size={28} />
        <span className="hidden text-sm text-foreground/80 sm:inline">{user.name}</span>
        <Button size="sm" variant="ghost" onClick={() => logout()}>
          Çıkış yap
        </Button>
      </div>
    </header>
  );
}
