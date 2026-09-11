import { describe, expect, it } from "vitest";
import { filterVisibleNavItems, navItems } from "@/components/admin/sidebar";
import type { SiteRole } from "@/lib/api/types";

/**
 * `.claude/architect-scope-rbac-5-tier.md` §8.2 — bağlayıcı sidebar görünürlük tablosu için
 * regresyon testi. `isModuleEnabled` her zaman `true` döner — bu test yalnızca ROL eksenini
 * doğrular, modül aç/kapa eksenini DEĞİL (bkz. `sidebar-module-filter.test.tsx`).
 */
function visibleHrefsFor(role: SiteRole): string[] {
  return filterVisibleNavItems(navItems, { role }, () => true).map((item) => item.href);
}

describe("AdminSidebar — §8.2 rol görünürlük tablosu", () => {
  it("ADMIN sidebar'daki HER öğeyi görür", () => {
    const visible = visibleHrefsFor("ADMIN");
    expect(visible).toEqual(navItems.map((item) => item.href));
  });

  it("MANAGER: Kullanıcılar/Ayarlar/Sistem Sağlığı/Loglar/İçe Aktarma GİZLİ, geri kalan panel operasyonu görünür", () => {
    const visible = visibleHrefsFor("MANAGER");

    for (const hidden of ["/admin/import", "/admin/users", "/admin/system", "/admin/logs", "/admin/settings"]) {
      expect(visible).not.toContain(hidden);
    }
    for (const shown of [
      "/admin",
      "/admin/pages",
      "/admin/blog",
      "/admin/products",
      "/admin/orders",
      "/admin/portfolio",
      "/admin/stats",
      "/admin/reports",
      "/admin/media",
      "/admin/navigation",
      "/admin/appearance",
      "/admin/notifications/templates",
      "/admin/contact",
      "/admin/settings/security",
      "/admin/modules",
    ]) {
      expect(visible).toContain(shown);
    }
  });

  it("EDITOR: Sayfalar/Blog/Medya/Güvenlik + TeleHealth doktor/uzmanlık kataloğu (salt-okunur) görünür, randevular (PII) GİZLİ", () => {
    const visible = visibleHrefsFor("EDITOR");

    expect(visible.sort()).toEqual(
      [
        "/admin/pages",
        "/admin/blog",
        "/admin/media",
        "/admin/settings/security",
        "/admin/telehealth/doctors",
        "/admin/telehealth/specialties",
      ].sort()
    );

    // §8.4 (telehealth architect scope) — hasta PII'si taşıyan randevular EDITOR'e
    // hiçbir koşulda görünmez/erişilemez olmalı (veri minimizasyonu, security-agent onaylı).
    expect(visible).not.toContain("/admin/telehealth/appointments");
  });

  it("EDITOR için 'Sayfalar' öğesi 'Sayfalar (Salt İçerik Düzenleme)' etiketine eşlenir (roleLabelKeys)", () => {
    const pagesItem = navItems.find((item) => item.href === "/admin/pages")!;
    expect(pagesItem.roleLabelKeys?.EDITOR).toBe("nav.pagesEditorOnly");
    // ADMIN/MANAGER için override YOKTUR — varsayılan `nav.pages` etiketi kullanılır.
    expect(pagesItem.roleLabelKeys?.ADMIN).toBeUndefined();
    expect(pagesItem.roleLabelKeys?.MANAGER).toBeUndefined();
  });
});
