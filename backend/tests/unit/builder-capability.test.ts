import { describe, expect, it } from "vitest";
import { canUseAdvancedBuilder } from "../../src/lib/builder-capability";

describe("canUseAdvancedBuilder (.claude/architect-scope-rbac-5-tier.md §3)", () => {
  it("is true for ADMIN — saf rol türevi", () => {
    expect(canUseAdvancedBuilder({ role: "ADMIN" })).toBe(true);
  });

  it("is false for every non-ADMIN role (MANAGER, EDITOR, CUSTOMER, USER)", () => {
    expect(canUseAdvancedBuilder({ role: "MANAGER" })).toBe(false);
    expect(canUseAdvancedBuilder({ role: "EDITOR" })).toBe(false);
    expect(canUseAdvancedBuilder({ role: "CUSTOMER" })).toBe(false);
    expect(canUseAdvancedBuilder({ role: "USER" })).toBe(false);
  });
});
