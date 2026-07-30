"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { AdminSidebar } from "@/components/admin/sidebar";
import { AdminTopbar } from "@/components/admin/topbar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  if (status !== "authenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </main>
    );
  }

  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset>
        <AdminTopbar />
        <main className="flex-1 bg-surface-muted p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
