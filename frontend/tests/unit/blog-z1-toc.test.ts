import { describe, expect, it } from "vitest";
import { buildToc, slugifyHeading, splitAtMiddleHeading } from "@/lib/blog/toc";
import { pickActiveHeading } from "@/components/site/blog/blog-toc";

describe("Paket Z1 — içindekiler (buildToc)", () => {
  it("yalnızca H2/H3 başlıklarını sırayla listeler ve id ekler", () => {
    const { html, items } = buildToc("<h1>Başlık</h1><p>x</p><h2>Causes</h2><h3>Wear and tear</h3><h4>skip</h4><h2>Treatment</h2>");
    expect(items).toEqual([
      { id: "causes", text: "Causes", level: 2 },
      { id: "wear-and-tear", text: "Wear and tear", level: 3 },
      { id: "treatment", text: "Treatment", level: 2 },
    ]);
    expect(html).toContain('<h2 id="causes">Causes</h2>');
    expect(html).toContain('<h3 id="wear-and-tear">Wear and tear</h3>');
    expect(html).toContain("<h1>Başlık</h1>");
    expect(html).toContain("<h4>skip</h4>");
  });

  it("tekrar eden başlıklara -2, -3 ekler", () => {
    const { items } = buildToc("<h2>Tips</h2><h2>Tips</h2><h3>Tips</h3>");
    expect(items.map((i) => i.id)).toEqual(["tips", "tips-2", "tips-3"]);
  });

  it("Türkçe ve Arapça harfleri korur", () => {
    const { items } = buildToc("<h2>Diz Ağrısı Nedenleri</h2><h2>أسباب ألم الركبة</h2><h2>Şişlik &amp; ödem</h2>");
    expect(items[0]!.id).toBe("diz-ağrısı-nedenleri");
    expect(items[1]!.id).toBe("أسباب-ألم-الركبة");
    expect(items[2]!.text).toBe("Şişlik & ödem");
    expect(items[2]!.id).toBe("şişlik-ödem");
  });

  it("iç etiketleri metinden ayıklar; var olan id'yi korur ve onunla çakışmaz", () => {
    const { html, items } = buildToc('<h2 id="causes">Causes</h2><h2>Causes</h2><h2>Safe <em>and</em> <strong>sound</strong></h2>');
    expect(items.map((i) => i.id)).toEqual(["causes", "causes-2", "safe-and-sound"]);
    expect(items[2]!.text).toBe("Safe and sound");
    expect(html.match(/id="causes"/g)).toHaveLength(1);
  });

  it("boş başlığı atlar, boş girdiyi güvenle işler", () => {
    expect(buildToc("<h2> </h2><h2><br></h2>").items).toEqual([]);
    expect(buildToc("")).toEqual({ html: "", items: [] });
    expect(slugifyHeading("!!!")).toBe("section");
  });
});

describe("Paket Z1 — yazı ortası bölme", () => {
  it("yalnızca üst düzey H2 başlangıcında böler (tabloyu kesmez)", () => {
    const html = "<p>a</p><h2>One</h2><table><tr><td>x</td></tr></table><h2>Two</h2><p>b</p><h2>Three</h2><h2>Four</h2>";
    const parts = splitAtMiddleHeading(html);
    expect(parts).not.toBeNull();
    expect(parts![0] + parts![1]).toBe(html);
    expect(parts![1].startsWith("<h2>Three")).toBe(true);
    expect(parts![0]).toContain("</table>");
  });

  it("2'den az H2 varsa bölmez", () => {
    expect(splitAtMiddleHeading("<p>a</p><h2>One</h2><p>b</p>")).toBeNull();
  });
});

describe("Paket Z1 — aktif başlık seçimi", () => {
  const items = [
    { id: "a", text: "A", level: 2 as const },
    { id: "b", text: "B", level: 2 as const },
  ];
  it("görünenler arasında belge sırasındaki ilkini seçer, hiçbiri görünmüyorsa öncekini korur", () => {
    expect(pickActiveHeading(items, new Set(["b", "a"]), null)).toBe("a");
    expect(pickActiveHeading(items, new Set(["b"]), "a")).toBe("b");
    expect(pickActiveHeading(items, new Set(), "b")).toBe("b");
  });
});
