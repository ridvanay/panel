import { describe, expect, it } from "vitest";
import { EMAIL_PURPOSE_LABEL, EMAIL_PURPOSES } from "@/lib/email-blocks/purpose-labels";

describe("EMAIL_PURPOSE_LABEL", () => {
  it("EMAIL_PURPOSES listesindeki her amaç için bir Türkçe etiket tanımlar", () => {
    for (const purpose of EMAIL_PURPOSES) {
      expect(EMAIL_PURPOSE_LABEL[purpose]).toEqual(expect.any(String));
      expect(EMAIL_PURPOSE_LABEL[purpose].length).toBeGreaterThan(0);
    }
  });

  it("CUSTOM için 'Özel' etiketini kullanır (backend email-variables.ts ile birebir)", () => {
    expect(EMAIL_PURPOSE_LABEL.CUSTOM).toBe("Özel");
  });
});
