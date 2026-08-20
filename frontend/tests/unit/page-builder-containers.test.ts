import { describe, expect, it } from "vitest";
import {
  containerDepth,
  countNodes,
  findNode,
  findParentId,
  getContainerChildIds,
  getContainerChildren,
  insertNode,
  isContainerAtCapacity,
  isDescendant,
  moveNode,
  needsConfirmToUnwrap,
  removeNode,
  setContainerChildren,
  subtreeDepth,
  toContainerId,
  unwrapContainer,
  updateContainerSettings,
  wrapInContainer,
} from "@/lib/page-builder/containers";
import {
  DEFAULT_CONTAINER_SETTINGS,
  MAX_CHILDREN_PER_CONTAINER,
  MAX_CONTAINER_DEPTH,
  type ContainerNode,
  type ContainerSettings,
  type PageNode,
  type TextBlock,
} from "@/lib/page-builder/types";

function text(id: string): TextBlock {
  return { id, type: "text", data: { html: id } };
}

function container(id: string, children: PageNode[] = [], settingsPatch: Partial<ContainerSettings> = {}): ContainerNode {
  return { id, type: "container", settings: { ...DEFAULT_CONTAINER_SETTINGS, ...settingsPatch }, children };
}

describe("findNode / findParentId", () => {
  const tree: PageNode[] = [text("a"), container("c1", [text("b"), container("c2", [text("d")])])];

  it("findNode: kök ve iç içe düğümleri bulur", () => {
    expect(findNode(tree, "a")?.id).toBe("a");
    expect(findNode(tree, "c2")?.id).toBe("c2");
    expect(findNode(tree, "d")?.id).toBe("d");
    expect(findNode(tree, "yok")).toBeNull();
  });

  it("findParentId: kök düğüm için 'root' döner", () => {
    expect(findParentId(tree, "a")).toBe("root");
  });

  it("findParentId: iç içe düğümler için doğrudan ebeveynin konteyner kimliğini döner", () => {
    expect(findParentId(tree, "b")).toBe("container:c1");
    expect(findParentId(tree, "c2")).toBe("container:c1");
    expect(findParentId(tree, "d")).toBe("container:c2");
  });

  it("findParentId: bulunamayan düğüm için null döner", () => {
    expect(findParentId(tree, "yok")).toBeNull();
  });
});

describe("getContainerChildren / getContainerChildIds", () => {
  const tree: PageNode[] = [container("c1", [text("a"), text("b")])];

  it("root için tüm düğüm listesini döner", () => {
    expect(getContainerChildIds(tree, "root")).toEqual(["c1"]);
  });

  it("bir konteynerin çocuklarını döner", () => {
    expect(getContainerChildIds(tree, toContainerId("c1"))).toEqual(["a", "b"]);
  });

  it("var olmayan konteyner için boş dizi döner", () => {
    expect(getContainerChildren(tree, toContainerId("yok"))).toEqual([]);
  });
});

describe("isDescendant — KRİTİK guard (kendi içine/torununa bırakma engeli)", () => {
  const tree: PageNode[] = [container("A", [container("B", [text("leaf")])])];

  it("bir düğüm kendisinin 'torunu' sayılır (self dahil)", () => {
    expect(isDescendant(tree, "A", "A")).toBe(true);
  });

  it("doğrudan ve dolaylı torunları doğru tespit eder", () => {
    expect(isDescendant(tree, "A", "B")).toBe(true);
    expect(isDescendant(tree, "A", "leaf")).toBe(true);
  });

  it("ters yönde (torun → ata) YANLIŞ döner", () => {
    expect(isDescendant(tree, "B", "A")).toBe(false);
  });

  it("ilişkisiz düğümler için false döner", () => {
    const wide: PageNode[] = [container("X", []), container("Y", [])];
    expect(isDescendant(wide, "X", "Y")).toBe(false);
  });
});

