import { describe, expect, it } from "vitest";
import { canUseAdvancedBuilder } from "../../src/lib/builder-capability";

describe("canUseAdvancedBuilder (§10.20 §1.5)", () => {
  it("is always true for ADMIN, regardless of the stored flag", () => {
    expect(canUseAdvancedBuilder({ role: "ADMIN", advancedBuilderEnabled: false })).toBe(true);
    expect(canUseAdvancedBuilder({ role: "ADMIN", advancedBuilderEnabled: true })).toBe(true);
  });

  it("follows the stored flag for EDITOR", () => {
    expect(canUseAdvancedBuilder({ role: "EDITOR", advancedBuilderEnabled: false })).toBe(false);
    expect(canUseAdvancedBuilder({ role: "EDITOR", advancedBuilderEnabled: true })).toBe(true);
  });

  it("follows the stored flag for VIEWER (accepted but inert, §1.6)", () => {
    expect(canUseAdvancedBuilder({ role: "VIEWER", advancedBuilderEnabled: false })).toBe(false);
    expect(canUseAdvancedBuilder({ role: "VIEWER", advancedBuilderEnabled: true })).toBe(true);
  });
});
