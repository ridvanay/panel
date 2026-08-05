import { describe, expect, it } from "vitest";
import { applyFieldMapping, suggestFieldMapping } from "../../src/modules/import/lib/field-mapping";

describe("suggestFieldMapping", () => {
  it("matches exact target field names", () => {
    const { fields, suggestedMapping, canStart } = suggestFieldMapping(["title", "slug", "status"], "PAGES");
    expect(suggestedMapping.title).toBe("title");
    expect(suggestedMapping.slug).toBe("slug");
    expect(suggestedMapping.status).toBe("status");
    expect(fields.every((f) => f.status === "matched")).toBe(true);
    expect(canStart).toBe(true);
  });

  it("matches Turkish synonyms case-insensitively", () => {
    const { suggestedMapping } = suggestFieldMapping(["Baslik", "Icerik", "Durum"], "BLOG");
    expect(suggestedMapping.Baslik).toBe("title");
    expect(suggestedMapping.Icerik).toBe("contentHtml");
    expect(suggestedMapping.Durum).toBe("status");
  });

  it("marks unrecognized columns as unmatched (not an error)", () => {
    const { fields, suggestedMapping } = suggestFieldMapping(["title", "some_random_column"], "PAGES");
    expect(suggestedMapping.some_random_column).toBeNull();
    const unmatched = fields.find((f) => f.sourceField === "some_random_column");
    expect(unmatched?.status).toBe("unmatched");
  });

  it("flags missingRequired when the required target field is absent (canStart: false)", () => {
    const { fields, canStart } = suggestFieldMapping(["slug", "status"], "PAGES");
    const missing = fields.find((f) => f.status === "missingRequired");
    expect(missing?.targetField).toBe("title");
    expect(canStart).toBe(false);
  });

  it("USERS requires email, not title", () => {
    const { canStart: withoutEmail } = suggestFieldMapping(["name", "role"], "USERS");
    expect(withoutEmail).toBe(false);
    const { canStart: withEmail } = suggestFieldMapping(["name", "email", "role"], "USERS");
    expect(withEmail).toBe(true);
  });
});

describe("applyFieldMapping", () => {
  it("renames source keys to target keys and drops unmapped/null-mapped columns", () => {
    const record = { Baslik: "Hello", Icerik: "<p>hi</p>", ignored: "x" };
    const mapping = { Baslik: "title", Icerik: "contentHtml", ignored: null };
    expect(applyFieldMapping(record, mapping)).toEqual({ title: "Hello", contentHtml: "<p>hi</p>" });
  });
});
