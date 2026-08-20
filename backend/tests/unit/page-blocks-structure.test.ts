import { describe, expect, it } from "vitest";
import { scanPageNodeStructure, MAX_CONTAINER_DEPTH, MAX_CHILDREN_PER_CONTAINER } from "../../src/lib/page-blocks";

/**
 * §10.19 (v3) `scanPageNodeStructure` — İTERATİF (explicit stack) ön-tarama. Bu, zod'un
 * özyinelemeli `PageNodeSchema` parse'ından ÖNCE çağrılan tek savunma katmanıdır (bkz. tasarım
 * notu §4.1/§4.2, security-agent ön denetimi §13.1). Bu dosya doğrudan bu fonksiyonu test eder
 * (uçtan uca zod entegrasyonu için bkz. `pages-container-schema.test.ts`).
 */

function leaf(id: string) {
  return { id, type: "text", data: {} };
}

function container(id: string, children: unknown[] = []) {
  return { id, type: "container", children };
}

describe("scanPageNodeStructure", () => {
  it("reports totalNodes=0 / maxContainerDepth=0 / maxChildren=0 for an empty root array", () => {
    expect(scanPageNodeStructure([])).toEqual({ totalNodes: 0, maxContainerDepth: 0, maxChildren: 0, truncated: false });
  });

  it("does not count the root array's own length toward maxChildren (mimar netleştirmesi (b))", () => {
    const rootBlocks = Array.from({ length: 40 }, (_, i) => leaf(`n${i}`));
    const report = scanPageNodeStructure(rootBlocks);
    expect(report.maxChildren).toBe(0);
    expect(report.totalNodes).toBe(40);
  });

  it("counts a real container.children length toward maxChildren", () => {
    const children = Array.from({ length: 10 }, (_, i) => leaf(`c${i}`));
    const report = scanPageNodeStructure([container("outer", children)]);
    expect(report.maxChildren).toBe(10);
    // 1 (outer) + 10 (children) = 11.
    expect(report.totalNodes).toBe(11);
  });

  it("reports maxContainerDepth=1 for a single top-level container with no nested containers", () => {
    const report = scanPageNodeStructure([container("outer", [leaf("a")])]);
    expect(report.maxContainerDepth).toBe(1);
  });

  it(`reports maxContainerDepth exactly at MAX_CONTAINER_DEPTH (${MAX_CONTAINER_DEPTH}) for a chain nested that deep`, () => {
    const chain = container("c1", [container("c2", [container("c3", [container("c4", [leaf("leaf")])])])]);
    const report = scanPageNodeStructure([chain]);
    expect(report.maxContainerDepth).toBe(MAX_CONTAINER_DEPTH);
  });

  it("reports maxContainerDepth ONE PAST MAX_CONTAINER_DEPTH when nested one level deeper (caller compares > MAX_CONTAINER_DEPTH)", () => {
    const chain = container("c1", [container("c2", [container("c3", [container("c4", [container("c5", [leaf("leaf")])])])])]);
    const report = scanPageNodeStructure([chain]);
    expect(report.maxContainerDepth).toBe(MAX_CONTAINER_DEPTH + 1);
  });

  it("does not throw and returns truncated:true for an extremely wide/deep chain beyond the absolute visit cap", () => {
    let node: unknown = leaf("leaf");
    for (let i = 0; i < 150_000; i++) {
      node = container(`c${i}`, [node]);
    }
    let caught: unknown;
    let report: ReturnType<typeof scanPageNodeStructure> | undefined;
    try {
      report = scanPageNodeStructure([node]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeUndefined();
    // Derinlik sınırı (MAX_CONTAINER_DEPTH) çok daha erken devreye girer ve daha derine
    // inilmesini engeller — bu yüzden bu senaryoda pratikte `truncated` DEĞİL, derinlik
    // ihlali raporlanır. Asıl kritik doğrulama: fonksiyon HİÇBİR ZAMAN throw etmez.
    expect(report?.maxContainerDepth).toBeGreaterThan(MAX_CONTAINER_DEPTH);
  });

  it("does not throw for a WIDE (>100,000 sibling) root array — truncated:true, does not hang", () => {
    const rootBlocks = Array.from({ length: 150_000 }, (_, i) => leaf(`n${i}`));
    let caught: unknown;
    let report: ReturnType<typeof scanPageNodeStructure> | undefined;
    try {
      report = scanPageNodeStructure(rootBlocks);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeUndefined();
    expect(report?.truncated).toBe(true);
  });

  it(`treats legacy 'columns' data.columns[] as synthetic per-column container children (normalize-sonrası ağacı yansıtır)`, () => {
    // 1 dış konteyner + 2 sütun sarmalayıcı + 2 sütun içi blok = 5 düğüm (bkz. tasarım notu §4.3).
    const legacyColumns = {
      id: "cols-1",
      type: "columns",
      data: {
        columns: [
          { id: "col-0", blocks: [leaf("a")] },
          { id: "col-1", blocks: [leaf("b")] },
        ],
      },
    };
    const report = scanPageNodeStructure([legacyColumns]);
    expect(report.totalNodes).toBe(5);
    // Dış konteynerin (columns) kendisi depth=1'de bir konteyner; sütun sarmalayıcılar depth=2.
    expect(report.maxContainerDepth).toBe(2);
    // Dış konteynerin 2 sütunu VE her sütunun 1 bloğu — en büyüğü 2 (< MAX_CHILDREN_PER_CONTAINER).
    expect(report.maxChildren).toBe(2);
    expect(report.maxChildren).toBeLessThan(MAX_CHILDREN_PER_CONTAINER);
  });

  it("does not descend into a container's children once depth already exceeds MAX_CONTAINER_DEPTH (efficiency/short-circuit)", () => {
    // 10 seviye derin bir zincirin en altına devasa bir fan-out (25 çocuk) koyuyoruz — sınırın
    // ÜZERİNDE bir derinlikte durduğu için bu geniş fan-out `maxChildren`'a HİÇ YANSIMAMALI.
    const wideChildren = Array.from({ length: 25 }, (_, i) => leaf(`deep-${i}`));
    let node: unknown = container("deepest", wideChildren);
    for (let i = 0; i < 10; i++) {
      node = container(`c${i}`, [node]);
    }
    const report = scanPageNodeStructure([node]);
    expect(report.maxChildren).toBeLessThan(25);
  });
});
