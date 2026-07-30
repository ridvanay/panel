"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, Bell, ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as usersAdminApi from "@/lib/api/users-admin";
import * as logsApi from "@/lib/api/logs";
import type { AdminUser, AuditLog } from "@/lib/api/types";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

type CriticalStatus = "FAILURE" | "FORBIDDEN";

const CRITICAL_STATUS_CONFIG: Record<CriticalStatus, { icon: typeof AlertCircle; className: string }> = {
  FAILURE: { icon: AlertCircle, className: "text-danger" },
  FORBIDDEN: { icon: ShieldAlert, className: "text-amber-500" },
};

function isCriticalStatus(status: AuditLog["status"]): status is CriticalStatus {
  return status === "FAILURE" || status === "FORBIDDEN";
}

type LoadState = "idle" | "loading" | "loaded" | "error";

/**
 * Topbar için bildirim çanı + popover. SADECE ADMIN rolündeki kullanıcılara görünür —
 * `/admin/users` ve `/admin/logs` uçları backend'de ADMIN-only olduğu için EDITOR/VIEWER'a
 * gösterilse dahi veri çekilemez, gereksiz 403 üretmemek için hiç render edilmez.
 *
 * Veri, popover İLK açıldığında tek seferlik çekilir (bkz. `handleOpenChange` + `loadState`
 * "idle" kontrolü) — her render'da tekrar istek atılmaz.
 */
export function NotificationCenter() {
  const { user } = useAuth();

  const [loadState, setLoadState] = React.useState<LoadState>("idle");
  const [recentUsers, setRecentUsers] = React.useState<AdminUser[]>([]);
  const [criticalLogs, setCriticalLogs] = React.useState<AuditLog[]>([]);

  const loadNotifications = React.useCallback(async () => {
    setLoadState("loading");
    try {
      const [usersPage, logsPage] = await Promise.all([
        usersAdminApi.listAdminUsers(),
        logsApi.listAuditLogs({}),
      ]);
      // Backend `orderBy: {seq: "asc"}` (eskiden-yeniye) döndürüyor — "son kayıt olanlar"
      // için dizinin sonundan alıp en-yeniden-eskiye sıralıyoruz.
      setRecentUsers(usersPage.items.slice(-5).reverse());
      // Backend loglari zaten en-yeni-önce (desc) döndürüyor; sadece kritik olanları
      // (hatalı / izin reddedilen) client-side filtreleyip ilk 5'ini alıyoruz.
      setCriticalLogs(logsPage.items.filter((log) => isCriticalStatus(log.status)).slice(0, 5));
      setLoadState("loaded");
    } catch (err) {
      console.error("Bildirimler yüklenemedi:", err);
      setLoadState("error");
    }
  }, []);

  function handleOpenChange(open: boolean) {
    if (open && loadState === "idle") {
      void loadNotifications();
    }
  }

  // ADMIN olmayan kullanıcılar için hiçbir şey render etme, veri de çekme.
  if (!user || user.role !== "ADMIN") return null;

  const criticalCount = criticalLogs.length;

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Bildirim Merkezi"
            className="relative text-muted-foreground hover:text-foreground"
          />
        }
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {loadState === "loaded" && criticalCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-danger"
            aria-hidden="true"
          />
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        {loadState === "loading" && (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            Yükleniyor...
          </div>
        )}

        {loadState === "error" && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">Bildirimler yüklenemedi.</div>
        )}

        {loadState === "loaded" && (
          <div className="divide-y divide-border">
            <section className="p-2">
              <p className="px-1.5 py-1 text-xs font-medium text-muted-foreground">Yeni Kullanıcılar</p>
              {recentUsers.length === 0 ? (
                <p className="px-1.5 py-2 text-xs text-foreground/50">Şu an bildirim yok.</p>
              ) : (
                <ul className="space-y-0.5">
                  {recentUsers.map((recentUser) => (
                    <li key={recentUser.id} className="flex items-center gap-2 rounded-md px-1.5 py-1.5">
                      <Avatar name={recentUser.name} src={recentUser.avatarUrl} size={28} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{recentUser.name}</p>
                        <p className="truncate text-xs text-foreground/50">{recentUser.email}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href="/admin/users"
                className="mt-1 block px-1.5 py-1 text-xs font-medium text-primary hover:underline"
              >
                Tüm kullanıcıları gör
              </Link>
            </section>

            <section className="p-2">
              <p className="px-1.5 py-1 text-xs font-medium text-muted-foreground">Kritik Loglar</p>
              {criticalLogs.length === 0 ? (
                <p className="px-1.5 py-2 text-xs text-foreground/50">Şu an bildirim yok.</p>
              ) : (
                <ul className="space-y-0.5">
                  {criticalLogs.map((log) => {
                    const config = CRITICAL_STATUS_CONFIG[log.status as CriticalStatus];
                    const Icon = config.icon;
                    return (
                      <li key={log.id} className="flex items-start gap-2 rounded-md px-1.5 py-1.5">
                        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", config.className)} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{log.action}</p>
                          <p className="truncate text-xs text-foreground/50">
                            {log.actorEmail ?? "Sistem"} · {formatDate(log.createdAt)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Link
                href="/admin/logs"
                className="mt-1 block px-1.5 py-1 text-xs font-medium text-primary hover:underline"
              >
                Tüm logları gör
              </Link>
            </section>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