describe("containerDepth / subtreeDepth", () => {
  const tree: PageNode[] = [container("L1", [container("L2", [container("L3", [text("leaf")])])])];

  it("kök seviyesi 1'dir", () => {
    expect(containerDepth(tree, "L1")).toBe(1);
  });

  it("iç içe geçtikçe derinlik artar", () => {
    expect(containerDepth(tree, "L2")).toBe(2);
    expect(containerDepth(tree, "L3")).toBe(3);
  });

  it("bulunamayan düğüm için 0 döner", () => {
    expect(containerDepth(tree, "yok")).toBe(0);
  });

  it("subtreeDepth: yaprak bloklar KONTEYNER DERİNLİK BÜTÇESİNE katkı yapmaz (0)", () => {
    // KRİTİK: yaprak bloklar `MAX_CONTAINER_DEPTH` bütçesine dahil DEĞİLDİR (yalnızca konteynerler
    // sayılır) — aksi halde geçerli bir wrap/moveNode işlemi yanlışlıkla reddedilirdi.
    expect(subtreeDepth(text("x"))).toBe(0);
  });

  it("subtreeDepth: boş/yalnızca-yaprak-çocuklu bir konteyner 1'dir (kendisi tek başına bir seviye)", () => {
    expect(subtreeDepth(container("empty", []))).toBe(1);
    expect(subtreeDepth(container("onlyLeaves", [text("a"), text("b")]))).toBe(1);
  });

  it("subtreeDepth: iç içe konteynerler seviyeleri toplar", () => {
    expect(subtreeDepth(container("wrap", [container("inner", [text("x")])]))).toBe(2);
  });
});

describe("countNodes", () => {
  it("iç içe konteynerler DAHİL tüm düğümleri sayar", () => {
    const tree: PageNode[] = [text("a"), container("c", [text("b"), container("d", [text("e")])])];
    // a, c, b, d, e = 5
    expect(countNodes(tree)).toBe(5);
  });

  it("boş dizide 0 döner", () => {
    expect(countNodes([])).toBe(0);
  });
});

