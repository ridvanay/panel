import { describe, expect, it } from "vitest";
import { UpdateEmailTemplateRequestSchema } from "../../src/modules/email-templates/email-templates.schemas";

/**
 * qa-agent bulgusu (2026-08-17) — `isActive` alanı şema seviyesinde KABUL EDİLMELİDİR (route
 * handler'da `purpose=CUSTOM` kısıtı uygulanır, bkz. email-templates.routes.ts). Bu test yalnızca
 * şemanın alanı hiç REDDETMEDİĞİNİ doğrular; purpose bazlı 422 kuralı route seviyesinde olduğundan
 * ayrı bir integration testte (email-templates-custom-lifecycle.test.ts) doğrulanır.
 */
describe("UpdateEmailTemplateRequestSchema", () => {
  it("accepts an isActive boolean field", () => {
    const result = UpdateEmailTemplateRequestSchema.safeParse({ isActive: false });
    expect(result.success).toBe(true);
    expect(result.success && result.data.isActive).toBe(false);
  });

  it("still allows isActive to be entirely omitted (unrelated PATCH fields untouched)", () => {
    const result = UpdateEmailTemplateRequestSchema.safeParse({ name: "x" });
    expect(result.success).toBe(true);
    expect(result.success && result.data.isActive).toBeUndefined();
  });

  it("rejects a non-boolean isActive value", () => {
    const result = UpdateEmailTemplateRequestSchema.safeParse({ isActive: "yes" });
    expect(result.success).toBe(false);
  });
});
