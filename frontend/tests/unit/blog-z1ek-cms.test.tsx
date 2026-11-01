import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { PageNode } from "@/lib/page-builder/types";

vi.mock("@/lib/api/server-sliders", () => ({ fetchSliderServer: async () => null }));

import { BlockRenderer } from "@/components/site/blocks";
import { hideDuplicateTitle, normalizeTitle, selectDisplayNodes } from "@/lib/page-builder/hide-duplicate-title";

const heading = (id: string, text: string, level: 1 | 2 | 3 = 1): PageNode =>
  ({ id, type: "heading", data: { text, level, align: "left", underline: false } }) as PageNode;
const text = (id: string, html: string): PageNode => ({ id, type: "text", data: { html } }) as PageNode;
const container = (id: string, children: PageNode[]): PageNode =>
  ({ id, type: "container", settings: {}, children }) as unknown as PageNode;

describe("Paket Z1-ek — CMS sayfa başlık tekrarı", () => {
  it("içerik sayfa başlığıyla aynı H1 ile başlıyorsa gizlenir (büyük/küçük harf ve boşluk duyarsız)", () => {
    const nodes = [heading("h", "  Content   Standards "), text("t", "<p>Body</p>")];
    const result = hideDuplicateTitle(nodes, "content standards");
    expect(result.map((n) => n.id)).toEqual(["t"]);
  });

  it("aynı başlıktaki H2 ve art arda tekrarlar da temizlenir; farklı başlığa dokunulmaz", () => {
    expect(hideDuplicateTitle([heading("a", "About", 1), heading("b", "About", 2), heading("c", "Our story", 2)], "About").map((n) => n.id)).toEqual(["c"]);
    expect(hideDuplicateTitle([heading("a", "Our story", 1)], "About").map((n) => n.id)).toEqual(["a"]);
    // H3 ya da ilk düğüm olmayan eşleşme tekrar sayılmaz.
    expect(hideDuplicateTitle([heading("a", "About", 3)], "About")).toHaveLength(1);
    expect(hideDuplicateTitle([text("t", "<p>x</p>"), heading("a", "About", 1)], "About")).toHaveLength(2);
  });

  it("metin bloğunun başındaki <h1> aynı başlıksa soyulur, gövde korunur", () => {
    const [node] = hideDuplicateTitle([text("t", "<h1>Privacy &amp; Terms</h1><p>Keep me</p>")], "Privacy & Terms");
    expect((node as { data: { html: string } }).data.html).toBe("<p>Keep me</p>");
    expect(hideDuplicateTitle([text("t", "<h1>Privacy &amp; Terms</h1>")], "Privacy & Terms")).toEqual([]);
  });

  it("konteynerin ilk çocuğundaki tekrar da gizlenir", () => {
    const result = hideDuplicateTitle([container("c", [heading("h", "About"), text("t", "<p>x</p>")])], "About");
    expect((result[0] as { children: PageNode[] }).children.map((n) => n.id)).toEqual(["t"]);
  });

  it("veri değişmez (girdi dizisi mutasyona uğramaz)", () => {
    const nodes = [heading("h", "About"), text("t", "<p>x</p>")];
    const copy = JSON.stringify(nodes);
    hideDuplicateTitle(nodes, "About");
    expect(JSON.stringify(nodes)).toBe(copy);
  });

  it("normalizeTitle etiketleri ve varlıkları temizler", () => {
    expect(normalizeTitle("<b>A&nbsp;&amp;&nbsp;B</b>")).toBe("a & b");
  });

  it("hukuki belge, anasayfa şablonu ve gizli başlık bandında hiçbir şey gizlenmez", () => {
    const nodes = [heading("h", "Terms"), text("t", "<p>x</p>")];
    const base = { nodes, title: "Terms", isLegalDocument: false, isHomeTemplate: false, headerStyle: "PLAIN" };
    expect(selectDisplayNodes(base)).toHaveLength(1);
    expect(selectDisplayNodes({ ...base, isLegalDocument: true })).toBe(nodes);
    expect(selectDisplayNodes({ ...base, isHomeTemplate: true })).toBe(nodes);
    expect(selectDisplayNodes({ ...base, headerStyle: "HIDDEN" })).toBe(nodes);
  });
});

describe("Paket Z1-ek — CMS sayfa tipografisi ve hizalama", () => {
  const legal: PageNode[] = [
    heading("h2", "1. Controller", 2),
    text("t", "<p>The controller is <strong>WM Health</strong>.</p><ul><li>Item one</li><li>Item two</li></ul>"),
    heading("h2b", "2. Rights", 2),
    text("t2", "<p>You may request access.</p><table><tr><td>Right</td><td>Access</td></tr></table>"),
  ];
  const sourceText = (nodes: PageNode[]) =>
    nodes
      .map((n) => (n.type === "heading" ? n.data.text : n.type === "text" ? n.data.html.replace(/<[^>]+>/g, "") : ""))
      .join("")
      .replace(/\s+/g, "");

  it("yasal sayfa metni görsel yenilemeden sonra da birebir aynı kalır", () => {
    const { container } = render(<BlockRenderer nodes={selectDisplayNodes({ nodes: legal, title: "1. Controller", isLegalDocument: true, isHomeTemplate: false, headerStyle: "PLAIN" })} chrome="page" />);
    expect(container.textContent!.replace(/\s+/g, "")).toBe(sourceText(legal));
  });

  it("zengin metin .blog-prose tipografisini alır ve başlık ile metin aynı kolonda (max-w-3xl) hizalanır", () => {
    const { container } = render(<BlockRenderer nodes={legal} chrome="page" />);
    const prose = container.querySelectorAll(".blog-prose.blog-prose--fill");
    expect(prose).toHaveLength(2);
    expect(container.querySelector(".prose")).toBeNull();
    const headingColumn = container.querySelector("h2")!.parentElement!;
    const textColumn = prose[0]!.parentElement!;
    for (const column of [headingColumn, textColumn]) {
      expect(column.className).toContain("mx-auto");
      expect(column.className).toContain("max-w-3xl");
    }
  });

  it("konteyner içinde (bare) ek kolon sarmalayıcısı eklenmez", () => {
    const { container } = render(<BlockRenderer nodes={[text("t", "<p>x</p>")]} chrome="bare" />);
    expect(container.firstElementChild).toHaveClass("blog-prose");
  });
});
