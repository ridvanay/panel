"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "@/context/auth-context";
import { AccentProvider } from "@/context/accent-context";
import { CommandPaletteProvider } from "@/context/command-palette-context";
import { AdminSidebar } from "@/components/admin/sidebar";
import { AdminTopbar } from "@/components/admin/topbar";
import { AdminBreadcrumb } from "@/components/admin/breadcrumb";
import { CommandPalette } from "@/components/admin/command-palette";
import { KeyboardShortcutsModal } from "@/components/admin/keyboard-shortcuts-modal";
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
    <AccentProvider>
      <CommandPaletteProvider>
        <SidebarProvider className="admin-shell">
          <AdminSidebar />
          <SidebarInset>
            <AdminTopbar />
            <main className="flex-1 overflow-hidden bg-surface-muted p-4 md:p-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={pathname}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <AdminBreadcrumb pathname={pathname} />
                  {children}
                </motion.div>
              </AnimatePresence>
            </main>
          </SidebarInset>
          <CommandPalette />
          <KeyboardShortcutsModal />
        </SidebarProvider>
      </CommandPaletteProvider>
    </AccentProvider>
  );
}
