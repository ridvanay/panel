import { describe, expect, it, vi } from "vitest";
import { filterVisibleNavItems, navItems } from "@/components/admin/sidebar";
import type { SiteRole } from "@/lib/api/types";

/**
 * Paket AG İş 3 — "Toplantılar" menü kuralları, genel harici toplantı özelliği AÇIKKEN (AI İş 3 hızlı sürümde bayrak
 * kapalıdır; bu dosya bayrağı yalnızca test içinde açar, böylece AG davranışı korunur).
 */
vi.mock("@/lib/feature-flags", () => ({ EXTERNAL_MEETINGS_ENABLED: true }));

function visibleHrefsFor(role: SiteRole, canHostMeetings?: boolean): string[] {
  return filterVisibleNavItems(navItems, { role, canHostMeetings }, () => true).map((item) => item.href);
}

describe("AdminSidebar — Toplantılar (bayrak açık)", () => {
  it("yalnızca ADMIN ve canHostMeetings yetkilisi görür", () => {
    expect(visibleHrefsFor("ADMIN")).toContain("/admin/meetings");
    for (const role of ["MANAGER", "EDITOR"] as const) {
      expect(visibleHrefsFor(role), role).not.toContain("/admin/meetings");
      expect(visibleHrefsFor(role, false), role).not.toContain("/admin/meetings");
      expect(visibleHrefsFor(role, true), role).toContain("/admin/meetings");
    }
  });

  it("telehealth modülü kapalıysa yetkili kullanıcıda bile gizlenir; kullanıcı yoksa gizli", () => {
    expect(filterVisibleNavItems(navItems, { role: "EDITOR", canHostMeetings: true }, (key) => key !== "telehealth").map((i) => i.href)).not.toContain("/admin/meetings");
    expect(filterVisibleNavItems(navItems, null, () => true).map((i) => i.href)).not.toContain("/admin/meetings");
  });
});
