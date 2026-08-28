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
  Briefcase,
  Palette,
  MessageSquare,
  GalleryHorizontal,
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
import { useT } from "@/context/i18n-context";
import type { SiteRole } from "@/lib/api/types";

export interface NavItem {
  href: string;
  /** `nav.*` sözlük anahtarı — sabit Türkçe string DEĞİL (bkz. `lib/i18n/dictionaries/nav.ts`). */
  labelKey: string;
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
  /**
   * §10.21 §8.2 — bazı roller AYNI rotayı farklı bir etiketle görür (item gizlenmez, sadece
   * metni değişir). Bugün tek örnek: `/admin/pages` için EDITOR "Sayfalar (Salt İçerik
   * Düzenleme)" görür (blok yapısı EDITOR'e kapalı — bkz. `page-template-guard`).
   */
  roleLabelKeys?: Partial<Record<SiteRole, string>>;
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

// `.claude/architect-scope-rbac-5-tier.md` §8.2 — bağlayıcı tablo. Yalnızca ADMIN/MANAGER/
// EDITOR panele girebildiği için (`requirePanelAccess`), burada rol filtresi CUSTOMER/USER'ı
// AYRICA saymaz — sunucu zaten onları kapıda 403'ler; bu liste sadece ADMIN/MANAGER/EDITOR
// arasındaki GÖRÜNÜRLÜK farkını ifade eder (gizleme kullanılabilirlik amaçlıdır, güvenlik
// önlemi DEĞİLDİR — sunucu her istekte bağımsız karar verir).
// `filterVisibleNavItems` ile AYNI gerekçeyle dışa açılır — §8.2 tablosuna karşı doğrudan
// (bileşeni render etmeden) birim testi yazılabilsin diye (bkz. tests/unit/sidebar-role-visibility.test.tsx).
export const navItems: NavItem[] = [
  // §8.4 — EDITOR girişte /admin/blog'a yönlendirilir, gösterge paneli EDITOR için hiç render
  // edilmez (GET /admin/stats/* 403 verir) — bu yüzden sidebar'da da EDITOR'e gösterilmez.
  { href: "/admin", labelKey: "nav.overview", icon: LayoutDashboard, roles: ["ADMIN", "MANAGER"] },
  {
    href: "/admin/pages",
    labelKey: "nav.pages",
    icon: FileText,
    roleLabelKeys: { EDITOR: "nav.pagesEditorOnly" },
  },
  { href: "/admin/blog", labelKey: "nav.blog", icon: Newspaper },
  { href: "/admin/products", labelKey: "nav.products", icon: ShoppingBag, module: "products", roles: ["ADMIN", "MANAGER"] },
  { href: "/admin/orders", labelKey: "nav.orders", icon: Receipt, module: "products", roles: ["ADMIN", "MANAGER"] },
  { href: "/admin/portfolio", labelKey: "nav.portfolio", icon: Briefcase, module: "portfolio", roles: ["ADMIN", "MANAGER"] },
  { href: "/admin/stats", labelKey: "nav.stats", icon: BarChart3, roles: ["ADMIN", "MANAGER"] },
  // `/admin/reports/exports/*` backend'de SiteRole=ADMIN VEYA MANAGER (§5.3 satır 16).
  { href: "/admin/reports", labelKey: "nav.reports", icon: FileArchive, roles: ["ADMIN", "MANAGER"] },
  { href: "/admin/media", labelKey: "nav.media", icon: ImageIcon },
  { href: "/admin/navigation", labelKey: "nav.navigation", icon: LayoutTemplate, roles: ["ADMIN", "MANAGER"] },
  // Hero Studio (Gelişmiş Slider) — §1.7 architect-scope-advanced-slider.md: yazma ADMIN/MANAGER'a
  // kapalı, EDITOR yalnızca `GET /admin/sliders*` okur (page-builder blok seçicisi için) — bu tam
  // yönetim ekranına sidebar bağlantısı `/admin/navigation` ile AYNI görünürlük kuralını izler.
  { href: "/admin/sliders", labelKey: "nav.sliders", icon: GalleryHorizontal, roles: ["ADMIN", "MANAGER"] },
  // Özel CSS/JS sekmesi (yalnızca ADMIN) sayfanın İÇİNDEDİR — sidebar seviyesinde ayrıştırma
  // gerekmez, `/admin/appearance` sayfasının kendisi MANAGER'a görünür kalmalı (§8.2).
  { href: "/admin/appearance", labelKey: "nav.appearance", icon: Palette, roles: ["ADMIN", "MANAGER"] },
  { href: "/admin/import", labelKey: "nav.import", icon: Upload, roles: ["ADMIN"] },
  { href: "/admin/users", labelKey: "nav.users", icon: Users, roles: ["ADMIN"] },
  { href: "/admin/system", labelKey: "nav.system", icon: Activity, roles: ["ADMIN"] },
  { href: "/admin/notifications/templates", labelKey: "nav.emailTemplates", icon: Mail, roles: ["ADMIN", "MANAGER"] },
  { href: "/admin/contact", labelKey: "nav.contact", icon: MessageSquare, roles: ["ADMIN", "MANAGER"] },
  // Self-servis 2FA/oturumlar (§4.3 istisnası) — panele giren 3 rolün hepsine açık.
  { href: "/admin/settings/security", labelKey: "nav.security", icon: ShieldCheck },
  { href: "/admin/logs", labelKey: "nav.logs", icon: ScrollText, roles: ["ADMIN"] },
  // `PATCH /admin/modules/:key` ADMIN-only ama `GET` ADMIN+MANAGER (§5.3 satır 18) —
  // MANAGER item'ı salt-okunur görünümle görür (sayfanın kendisi PATCH'i ADMIN'e kilitler).
  { href: "/admin/modules", labelKey: "nav.modules", icon: Blocks, roles: ["ADMIN", "MANAGER"] },
  { href: "/admin/settings", labelKey: "nav.settings", icon: Settings, roles: ["ADMIN"] },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { isModuleEnabled } = useModules();
  const t = useT();
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
              <span className="text-sm font-semibold text-sidebar-foreground">{t("nav.brandTitle")}</span>
              <span className="text-xs text-sidebar-foreground/40">{t("nav.brandSubtitle")}</span>
            </span>
          </Link>
        </SidebarHeader>

        <SidebarSeparator />

        <SidebarContent className="relative px-2 py-3">
          <SidebarGroup>
            <SidebarGroupLabel className="px-2 text-sidebar-foreground/35">{t("nav.menu")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {visibleNavItems.map((item, index) => {
                  const active = item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
                  const labelKey = (user && item.roleLabelKeys?.[user.role]) || item.labelKey;
                  const label = t(labelKey);
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
                          {/* §5 metin genişlemesi — EN/DE etiketleri kırpılır, sarma (wrap) YOK (design-notes-i18n.md §5). */}
                          <span className="relative min-w-0 flex-1 truncate" title={label}>
                            {label}
                          </span>
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
            <span>{t("nav.theme")}</span>
            <ThemeToggle variant="sidebar" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-sidebar-border bg-sidebar-foreground/5 px-2.5 py-2 text-xs text-sidebar-foreground/50">
            <span>{t("nav.version")}</span>
            <span className="rounded-full bg-[linear-gradient(to_right,var(--accent-500),var(--accent-700))] px-2 py-0.5 font-medium text-white shadow-[0_0_10px_rgba(var(--accent-rgb-400),0.45)]">
              v1.0
            </span>
          </div>
        </SidebarFooter>
      </div>
    </Sidebar>
  );
}
