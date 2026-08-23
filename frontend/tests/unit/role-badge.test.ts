import { describe, expect, it } from "vitest";
import { getRoleBadgeInfo } from "@/lib/role-badge";

/**
 * `.claude/architect-scope-rbac-5-tier.md` §1.2 — bağlayıcı TR etiket tablosu. Etiketler tek
 * kaynaktır (`role-badge.ts`) ve BAŞKA hiçbir ekranda farklı bir metinle tekrarlanmamalıdır.
 */
describe("getRoleBadgeInfo — §1.2 rol etiketleri", () => {
  it.each([
    ["ADMIN", "Süper Yönetici"],
    ["MANAGER", "Yönetici"],
    ["EDITOR", "Editör"],
    ["CUSTOMER", "Müşteri"],
    ["USER", "Standart Üye"],
  ] as const)("%s → \"%s\"", (role, label) => {
    expect(getRoleBadgeInfo({ role }).label).toBe(label);
  });

  it("yalnızca ADMIN solid rozet alır — geri kalan 4 rol soft", () => {
    expect(getRoleBadgeInfo({ role: "ADMIN" }).solid).toBe(true);
    for (const role of ["MANAGER", "EDITOR", "CUSTOMER", "USER"] as const) {
      expect(getRoleBadgeInfo({ role }).solid).toBe(false);
    }
  });
});
