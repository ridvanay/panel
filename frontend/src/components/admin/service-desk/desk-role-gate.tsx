"use client";

import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/auth-context";

/**
 * Hizmet masası yönetim ekranları yalnızca ADMIN ve MANAGER içindir (EDITOR koordinatör olsa bile yalnızca "Görüşmelerim"i
 * kullanır). Bu bir kullanılabilirlik kapısıdır; sunucu her istekte bağımsız 403 verir.
 */
export function DeskRoleGate({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  if (status === "loading" || !user) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }
  if (user.role !== "ADMIN" && user.role !== "MANAGER") {
    return <EmptyState icon={ShieldAlert} title="Bu sayfaya erişim yetkiniz yok" description="Hizmet masası ayarları yalnızca yönetici ve müdür rollerine açıktır." />;
  }
  return <>{children}</>;
}
