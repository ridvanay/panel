"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  FileText,
  Newspaper,
  BarChart3,
  Image as ImageIcon,
  Settings,
  LayoutGrid,
  LayoutTemplate,
  Users,
  Activity,
  Mail,
  ShieldCheck,
  ScrollText,
  Upload,
  FileArchive,
  Blocks,
  ShoppingBag,
  Receipt,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/admin/theme-toggle";
import { useAuth } from "@/context/auth-context";
import { useModules } from "@/context/modules-context";
import type { SiteRole } from "@/lib/api/types";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Verilmezse tüm rollere görünür. `/admin/import` gibi ADMIN-only uçlar için kullanılır
   *  (bkz. `notification-center.tsx`'teki `user.role !== "ADMIN"` deseniyle AYNI mantık). */
  roles?: SiteRole[];
  /**
   * Eklenti/Modül Yönetimi (Faz 1) — verilmezse item her zaman görünür. Verilirse, yalnızca
   * `MODULE_REGISTRY`'de KAYITLI ve `enabled: false` olan bir key item'ı gizler; kayıtsız
   * (henüz tanımlanmamış) key'ler `useModules().isModuleEnabled` üzerinden hep `true` döner.
   * Faz 1'de hiçbir mevcut item'a atanmaz — Products/Portfolio gibi sonraki fazlarda kullanılacak.
   */
  module?: string;
}

/**
 * Rol + modül filtresini birlikte uygular — `AdminSidebar`'dan ayrık, saf (pure) bir fonksiyon
 * olarak dışa açılır ki birim testlerde gerçek bileşeni (framer-motion/sidebar primitives)
 * render etmeden mantık doğrulanabilsin.
 */
export function filterVisibleNavItems(
  items: NavItem[],
  user: { role: SiteRole } | null,
  isModuleEnabled: (key: string) => boolean
): NavItem[] {
  return items.filter(
    (item) => (!item.roles || (user && item.roles.includes(user.role))) && (!item.module || isModuleEnabled(item.module))
  );
}

const navItems: NavItem[] = [
  { href: "/admin", label: "Genel Bakış", icon: LayoutDashboard },
  { href: "/admin/pages", label: "Sayfalar", icon: FileText },
  { href: "/admin/blog", label: "Blog", icon: Newspaper },
  { href: "/admin/products", label: "Ürünler", icon: ShoppingBag, module: "products" },
  { href: "/admin/orders", label: "Siparişler", icon: Receipt, module: "products" },
  { href: "/admin/stats", label: "İstatistikler", icon: BarChart3 },
  // `/admin/reports/exports/*` backend'de TAMAMEN ADMIN-only (bkz. reports.routes.ts) —
  // `/admin/import` ile AYNI `roles` deseni.
  { href: "/admin/reports", label: "Raporlar", icon: FileArchive, roles: ["ADMIN"] },
  { href: "/admin/media", label: "Medya", icon: ImageIcon },
  { href: "/admin/navigation", label: "Navigasyon", icon: LayoutTemplate },
  { href: "/admin/import", label: "İçe Aktar", icon: Upload, roles: ["ADMIN"] },
  { href: "/admin/users", label: "Kullanıcılar", icon: Users },
  { href: "/admin/system", label: "Sistem Sağlığı", icon: Activity },
  { href: "/admin/notifications/templates", label: "E-posta Şablonları", icon: Mail },
  { href: "/admin/settings/security", label: "Güvenlik", icon: ShieldCheck },
  { href: "/admin/logs", label: "Aktivite Günlükleri", icon: ScrollText },
  { href: "/admin/modules", label: "Modüller", icon: Blocks, roles: ["ADMIN"] },
  { href: "/admin/settings", label: "Ayarlar", icon: Settings },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { isModuleEnabled } = useModules();
  const visibleNavItems = filterVisibleNavItems(navItems, user, isModuleEnabled);

  return (
    <Sidebar className="border-sidebar-border">
      {/*
       * Tema-duyarlılık (2026-08-06, ui-designer kararı): sidebar artık hardcoded koyu hex'ler
       * yerine `globals.css`'teki shadcn `--sidebar*` token'larını (light: açık, `.dark
       * .admin-shell`: koyu — bkz. globals.css satır ~71-78 / ~220-227) kullanır. `ui/sidebar.tsx`
       * zaten `bg-sidebar`/`text-sidebar-foreground` uyguluyor; buradaki gradient de token'dan
       * türetiliyor (`color-mix`) böylece hem light hem dark temada doğru zeminden başlar.
       */}
      <div className="relative flex h-full flex-col overflow-hidden bg-[linear-gradient(to_bottom,var(--sidebar),color-mix(in_oklch,var(--sidebar)_92%,black)_55%,color-mix(in_oklch,var(--sidebar)_85%,black))] text-sidebar-foreground backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(var(--accent-rgb-500),0.28),transparent_50%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_100%,rgba(var(--accent-rgb-500),0.14),transparent_55%)]" />

        <SidebarHeader className="relative px-3 py-4">
          <Link
            href="/admin"
            className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-sidebar-accent"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(to_bottom_right,var(--accent-500),var(--accent-700))] text-white shadow-[0_0_20px_rgba(var(--accent-rgb-400),0.5)]">
              <LayoutGrid className="h-4 w-4" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-sidebar-foreground">Yönetim Paneli</span>
              <span className="text-xs text-sidebar-foreground/40">İçerik ve site yönetimi</span>
            </span>
          </Link>
        </SidebarHeader>

        <SidebarSeparator />

        <SidebarContent className="relative px-2 py-3">
          <SidebarGroup>
            <SidebarGroupLabel className="px-2 text-sidebar-foreground/35">Menü</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {visibleNavItems.map((item, index) => {
                  const active = item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <motion.div
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.04, duration: 0.25, ease: "easeOut" }}
                      >
                        <SidebarMenuButton
                          render={<Link href={item.href} />}
                          isActive={active}
                          className="group relative h-11 gap-3 overflow-hidden rounded-lg border border-transparent px-3 text-sidebar-foreground/55 transition-colors hover:text-sidebar-foreground data-active:border-sidebar-border data-active:text-sidebar-foreground md:h-8"
                        >
                          {active && (
                            <motion.span
                              layoutId="admin-sidebar-active-pill"
                              className="absolute inset-0 rounded-lg bg-sidebar-foreground/10 shadow-[0_0_18px_rgba(var(--accent-rgb-400),0.35)]"
                              transition={{ type: "spring", stiffness: 420, damping: 34 }}
                            />
                          )}
                          <item.icon className="relative h-4 w-4" />
                          <span className="relative">{item.label}</span>
                        </SidebarMenuButton>
                      </motion.div>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="relative space-y-2 px-3 py-3">
          <div className="flex items-center justify-between rounded-lg border border-sidebar-border bg-sidebar-foreground/5 px-2.5 py-2 text-xs text-sidebar-foreground/50">
            <span>Tema</span>
            <ThemeToggle variant="sidebar" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-sidebar-border bg-sidebar-foreground/5 px-2.5 py-2 text-xs text-sidebar-foreground/50">
            <span>Sürüm</span>
            <span className="rounded-full bg-[linear-gradient(to_right,var(--accent-500),var(--accent-700))] px-2 py-0.5 font-medium text-white shadow-[0_0_10px_rgba(var(--accent-rgb-400),0.45)]">
              v1.0
            </span>
          </div>
        </SidebarFooter>
      </div>
    </Sidebar>
  );
}
