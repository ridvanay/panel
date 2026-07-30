"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { DashboardNavbar } from "@/components/dashboard/dashboard-navbar";
import { Spinner } from "@/components/ui/spinner";

export default function DashboardLayout({ children }: { children: ReactNode }) {
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
    <div className="flex min-h-screen flex-col bg-surface-muted">
      <DashboardNavbar />
      <main className="flex-1">{children}</main>
    </div>
  );
}
