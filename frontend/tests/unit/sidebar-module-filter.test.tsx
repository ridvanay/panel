import { describe, expect, it } from "vitest";
import { LayoutDashboard } from "lucide-react";
import { filterVisibleNavItems, type NavItem } from "@/components/admin/sidebar";
import type { SiteRole } from "@/lib/api/types";

function makeUser(role: SiteRole) {
  return { role };
}

describe("filterVisibleNavItems — modül filtresi", () => {
  it("registry'de KAYITLI OLMAYAN bir module key'ine sahip item HER ZAMAN görünür kalır", () => {
    const items: NavItem[] = [{ href: "/admin/unknown", label: "Bilinmeyen", icon: LayoutDashboard, module: "unknown-key" }];
    // isModuleEnabled kayıtsız key için her zaman true döner — ModulesProvider'ın gerçek davranışı.
    const isModuleEnabled = () => true;

    const visible = filterVisibleNavItems(items, makeUser("ADMIN"), isModuleEnabled);
    expect(visible).toHaveLength(1);
  });

  it("registry'de kayıtlı ve enabled:false olan bir modülün item'ı gizlenir", () => {
    const items: NavItem[] = [{ href: "/admin/products", label: "Ürünler", icon: LayoutDashboard, module: "products" }];
    const isModuleEnabled = (key: string) => key !== "products";

    const visible = filterVisibleNavItems(items, makeUser("ADMIN"), isModuleEnabled);
    expect(visible).toHaveLength(0);
  });

  it("registry'de kayıtlı ve enabled:true olan bir modülün item'ı görünür", () => {
    const items: NavItem[] = [{ href: "/admin/products", label: "Ürünler", icon: LayoutDashboard, module: "products" }];
    const isModuleEnabled = () => true;

    const visible = filterVisibleNavItems(items, makeUser("ADMIN"), isModuleEnabled);
    expect(visible).toHaveLength(1);
  });

  it("module alanı olmayan item'lar isModuleEnabled hiç çağrılmadan görünür kalır", () => {
    const items: NavItem[] = [{ href: "/admin/pages", label: "Sayfalar", icon: LayoutDashboard }];
    let called = false;
    const isModuleEnabled = () => {
      called = true;
      return false;
    };

    const visible = filterVisibleNavItems(items, makeUser("EDITOR"), isModuleEnabled);
    expect(visible).toHaveLength(1);
    expect(called).toBe(false);
  });

  it("rol ve modül filtreleri birlikte uygulanır", () => {
    const items: NavItem[] = [
      { href: "/admin/modules", label: "Modüller", icon: LayoutDashboard, roles: ["ADMIN"] },
      { href: "/admin/products", label: "Ürünler", icon: LayoutDashboard, module: "products" },
    ];
    const isModuleEnabled = (key: string) => key !== "products";

    // EDITOR: "Modüller" rol filtresine takılır, "Ürünler" modül filtresine takılır → hiçbiri görünmez.
    const visibleForEditor = filterVisibleNavItems(items, makeUser("EDITOR"), isModuleEnabled);
    expect(visibleForEditor).toHaveLength(0);

    // ADMIN: "Modüller" rol şartını geçer, "Ürünler" yine modül filtresine takılır → yalnızca "Modüller" görünür.
    const visibleForAdmin = filterVisibleNavItems(items, makeUser("ADMIN"), isModuleEnabled);
    expect(visibleForAdmin.map((item) => item.href)).toEqual(["/admin/modules"]);
  });
});
