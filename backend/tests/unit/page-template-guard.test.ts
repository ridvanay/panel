import { describe, expect, it } from "vitest";
import { assertTemplateEditAllowed } from "../../src/lib/page-template-guard";
import { ApiError } from "../../src/lib/errors";

/**
 * §10.20 — `assertTemplateEditAllowed` saf/senkron bir fonksiyondur (DB'ye erişmez), bu yüzden
 * DB'siz (`tests/unit`) test edilebilir. Route-seviyesi entegrasyonu (autosave baypas dahil)
 * `tests/integration/page-editor-roles.test.ts`'te ayrıca doğrulanır.
 */
describe("assertTemplateEditAllowed (§10.20)", () => {
  function heading(id: string, text: string, extra: Record<string, unknown> = {}) {
    return { id, type: "heading", data: { text, level: 2, align: "left", underline: false, ...extra } };
  }

  function container(id: string, children: unknown[], settingsOverride: Record<string, unknown> = {}) {
    return {
      id,
      type: "container",
      settings: { layout: "boxed", direction: "column", gap: 16, ...settingsOverride },
      children,
    };
  }

  it("allows a template-editable data field to change (e.g. heading.data.text)", () => {
    const existing = [heading("h1", "Eski Başlık")];
    const incoming = [heading("h1", "Yeni Başlık")];
    expect(() => assertTemplateEditAllowed(existing, incoming)).not.toThrow();
  });

  it("rejects a locked data field change (heading.data.level)", () => {
    const existing = [heading("h1", "Başlık")];
    const incoming = [heading("h1", "Başlık", { level: 3 })];
    try {
      assertTemplateEditAllowed(existing, incoming);
      throw new Error("beklenen ApiError fırlatılmadı");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.statusCode).toBe(403);
      expect(apiErr.code).toBe("FORBIDDEN");
      expect(apiErr.details?.blocks).toContain("h1: data.level değiştirilemez");
    }
  });

  it("rejects custom-html data.html changes unconditionally (§3.3)", () => {
    const existing = [{ id: "c1", type: "custom-html", data: { html: "<p>a</p>" } }];
    const incoming = [{ id: "c1", type: "custom-html", data: { html: "<script>alert(1)</script>" } }];
    expect(() => assertTemplateEditAllowed(existing, incoming)).toThrow(ApiError);
  });

  it("rejects container settings changes", () => {
    const existing = [container("c1", [])];
    const incoming = [container("c1", [], { gap: 32 })];
    try {
      assertTemplateEditAllowed(existing, incoming);
      throw new Error("beklenen ApiError fırlatılmadı");
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.statusCode).toBe(403);
      expect(apiErr.details?.blocks?.some((m) => m.includes("settings"))).toBe(true);
    }
  });

  it("rejects adding a container/node (structural insertion)", () => {
    const existing = [heading("h1", "Merhaba")];
    const incoming = [heading("h1", "Merhaba"), container("new-container", [])];
    try {
      assertTemplateEditAllowed(existing, incoming);
      throw new Error("beklenen ApiError fırlatılmadı");
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.statusCode).toBe(403);
      expect(apiErr.details?.blocks).toContain("new-container: yapı değiştirilemez");
    }
  });

  it("rejects removing a node (structural deletion)", () => {
    const existing = [heading("h1", "Merhaba"), heading("h2", "Dünya")];
    const incoming = [heading("h1", "Merhaba")];
    try {
      assertTemplateEditAllowed(existing, incoming);
      throw new Error("beklenen ApiError fırlatılmadı");
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.details?.blocks).toContain("h2: yapı değiştirilemez");
    }
  });

  it("rejects reordering nodes even if the id set is unchanged", () => {
    const existing = [heading("h1", "Bir"), heading("h2", "İki")];
    const incoming = [heading("h2", "İki"), heading("h1", "Bir")];
    expect(() => assertTemplateEditAllowed(existing, incoming)).toThrow(ApiError);
  });

  it("allows content-array field additions inside allowed fields (e.g. accordion.data.items)", () => {
    const existing = [{ id: "a1", type: "accordion", data: { items: [{ id: "q1", question: "S1", answer: "C1" }], allowMultipleOpen: false } }];
    const incoming = [
      {
        id: "a1",
        type: "accordion",
        data: {
          items: [
            { id: "q1", question: "S1", answer: "C1" },
            { id: "q2", question: "S2", answer: "C2" },
          ],
          allowMultipleOpen: false,
        },
      },
    ];
    expect(() => assertTemplateEditAllowed(existing, incoming)).not.toThrow();
  });

  it("rejects changes to reveal (outside data) on a content block", () => {
    const existing = [{ ...heading("h1", "Başlık"), reveal: { effect: "none", delayMs: 0 } }];
    const incoming = [{ ...heading("h1", "Başlık"), reveal: { effect: "fade-in", delayMs: 200 } }];
    expect(() => assertTemplateEditAllowed(existing, incoming)).toThrow(ApiError);
  });

  it("allows unchanged deeply-nested container trees to pass through", () => {
    const tree = [container("root", [container("nested", [heading("h1", "Merhaba")])])];
    expect(() => assertTemplateEditAllowed(tree, JSON.parse(JSON.stringify(tree)))).not.toThrow();
  });

  it("fails closed for an unknown block type (empty allowed-field set)", () => {
    const existing = [{ id: "u1", type: "some-future-block", data: { foo: "bar" } }];
    const incoming = [{ id: "u1", type: "some-future-block", data: { foo: "baz" } }];
    expect(() => assertTemplateEditAllowed(existing, incoming)).toThrow(ApiError);
  });

  it("reports at most 10 violations, counting the rest without listing them", () => {
    const existing = Array.from({ length: 15 }, (_, i) => heading(`h${i}`, `Başlık ${i}`, { level: 3 }));
    const incoming = existing.map((node) => ({ ...node, data: { ...node.data, level: 4 } }));
    try {
      assertTemplateEditAllowed(existing, incoming);
      throw new Error("beklenen ApiError fırlatılmadı");
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.details?.blocks?.length).toBe(10);
    }
  });
});