describe("insertNode — kök MAX_CHILDREN_PER_CONTAINER'a TABİ DEĞİL, gerçek konteynerler TABİ", () => {
  it("köke MAX_CHILDREN_PER_CONTAINER'ın ÜZERİNDE düğüm eklenebilir", () => {
    let nodes: PageNode[] = [];
    for (let i = 0; i < MAX_CHILDREN_PER_CONTAINER + 5; i += 1) {
      nodes = insertNode(nodes, "root", nodes.length, text(`t${i}`));
    }
    expect(nodes).toHaveLength(MAX_CHILDREN_PER_CONTAINER + 5);
  });

  it("gerçek bir konteyner MAX_CHILDREN_PER_CONTAINER'da dolduğunda yeni ekleme SESSİZCE engellenir", () => {
    const fullChildren = Array.from({ length: MAX_CHILDREN_PER_CONTAINER }, (_, i) => text(`c${i}`));
    let nodes: PageNode[] = [container("full", fullChildren)];
    const before = nodes;
    nodes = insertNode(nodes, toContainerId("full"), fullChildren.length, text("overflow"));
    expect(nodes).toEqual(before); // no-op — İÇERİK değişmedi (yeni node EKLENMEDİ)
    expect((nodes[0] as ContainerNode).children).toHaveLength(MAX_CHILDREN_PER_CONTAINER);
  });

  it("belirtilen indekse doğru şekilde ekler", () => {
    const nodes: PageNode[] = [text("a"), text("c")];
    const next = insertNode(nodes, "root", 1, text("b"));
    expect(next.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
});

describe("removeNode", () => {
  it("kökten bir düğümü kaldırır", () => {
    const nodes: PageNode[] = [text("a"), text("b")];
    const { nodes: next, removed } = removeNode(nodes, "a");
    expect(removed?.id).toBe("a");
    expect(next.map((n) => n.id)).toEqual(["b"]);
  });

  it("iç içe bir düğümü kaldırır, ebeveyn konteyneri korur", () => {
    const nodes: PageNode[] = [container("c", [text("a"), text("b")])];
    const { nodes: next, removed } = removeNode(nodes, "a");
    expect(removed?.id).toBe("a");
    expect((next[0] as ContainerNode).children.map((n) => n.id)).toEqual(["b"]);
  });

  it("bulunamayan id için removed: null, ağaç DEĞİŞMEDEN döner", () => {
    const nodes: PageNode[] = [text("a")];
    const { nodes: next, removed } = removeNode(nodes, "yok");
    expect(removed).toBeNull();
    expect(next).toBe(nodes);
  });
});

describe("moveNode — konteynerler arası taşıma + guard'lar", () => {
  it("bir düğümü bir konteynerden başka bir konteynere taşır", () => {
    const nodes: PageNode[] = [container("A", [text("x")]), container("B", [])];
    const next = moveNode(nodes, "x", toContainerId("B"), 0);
    expect(getContainerChildIds(next, toContainerId("A"))).toEqual([]);
    expect(getContainerChildIds(next, toContainerId("B"))).toEqual(["x"]);
  });

  it("bir konteyneri kendi torununun içine taşımayı REDDEDER (isDescendant guard)", () => {
    const nodes: PageNode[] = [container("A", [container("B", [text("leaf")])])];
    const next = moveNode(nodes, "A", toContainerId("B"), 0);
    expect(next).toBe(nodes); // no-op
  });

  it("bir konteyneri KENDİ İÇİNE taşımayı reddeder", () => {
    const nodes: PageNode[] = [container("A", [text("leaf")])];
    const next = moveNode(nodes, "A", toContainerId("A"), 0);
    expect(next).toBe(nodes);
  });

  it("hedef konteyner MAX_CHILDREN_PER_CONTAINER'da doluysa taşımayı iptal eder", () => {
    const fullChildren = Array.from({ length: MAX_CHILDREN_PER_CONTAINER }, (_, i) => text(`c${i}`));
    const nodes: PageNode[] = [container("full", fullChildren), text("outsider")];
    const next = moveNode(nodes, "outsider", toContainerId("full"), 0);
    expect(next).toBe(nodes);
  });

  it("taşıma sonucu MAX_CONTAINER_DEPTH'i AŞARSA iptal eder", () => {
    // 4 seviyeli bir konteyner zinciri (L1 > L2 > L3 > L4), L4 zaten MAX_CONTAINER_DEPTH'te.
    const deepChain = container("L4", []);
    const l3 = container("L3", [deepChain]);
    const l2 = container("L2", [l3]);
    const l1 = container("L1", [l2]);
    const nodes: PageNode[] = [l1, container("otherContainer", [text("leaf")])];

    // "otherContainer" (kendi başına derinlik 1 alt-ağaç) L4'ün (derinlik 4) İÇİNE taşınırsa
    // sonuç derinlik 5 olur → MAX_CONTAINER_DEPTH (4) aşılır, iptal edilmeli.
    const next = moveNode(nodes, "otherContainer", toContainerId("L4"), 0);
    expect(next).toBe(nodes);
  });

  it("aynı ebeveyn içinde hedefe taşımada (fromParentId === toParentId) kapasite/derinlik kontrolü atlanır", () => {
    const nodes: PageNode[] = [container("A", [text("x"), text("y")])];
    const next = moveNode(nodes, "x", toContainerId("A"), 1);
    expect(getContainerChildIds(next, toContainerId("A"))).toEqual(["y", "x"]);
  });

  it("bulunamayan düğüm için ağaç DEĞİŞMEDEN döner", () => {
    const nodes: PageNode[] = [container("A", [])];
    expect(moveNode(nodes, "yok", toContainerId("A"), 0)).toBe(nodes);
  });
});

describe("setContainerChildren / updateContainerSettings", () => {
  it("setContainerChildren: kökte tüm diziyi değiştirir", () => {
    const nodes: PageNode[] = [text("a")];
    const next = setContainerChildren(nodes, "root", [text("b"), text("c")]);
    expect(next.map((n) => n.id)).toEqual(["b", "c"]);
  });

  it("setContainerChildren: bir konteynerin children'ını değiştirir", () => {
    const nodes: PageNode[] = [container("c", [text("a")])];
    const next = setContainerChildren(nodes, toContainerId("c"), [text("z")]);
    expect((next[0] as ContainerNode).children.map((n) => n.id)).toEqual(["z"]);
  });

  it("updateContainerSettings: yalnızca belirtilen alanları değiştirir", () => {
    const nodes: PageNode[] = [container("c", [], { gap: 16, direction: "column" })];
    const next = updateContainerSettings(nodes, "c", { gap: 32 });
    const settings = (next[0] as ContainerNode).settings;
    expect(settings.gap).toBe(32);
    expect(settings.direction).toBe("column");
  });
});

describe("wrapInContainer", () => {
  it("bir düğümü YENİ bir konteynerin tek çocuğu yapar, konumunu korur", () => {
    const nodes: PageNode[] = [text("a"), text("b")];
    const next = wrapInContainer(nodes, "b");
    expect(next).toHaveLength(2);
    expect(next[0]!.id).toBe("a");
    const wrapped = next[1] as ContainerNode;
    expect(wrapped.type).toBe("container");
    expect(wrapped.settings).toEqual(DEFAULT_CONTAINER_SETTINGS);
    expect(wrapped.children).toEqual([text("b")]);
    expect(wrapped.id).not.toBe("b");
  });

  it("bir konteyneri de sarmalayabilir (iç içe geçme artırılabilir)", () => {
    const nodes: PageNode[] = [container("inner", [text("x")])];
    const next = wrapInContainer(nodes, "inner");
    const outer = next[0] as ContainerNode;
    expect(outer.id).not.toBe("inner");
    expect((outer.children[0] as ContainerNode).id).toBe("inner");
  });
});

describe("unwrapContainer — iç içe konteyner İÇEREN bir konteyneri kaldırma", () => {
  it("çocukları TEK seviye yukarı taşır, torun konteynerlere DOKUNMAZ", () => {
    const nested = container("nested", [text("deep")]);
    const nodes: PageNode[] = [text("before"), container("wrap", [text("a"), nested, text("b")]), text("after")];

    const next = unwrapContainer(nodes, "wrap");
    expect(next.map((n) => n.id)).toEqual(["before", "a", "nested", "b", "after"]);

    const survivedNested = next.find((n) => n.id === "nested") as ContainerNode;
    expect(survivedNested.type).toBe("container");
    expect(survivedNested.children).toEqual([text("deep")]);
  });

  it("iç içe bir konteyneri (kök DIŞINDA) de kaldırabilir", () => {
    const nodes: PageNode[] = [container("outer", [container("inner", [text("a"), text("b")])])];
    const next = unwrapContainer(nodes, "inner");
    const outer = next[0] as ContainerNode;
    expect(outer.children.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("var olmayan bir konteyner id'si için ağacı değiştirmeden döner", () => {
    const nodes: PageNode[] = [container("c", [text("a")])];
    expect(unwrapContainer(nodes, "yok")).toEqual(nodes);
  });

  it("bir içerik bloğu (konteyner OLMAYAN) id'si verilirse no-op", () => {
    const nodes: PageNode[] = [text("a")];
    expect(unwrapContainer(nodes, "a")).toBe(nodes);
  });
});

describe("needsConfirmToUnwrap / isContainerAtCapacity", () => {
  it("içi dolu bir konteyner için true döner", () => {
    expect(needsConfirmToUnwrap(container("c", [text("a")]))).toBe(true);
  });

  it("boş bir konteyner için false döner", () => {
    expect(needsConfirmToUnwrap(container("c", []))).toBe(false);
  });

  it("içerik bloğu için (konteyner olmadığından) false döner", () => {
    expect(needsConfirmToUnwrap(text("a"))).toBe(false);
  });

  it("kök ('root') asla kapasiteye TABİ değildir", () => {
    expect(isContainerAtCapacity([], "root")).toBe(false);
  });

  it("gerçek bir konteyner MAX_CHILDREN_PER_CONTAINER'a ulaştığında true döner", () => {
    const fullChildren = Array.from({ length: MAX_CHILDREN_PER_CONTAINER }, (_, i) => text(`c${i}`));
    const nodes: PageNode[] = [container("full", fullChildren)];
    expect(isContainerAtCapacity(nodes, toContainerId("full"))).toBe(true);
  });
});

describe("MAX_CONTAINER_DEPTH sabiti tutarlılığı", () => {
  it("4 seviyeli bir zincir kurulabilir, 5. seviye derinlik ölçümüyle tespit edilir", () => {
    const l4 = container("L4", [text("leaf")]);
    const l3 = container("L3", [l4]);
    const l2 = container("L2", [l3]);
    const l1 = container("L1", [l2]);
    const nodes: PageNode[] = [l1];
    expect(containerDepth(nodes, "L4")).toBe(MAX_CONTAINER_DEPTH);
    expect(subtreeDepth(l1)).toBe(4);
  });
});
