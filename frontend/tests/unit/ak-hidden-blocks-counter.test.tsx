import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlockRenderer } from "@/components/site/blocks";
import { CounterBlockView } from "@/components/site/blocks/counter-block";
import { normalizePageNodes } from "@/lib/page-builder/normalize";
import { collectHiddenIds, inheritHiddenFromCanonical, stripHiddenNodes, usesCounterMetrics } from "@/lib/page-builder/hidden-blocks";
import { buildFaqPageJsonLd } from "@/lib/page-builder/structured-data";
import { metricValue } from "@/lib/page-builder/counter-metrics";
import type { CounterBlock, PageNode } from "@/lib/page-builder/types";

/**
 * Paket AK (K1/K2) — "Ziyaretçiden gizle" ve canlı sayaç. Gizli blok HTML'e hiç yazılmaz (çocukları dahil);
 * ana listede gizli `id` çeviri listesinde de gizli sayılır; `metric` varsa değer canlı veriden gelir, alınamazsa
 * öğe gösterilmez, `metric` yoksa elle değer aynen.
 */
const text = (id: string, html: string, extra: Record<string, unknown> = {}) => ({ id, type: "text", data: { html }, ...extra });
const container = (id: string, children: unknown[], extra: Record<string, unknown> = {}) => ({ id, type: "container", settings: {}, children, ...extra });
const nodes = (raw: unknown[]) => normalizePageNodes(raw as never);

describe("hidden blok — renderer", () => {
  it("gizli blok HTML'de yok; görünür bloklar durur", () => {
    const { container: root } = render(
      <BlockRenderer
        nodes={nodes([text("a", "<p>Gorunur metin</p>"), text("b", "<p>Gizli serit metni</p>", { hidden: true })])}
        chrome="page"
      />
    );
    expect(screen.getByText("Gorunur metin")).toBeInTheDocument();
    expect(screen.queryByText("Gizli serit metni")).toBeNull();
    expect(root.innerHTML).not.toContain("Gizli serit metni");
  });

  it("gizli konteyner çocuklarıyla birlikte çizilmez; içindeki gizli çocuk yalnızca kendisi çizilmez", () => {
    const { container: root } = render(
      <BlockRenderer
        nodes={nodes([
          container("c1", [text("c1a", "<p>Konteyner ici A</p>")], { hidden: true }),
          container("c2", [text("c2a", "<p>Konteyner ici B</p>"), text("c2b", "<p>Konteyner ici C</p>", { hidden: true })]),
        ])}
        chrome="page"
      />
    );
    expect(root.innerHTML).not.toContain("Konteyner ici A");
    expect(screen.getByText("Konteyner ici B")).toBeInTheDocument();
    expect(root.innerHTML).not.toContain("Konteyner ici C");
  });

  it("hidden=false / alan yok: görünür (bugünkü davranış)", () => {
    render(<BlockRenderer nodes={nodes([text("a", "<p>Birinci</p>", { hidden: false }), text("b", "<p>Ikinci</p>")])} chrome="page" />);
    expect(screen.getByText("Birinci")).toBeInTheDocument();
    expect(screen.getByText("Ikinci")).toBeInTheDocument();
  });
});

describe("hidden blok — normalize", () => {
  it("içerik bloğunda ve konteynerde `hidden: true` korunur; false/geçersiz değer atılır", () => {
    const result = nodes([text("a", "x", { hidden: true }), container("c", [text("d", "y", { hidden: true })], { hidden: true }), container("e", [], { hidden: "evet" })]);
    expect(result[0]!.hidden).toBe(true);
    expect(result[1]!.hidden).toBe(true);
    expect(result[1]!.type === "container" && result[1]!.children[0]!.hidden).toBe(true);
    expect(result[2]!.hidden).toBeUndefined();
  });
});

