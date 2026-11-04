import { describe, expect, it } from "vitest";
import { CreatePageRequestSchema } from "../../src/modules/pages/pages.schemas";

/** Paket AK (K1/K2) - BaseNode `hidden` ve counter ogesi `metric`. Eski veri (alansiz) bozulmaz. */
function parse(blocks: unknown[]) {
  return CreatePageRequestSchema.safeParse({ title: "Anasayfa", slug: "anasayfa", blocks });
}
type Node = { hidden?: boolean; children?: Node[]; data?: { items: { metric?: string }[] } };
const first = (r: ReturnType<typeof parse>) => (r.success ? (r.data.blocks?.[0] as Node) : null);

const counter = (extra: Record<string, unknown> = {}, item: Record<string, unknown> = {}) => ({
  id: "c1",
  type: "counter",
  data: { items: [{ id: "i1", value: 5, label: "Services", ...item }] },
  ...extra,
});

describe("hidden alani (K1)", () => {
  it("alansiz eski blok degismeden gecer (hidden yok)", () => {
    const r = parse([counter()]);
    expect(r.success).toBe(true);
    expect(first(r)!.hidden).toBeUndefined();
  });

  it("kaydet/oku: counter, heading ve text bloklarinda hidden korunur", () => {
    const r = parse([
      counter({ hidden: true }),
      { id: "h1", type: "heading", data: { text: "Merhaba", level: 2 }, hidden: true },
      { id: "t1", type: "text", data: { html: "<p>x</p>" }, hidden: false },
    ]);
    expect(r.success).toBe(true);
    const blocks = r.success ? (r.data.blocks as Node[]) : [];
    expect(blocks.map((b) => b.hidden)).toEqual([true, true, false]);
  });

  it("container ve cocuklari hidden tasir (cocuk icon-box dahil)", () => {
    const r = parse([
      {
        id: "ct",
        type: "container",
        settings: {},
        hidden: true,
        children: [{ id: "ib", type: "icon-box", data: { icon: "shield", heading: "A", description: "B" }, hidden: true }, { id: "ib2", type: "icon-box", data: { icon: "shield", heading: "C", description: "D" } }],
      },
    ]);
    expect(r.success).toBe(true);
    const c = first(r)!;
    expect(c.hidden).toBe(true);
    expect(c.children![0]!.hidden).toBe(true);
    expect(c.children![1]!.hidden).toBeUndefined();
  });

  it("hidden boolean olmayan deger reddedilir", () => {
    expect(parse([counter({ hidden: "yes" })]).success).toBe(false);
  });
});

describe("counter metric (K2)", () => {
  it.each(["activeServices", "visitorLanguages", "activeCoordinators", "consultationMinutes"])("%s kabul edilir ve saklanir", (m) => {
    const r = parse([counter({}, { metric: m })]);
    expect(r.success).toBe(true);
    expect(first(r)!.data!.items[0]!.metric).toBe(m);
  });

  it("metric yoksa elle yazilan deger aynen (alan eklenmez)", () => {
    const r = parse([counter()]);
    expect(first(r)!.data!.items[0]!.metric).toBeUndefined();
  });

  it("bilinmeyen metric reddedilir", () => {
    expect(parse([counter({}, { metric: "doctors" })]).success).toBe(false);
  });
});
