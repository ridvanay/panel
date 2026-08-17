import { describe, expect, it, vi } from "vitest";
import {
  assertCustomVariablesDoNotConflict,
  assertNoUndefinedVariables,
  extractPlaceholderKeys,
  getContactFieldVariables,
  getSystemVariablesForPurpose,
  resolveTemplateVariables,
} from "../../src/lib/email-variables";
import { ValidationError } from "../../src/lib/errors";

describe("getSystemVariablesForPurpose", () => {
  it("always includes the global variables (site_name/site_url)", () => {
    const keys = getSystemVariablesForPurpose("CUSTOM").map((v) => v.key);
    expect(keys).toEqual(["site_name", "site_url"]);
  });

  it("matches the exact WELCOME variable set relied upon by prisma/seed.ts + auth.service.ts", () => {
    const keys = getSystemVariablesForPurpose("WELCOME").map((v) => v.key);
    expect(keys).toEqual(["site_name", "site_url", "user_name", "login_url"]);
  });

  it("matches the exact PASSWORD_RESET variable set", () => {
    const keys = getSystemVariablesForPurpose("PASSWORD_RESET").map((v) => v.key);
    expect(keys).toContain("user_name");
    expect(keys).toContain("reset_link");
  });

  it("matches the exact ORDER_CONFIRMATION variable set relied upon by stripe.routes.ts", () => {
    const keys = getSystemVariablesForPurpose("ORDER_CONFIRMATION").map((v) => v.key);
    expect(keys).toEqual(expect.arrayContaining(["order_number", "customer_name", "items_summary", "total_formatted"]));
  });

  it("matches the exact ORG_INVITATION variable set relied upon by invitations.routes.ts", () => {
    const keys = getSystemVariablesForPurpose("ORG_INVITATION").map((v) => v.key);
    expect(keys).toEqual(expect.arrayContaining(["inviter_name", "organization_name", "accept_url"]));
  });
});

describe("getContactFieldVariables", () => {
  it("maps ContactFormField rows to source='contact-field' variable definitions", () => {
    const vars = getContactFieldVariables([{ key: "telefon", label: "Telefon", type: "PHONE" }]);
    expect(vars).toEqual([{ key: "telefon", label: "Telefon", sampleValue: expect.any(String), source: "contact-field" }]);
  });
});

describe("resolveTemplateVariables", () => {
  function fakeApp(fields: { key: string; label: string; type: string }[] = []) {
    return {
      prisma: { contactFormField: { findMany: vi.fn().mockResolvedValue(fields) } },
    } as unknown as import("fastify").FastifyInstance;
  }

  it("does not query ContactFormField for non-CONTACT_FORM_NOTIFICATION purposes", async () => {
    const app = fakeApp();
    const vars = await resolveTemplateVariables(app, "WELCOME", []);
    expect(app.prisma.contactFormField.findMany).not.toHaveBeenCalled();
    expect(vars.some((v) => v.key === "user_name")).toBe(true);
  });

  it("includes contact-field variables automatically for CONTACT_FORM_NOTIFICATION", async () => {
    const app = fakeApp([{ key: "telefon", label: "Telefon", type: "PHONE" }]);
    const vars = await resolveTemplateVariables(app, "CONTACT_FORM_NOTIFICATION", []);
    expect(vars.some((v) => v.key === "telefon" && v.source === "contact-field")).toBe(true);
    expect(vars.some((v) => v.key === "form_title")).toBe(true);
  });

  it("includes custom variables with source='custom'", async () => {
    const app = fakeApp();
    const vars = await resolveTemplateVariables(app, "CUSTOM", [{ key: "my_var", label: "Benim", sampleValue: "x" }]);
    expect(vars).toContainEqual({ key: "my_var", label: "Benim", sampleValue: "x", source: "custom" });
  });
});

describe("assertCustomVariablesDoNotConflict", () => {
  it("throws ValidationError with details.customVariables when a custom key collides with a system key", () => {
    expect(() => assertCustomVariablesDoNotConflict([{ key: "user_name", label: "x", sampleValue: "y" }], "WELCOME")).toThrow(ValidationError);
  });

  it("throws when the same custom key is defined twice", () => {
    expect(() =>
      assertCustomVariablesDoNotConflict(
        [
          { key: "dup", label: "a", sampleValue: "1" },
          { key: "dup", label: "b", sampleValue: "2" },
        ],
        "CUSTOM"
      )
    ).toThrow(ValidationError);
  });

  it("does not throw for a non-conflicting set", () => {
    expect(() => assertCustomVariablesDoNotConflict([{ key: "my_custom", label: "x", sampleValue: "y" }], "WELCOME")).not.toThrow();
  });
});

describe("extractPlaceholderKeys", () => {
  it("extracts ASCII keys", () => {
    expect(extractPlaceholderKeys("Merhaba {{user_name}}, {{reset_link}}")).toEqual(["user_name", "reset_link"]);
  });

  it("also extracts non-ASCII/Turkish-character keys (unlike template-render.ts's \\w-based pattern) — intentional, for validation purposes", () => {
    expect(extractPlaceholderKeys("{{çalışan_adı}}")).toEqual(["çalışan_adı"]);
  });

  it("returns an empty array when there are no placeholders", () => {
    expect(extractPlaceholderKeys("düz metin")).toEqual([]);
  });
});

describe("assertNoUndefinedVariables", () => {
  it("does not throw when all placeholders are allow-listed", () => {
    expect(() => assertNoUndefinedVariables(["Merhaba {{user_name}}"], new Set(["user_name"]))).not.toThrow();
  });

  it("throws ValidationError (details.blocks) when a placeholder is not in the allow-list", () => {
    try {
      assertNoUndefinedVariables(["Merhaba {{foo}}"], new Set(["user_name"]));
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).details?.blocks).toEqual(["Tanımsız değişken: {{foo}}"]);
    }
  });
});
