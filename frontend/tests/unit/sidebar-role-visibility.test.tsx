import { describe, expect, it } from "vitest";
import { filterVisibleNavItems, navItems } from "@/components/admin/sidebar";
import type { SiteRole } from "@/lib/api/types";

/**
 * `.claude/architect-scope-rbac-5-tier.md` §8.2 — bağlayıcı sidebar görünürlük tablosu için
 * regresyon testi. `isModuleEnabled` her zaman `true` döner — bu test yalnızca ROL eksenini
 * doğrular, modül aç/kapa eksenini DEĞİL (bkz. `sidebar-module-filter.test.tsx`).
 */
function visibleHrefsFor(role: SiteRole, canHostMeetings?: boolean): string[] {
  return filterVisibleNavItems(navItems, { role, canHostMeetings }, () => true).map((item) => item.href);
}

function visibleCoordinatorHrefs(role: SiteRole, isServiceCoordinator: boolean | undefined): string[] {
  return filterVisibleNavItems(navItems, { role, isServiceCoordinator }, () => true).map((item) => item.href);
}

describe("AdminSidebar — §8.2 rol görünürlük tablosu", () => {
  it("ADMIN sidebar'daki HER öğeyi görür (koordinatöre özel Görüşmelerim hariç; Toplantılar bayrak açıkken ADMIN'e görünür)", () => {
    const visible = visibleHrefsFor("ADMIN");
    expect(visible).toEqual(navItems.map((item) => item.href).filter((href) => href !== "/admin/my-consultations"));
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

  // AG İş 3 — EXTERNAL_MEETINGS_ENABLED varsayılanı açık: "Toplantılar" ADMIN'e ve canHostMeetings yetkilisine görünür
  // (kapalı durum `external-meetings-flag-off.test.tsx`, ayrıntılı kurallar `sidebar-external-meetings-flag-on.test.tsx` içinde).
  it("Toplantılar: varsayılan bayrak açık — ADMIN ve yetkili kullanıcı görür, yetkisiz MANAGER/EDITOR görmez", () => {
    expect(visibleHrefsFor("ADMIN")).toContain("/admin/meetings");
    for (const role of ["MANAGER", "EDITOR"] as const) {
      expect(visibleHrefsFor(role, true), role).toContain("/admin/meetings");
      expect(visibleHrefsFor(role, false), role).not.toContain("/admin/meetings");
    }
  });

  // AI İş 3 — Hizmet Masası (ADMIN/MANAGER) ve Görüşmelerim (isServiceCoordinator, rolden bağımsız).
  it("Hizmet Masası: ADMIN ve MANAGER görür, EDITOR görmez", () => {
    expect(visibleHrefsFor("ADMIN")).toContain("/admin/service-desk");
    expect(visibleHrefsFor("MANAGER")).toContain("/admin/service-desk");
    expect(visibleHrefsFor("EDITOR")).not.toContain("/admin/service-desk");
    expect(visibleCoordinatorHrefs("EDITOR", true)).not.toContain("/admin/service-desk");
  });

  it("Görüşmelerim: yalnızca isServiceCoordinator olanlara görünür; EDITOR-koordinatör görür, EDITOR-değil görmez", () => {
    expect(visibleCoordinatorHrefs("EDITOR", true)).toContain("/admin/my-consultations");
    expect(visibleCoordinatorHrefs("EDITOR", false)).not.toContain("/admin/my-consultations");
    expect(visibleCoordinatorHrefs("EDITOR", undefined)).not.toContain("/admin/my-consultations");
    expect(visibleCoordinatorHrefs("MANAGER", true)).toContain("/admin/my-consultations");
    expect(visibleCoordinatorHrefs("ADMIN", false)).not.toContain("/admin/my-consultations");
    expect(filterVisibleNavItems(navItems, null, () => true).map((i) => i.href)).not.toContain("/admin/my-consultations");
  });

  it("EDITOR-koordinatör: Görüşmelerim eklenir, personel PII/yönetim öğeleri (randevular) hâlâ GİZLİ", () => {
    const visible = visibleCoordinatorHrefs("EDITOR", true);
    expect(visible).toContain("/admin/my-consultations");
    expect(visible).not.toContain("/admin/telehealth/appointments");
    expect(visible).not.toContain("/admin/users");
  });

  // K10b — mali/iş verisi analitik paneli, randevular İLE AYNI eşik (ADMIN/MANAGER), EDITOR'e KAPALI.
  it("Tele-Sağlık Özeti (analytics overview): ADMIN/MANAGER'da görünür, EDITOR'de GİZLİ", () => {
    expect(visibleHrefsFor("ADMIN")).toContain("/admin/telehealth/overview");
    expect(visibleHrefsFor("MANAGER")).toContain("/admin/telehealth/overview");
    expect(visibleHrefsFor("EDITOR")).not.toContain("/admin/telehealth/overview");
  });

  it("EDITOR için 'Sayfalar' öğesi 'Sayfalar (Salt İçerik Düzenleme)' etiketine eşlenir (roleLabelKeys)", () => {
    const pagesItem = navItems.find((item) => item.href === "/admin/pages")!;
    expect(pagesItem.roleLabelKeys?.EDITOR).toBe("nav.pagesEditorOnly");
    // ADMIN/MANAGER için override YOKTUR — varsayılan `nav.pages` etiketi kullanılır.
    expect(pagesItem.roleLabelKeys?.ADMIN).toBeUndefined();
    expect(pagesItem.roleLabelKeys?.MANAGER).toBeUndefined();
  });
});
