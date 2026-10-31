import { describe, expect, it } from "vitest";
import { filterVisibleNavItems, navItems } from "@/components/admin/sidebar";
import type { SiteRole } from "@/lib/api/types";

/** Paket Y — "Hasta yorumları" yalnızca ADMIN/MANAGER; modül kapalıyken de gizli. */
const HREF = "/admin/telehealth/testimonials";

function visible(role: SiteRole, moduleEnabled = true): string[] {
  return filterVisibleNavItems(navItems, { role }, () => moduleEnabled).map((i) => i.href);
}

describe("Sidebar — Hasta yorumları", () => {
  it("ADMIN ve MANAGER görür", () => {
    expect(visible("ADMIN")).toContain(HREF);
    expect(visible("MANAGER")).toContain(HREF);
  });

  it("EDITOR ve INTERPRETER görmez", () => {
    expect(visible("EDITOR")).not.toContain(HREF);
    expect(visible("INTERPRETER" as SiteRole)).not.toContain(HREF);
  });

  it("telehealth modülü kapalıyken gizli", () => {
    expect(visible("ADMIN", false)).not.toContain(HREF);
  });
});
