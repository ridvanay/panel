"use client";

import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export function DashboardNavbar() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/dashboard" className="text-sm font-semibold text-foreground">
          SaaS Platform
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/account"
            className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground/80 hover:bg-surface-muted hover:text-foreground"
          >
            <Avatar name={user.name} src={user.avatarUrl} size={28} />
            <span className="hidden sm:inline">{user.name}</span>
          </Link>
          <Button size="sm" variant="ghost" onClick={() => logout()}>
            Çıkış yap
          </Button>
        </div>
      </div>
    </header>
  );
}
