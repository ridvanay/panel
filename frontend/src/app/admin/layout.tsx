"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "@/context/auth-context";
import { AccentProvider } from "@/context/accent-context";
import { ModulesProvider } from "@/context/modules-context";
import { CommandPaletteProvider } from "@/context/command-palette-context";
import { AdminSidebar } from "@/components/admin/sidebar";
import { AdminTopbar } from "@/components/admin/topbar";
import { AdminBreadcrumb } from "@/components/admin/breadcrumb";
import { CommandPalette } from "@/components/admin/command-palette";
import { KeyboardShortcutsModal } from "@/components/admin/keyboard-shortcuts-modal";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  // §10.21 §8.4 — gösterge paneli (`/admin`) `GET /admin/stats/*` çağırır ve EDITOR orada 403
  // alır (§5.3 satır 19: views/breakdown/live-visitors yalnızca ADMIN/MANAGER). EDITOR bu
  // rotaya HİÇ render edilmeden `/admin/blog`'a yönlendirilir — dashboard bileşenleri EDITOR
  // için hiç mount edilmez, gereksiz 403 gürültüsü üretilmez.
  useEffect(() => {
    if (status === "authenticated" && user?.role === "EDITOR" && pathname === "/admin") {
      router.replace("/admin/blog");
    }
  }, [status, user, pathname, router]);

  // Yönlendirme tamamlanana kadar (yukarıdaki effect) dashboard içeriğini/veri çekimini HİÇ
  // mount etme — `router.replace` bir sonraki render'a kadar `pathname`'i değiştirmez, bu
  // guard olmadan `AdminDashboardPage` en az bir kez render olup `/admin/stats/*` isteklerini
  // ateşlerdi.
  const redirectingEditorFromDashboard = status === "authenticated" && user?.role === "EDITOR" && pathname === "/admin";

  if (status !== "authenticated" || redirectingEditorFromDashboard) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </main>
    );
  }

  return (
    <AccentProvider>
      <ModulesProvider>
        <CommandPaletteProvider>
          <SidebarProvider className="admin-shell">
            <AdminSidebar />
            <SidebarInset>
              <AdminTopbar />
              {/* `overflow-hidden` (dikey eksende) `<main>`'i CSS spec'ine göre bir "scroll container"
                  yapıyordu — bu box GERÇEKTE hiç kaydırılmıyor (gerçek scroll `window` seviyesinde
                  oluyor), bu yüzden `position: sticky` alt elemanları (ör. page-builder üst araç
                  çubuğu) en yakın ata scroll container'a (bu `<main>`'e) bağlanıp fiilen static gibi
                  davranıyordu.
                  DİKKAT — `overflow-x-hidden` TEK BAŞINA YETERSİZ: CSS Overflow spec'inin "visible/
                  non-visible eşleşme" kuralı gereği (bir eksen 'visible' DEĞİLKEN diğeri 'visible'
                  ise, 'visible' olanın KULLANILAN değeri 'auto'ya zorlanır), `overflow-x: hidden` +
                  belirtilmemiş `overflow-y` (varsayılan 'visible') kombinasyonunda tarayıcı
                  `overflow-y`'nin kullanılan değerini YİNE 'auto' yapıyor — yani `<main>` YİNE bir
                  scroll container oluyor, sticky YİNE bozuk kalıyor (canlı tarayıcıda
                  `getComputedStyle` ile doğrulandı: `overflow-x-hidden` → `overflowY: "auto"`).
                  `overflow-x-clip` bu zorlamadan MUAF (kural yalnızca 'visible'ı hedefliyor, 'clip'i
                  DEĞİL) — `overflow-y` gerçekten 'visible' kalıyor, `<main>` hiçbir eksende scroll
                  container OLMUYOR, `sticky` doğru şekilde `window`'a bağlanıyor (doğrulandı). */}
              <main className="flex-1 overflow-x-clip bg-surface-muted p-4 md:p-6">
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
      </ModulesProvider>
    </AccentProvider>
  );
}