describe("hidden blok — çeviri listesi tutarlılığı", () => {
  const canonical = nodes([text("strip", "EN serit", { hidden: true }), container("how", [text("how-a", "EN how")], { hidden: true }), text("keep", "EN keep")]);
  // Almanca liste: gizleme unutulmuş (ayrı liste)
  const german = nodes([text("strip", "DE Streifen"), container("how", [text("how-a", "DE So geht es")]), text("keep", "DE bleibt")]);

  it("collectHiddenIds ağaçtaki gizli id'leri toplar", () => {
    expect([...collectHiddenIds(canonical)].sort()).toEqual(["how", "strip"]);
  });

  it("ana listede gizli id çeviri listesinde de gizli sayılır (girdi değişmez)", () => {
    const merged = inheritHiddenFromCanonical(german, canonical);
    expect(merged.find((n) => n.id === "strip")!.hidden).toBe(true);
    expect(merged.find((n) => n.id === "how")!.hidden).toBe(true);
    expect(merged.find((n) => n.id === "keep")!.hidden).toBeUndefined();
    expect(german.find((n) => n.id === "strip")!.hidden).toBeUndefined();
    const { container: root } = render(<BlockRenderer nodes={merged} chrome="page" />);
    expect(root.innerHTML).not.toContain("DE Streifen");
    expect(root.innerHTML).not.toContain("DE So geht es");
    expect(screen.getByText("DE bleibt")).toBeInTheDocument();
  });

  it("çeviri listesinde kendi gizlemesi olan blok (ana listede açık) gizli kalır; ana liste boşsa liste aynen döner", () => {
    const localHidden = nodes([text("x", "DE x", { hidden: true })]);
    expect(inheritHiddenFromCanonical(localHidden, nodes([text("x", "EN x")]))[0]!.hidden).toBe(true);
    expect(inheritHiddenFromCanonical(german, [])).toBe(german);
    expect(inheritHiddenFromCanonical(german, null)).toBe(german);
  });

  it("stripHiddenNodes: gizli bölüm FAQ JSON-LD'ye de girmez", () => {
    const faq = (id: string, question: string, extra: Record<string, unknown> = {}) => ({
      id,
      type: "accordion",
      data: { items: [{ id: `${id}-i`, question, answer: "Cevap" }], allowMultipleOpen: false },
      ...extra,
    });
    const all = nodes([faq("f1", "Gorunur soru?"), faq("f2", "Gizli soru?", { hidden: true })]);
    const visible = JSON.stringify(buildFaqPageJsonLd(stripHiddenNodes(all)));
    expect(visible).toContain("Gorunur soru?");
    expect(visible).not.toContain("Gizli soru?");
  });
});

describe("sayaç — canlı veri (metric)", () => {
  const counter = (items: CounterBlock["data"]["items"]): CounterBlock => ({ id: "ctr", type: "counter", data: { items } });
  const items: CounterBlock["data"]["items"] = [
    { id: "a", value: 15, label: "Coordinator", metric: "activeCoordinators" },
    { id: "b", value: 6, label: "Spoken Language", metric: "visitorLanguages" },
    { id: "c", value: 30, label: "Minutes", metric: "consultationMinutes" },
    { id: "d", value: 99, label: "Hand written" },
  ];

  it("metric varsa değer canlı veriden (elle değer yok sayılır); metric yoksa elle değer aynen", () => {
    render(
      <CounterBlockView
        block={counter(items)}
        chrome="page"
        siteContext={{ lang: "en", defaultLocaleCode: "en", metrics: { activeServices: 7, visitorLanguages: 8, activeCoordinators: 4, consultationMinutes: 20 } }}
      />
    );
    expect(screen.getByText("Coordinator").previousElementSibling).toHaveTextContent("4");
    expect(screen.getByText("Spoken Language").previousElementSibling).toHaveTextContent("8");
    expect(screen.getByText("Minutes").previousElementSibling).toHaveTextContent("20");
    expect(screen.getByText("Hand written").previousElementSibling).toHaveTextContent("99");
    expect(screen.queryByText("15")).toBeNull();
  });

  it("değer yoksa (null / 0 / metrics yok / hata) o öğe GÖSTERİLMEZ; elle yazılan öğe kalır", () => {
    const { rerender } = render(
      <CounterBlockView
        block={counter(items)}
        chrome="page"
        siteContext={{ lang: "en", defaultLocaleCode: "en", metrics: { activeServices: null, visitorLanguages: 0, activeCoordinators: 4, consultationMinutes: null } }}
      />
    );
    expect(screen.getByText("Coordinator")).toBeInTheDocument();
    expect(screen.queryByText("Spoken Language")).toBeNull();
    expect(screen.queryByText("Minutes")).toBeNull();
    expect(screen.getByText("Hand written")).toBeInTheDocument();

    rerender(<CounterBlockView block={counter(items)} chrome="page" siteContext={{ lang: "en", defaultLocaleCode: "en", metrics: null }} />);
    expect(screen.queryByText("Coordinator")).toBeNull();
    expect(screen.getByText("Hand written")).toBeInTheDocument();
  });

  it("hepsi canlı veri ve hiçbiri alınamıyorsa şerit hiç çizilmez", () => {
    const { container: root } = render(<CounterBlockView block={counter(items.slice(0, 3))} chrome="page" siteContext={{ lang: "en", defaultLocaleCode: "en", metrics: null }} />);
    expect(root.innerHTML).toBe("");
  });

  it("metricValue yalnızca sonlu pozitif sayıyı kabul eder; usesCounterMetrics yalnızca görünür metric'li sayaçta true", () => {
    expect(metricValue({ activeServices: 3 }, "activeServices")).toBe(3);
    expect(metricValue({ activeServices: 0 }, "activeServices")).toBeNull();
    expect(metricValue({ activeServices: Number.NaN }, "activeServices")).toBeNull();
    expect(metricValue(undefined, "activeServices")).toBeNull();
    const withMetric = nodes([container("c", [counter(items)])]);
    expect(usesCounterMetrics(withMetric)).toBe(true);
    expect(usesCounterMetrics(nodes([counter([{ id: "x", value: 1, label: "l" }])]))).toBe(false);
    expect(usesCounterMetrics(nodes([{ ...counter(items), hidden: true }] as PageNode[]))).toBe(false);
  });
});
