import { describe, expect, it } from "vitest";
import {
  appendRootItems,
  buildTree,
  canIndent,
  canMoveDownSibling,
  canMoveUpSibling,
  canOutdent,
  computeProjection,
  getDepth,
  indentItem,
  moveItem,
  moveSibling,
  outdentItem,
  removeItemCascade,
  subtreeHeight,
  toNavigationItemsPayload,
  updateItem,
  type FlatNavItem,
} from "@/components/admin/navigation/nav-tree-utils";
import { NAVIGATION_MAX_DEPTH } from "@/lib/navigation-constants";

function item(id: string, parentId: string | null = null): FlatNavItem {
  return { id, label: id, href: `/${id}`, parentId };
}

describe("nav-tree-utils", () => {
  describe("appendRootItems", () => {
    it("yeni öğeleri kök seviyenin sonuna ekler", () => {
      const items = [item("a"), item("b", "a")];
      const next = appendRootItems(items, [{ id: "c", label: "C", href: "/c" }]);
      expect(next).toHaveLength(3);
      expect(next[2]).toEqual({ id: "c", label: "C", href: "/c", parentId: null });
    });
  });

  describe("getDepth", () => {
    it("kök öğe için 0 döner", () => {
      const items = [item("a")];
      expect(getDepth(items, "a")).toBe(0);
    });

    it("4 seviyeli bir zincirde ata sayısını doğru hesaplar", () => {
      const items = [item("a"), item("b", "a"), item("c", "b"), item("d", "c")];
      expect(getDepth(items, "a")).toBe(0);
      expect(getDepth(items, "b")).toBe(1);
      expect(getDepth(items, "c")).toBe(2);
      expect(getDepth(items, "d")).toBe(3);
    });
  });

  describe("subtreeHeight", () => {
    it("yaprak öğe için 0 döner", () => {
      const items = [item("a")];
      expect(subtreeHeight(items, "a")).toBe(0);
    });

    it("tek çocuklu bir öğe için 1 döner", () => {
      const items = [item("a"), item("a1", "a")];
      expect(subtreeHeight(items, "a")).toBe(1);
    });

    it("çok dallı bir ağaçta EN DERİN dalın yüksekliğini döner", () => {
      const items = [item("a"), item("a1", "a"), item("a2", "a"), item("a11", "a1")];
      // a -> a1 -> a11 (yükseklik 2), a -> a2 (yükseklik 1) => a'nın yüksekliği 2
      expect(subtreeHeight(items, "a")).toBe(2);
      expect(subtreeHeight(items, "a1")).toBe(1);
      expect(subtreeHeight(items, "a2")).toBe(0);
    });
  });

  describe("removeItemCascade", () => {
    it("bir kök öğe silindiğinde doğrudan çocukları da kaldırır", () => {
      const items = [item("a"), item("a1", "a"), item("b")];
      const next = removeItemCascade(items, "a");
      expect(next).toEqual([item("b")]);
    });

    it("bir çocuk silindiğinde sadece kendisi (ve varsa kendi alt ağacı) kaldırılır", () => {
      const items = [item("a"), item("a1", "a"), item("a2", "a")];
      const next = removeItemCascade(items, "a1");
      expect(next.map((i) => i.id)).toEqual(["a", "a2"]);
    });

    it("3+ seviyede TÜM alt ağacı (torunları dahil) kaskad olarak siler — orphan bırakmaz", () => {
      const items = [
        item("a"),
        item("a1", "a"),
        item("a11", "a1"),
        item("a111", "a11"),
        item("a2", "a"),
        item("b"),
      ];
      const next = removeItemCascade(items, "a1");
      expect(next.map((i) => i.id)).toEqual(["a", "a2", "b"]);
    });
  });

  describe("updateItem", () => {
    it("label/href günceller, diğer öğelere dokunmaz", () => {
      const items = [item("a"), item("b")];
      const next = updateItem(items, "a", { label: "Yeni" });
      expect(next[0]!.label).toBe("Yeni");
      expect(next[1]).toEqual(item("b"));
    });
  });

  describe("canIndent / indentItem", () => {
    it("ilk kök öğe indent edilemez (önünde aynı seviyede kardeş yok)", () => {
      const items = [item("a"), item("b")];
      expect(canIndent(items, "a")).toBe(false);
    });

    it("çocuğu olan bir öğe, alt ağacıyla birlikte sınırı aşmadığı sürece indent edilebilir", () => {
      const items = [item("a"), item("a1", "a"), item("b"), item("b1", "b")];
      // "b" indent edilirse b1 de onunla taşınır: yeni derinlik(b)=1 + height(b)=1 = 2 <= 3 (MAX_DEPTH).
      expect(canIndent(items, "b")).toBe(true);
    });

    it("indent, kendi alt ağacının yüksekliğiyle birlikte NAVIGATION_MAX_DEPTH'i aşarsa engellenir", () => {
      // "q" kök seviyede (derinlik 0) ama kendi altında q1->q2->q3 zinciri var (yükseklik 3).
      // Önünde bir kardeşi ("p") olduğu için sibling kuralını geçer, ama indent edilirse
      // derinliği 1 olur + yükseklik 3 = 4 > 3 (NAVIGATION_MAX_DEPTH) -> engellenir.
      const items = [item("p"), item("q"), item("q1", "q"), item("q2", "q1"), item("q3", "q2")];
      expect(canIndent(items, "q")).toBe(false);
    });

    it("zaten çocuk olan yaprak bir öğe, sınır aşılmıyorsa indent edilebilir", () => {
      const items = [item("a"), item("a1", "a"), item("a2", "a")];
      // a2, a1'in çocuğu olacak şekilde indent edilebilir (derinlik 2 <= 3).
      expect(canIndent(items, "a2")).toBe(true);
    });

    it("ikinci kök öğeyi indent eder — önceki kökün çocuk listesinin sonuna taşınır", () => {
      const items = [item("a"), item("a1", "a"), item("b")];
      const next = indentItem(items, "b");
      expect(next.map((i) => [i.id, i.parentId])).toEqual([
        ["a", null],
        ["a1", "a"],
        ["b", "a"],
      ]);
    });

    it("bir öğeyi kendi alt ağacıyla BİRLİKTE indent eder", () => {
      const items = [item("a"), item("b"), item("b1", "b")];
      const next = indentItem(items, "b");
      expect(next.map((i) => [i.id, i.parentId])).toEqual([
        ["a", null],
        ["b", "a"],
        ["b1", "b"],
      ]);
    });
  });

  describe("canOutdent / outdentItem", () => {
    it("kök öğe outdent edilemez", () => {
      const items = [item("a")];
      expect(canOutdent(items, "a")).toBe(false);
    });

    it("derinlik 3'teki bir öğe de outdent edilebilir (derinlikten bağımsız kural)", () => {
      const items = [item("a"), item("b", "a"), item("c", "b"), item("d", "c")];
      expect(canOutdent(items, "d")).toBe(true);
    });

    it("bir çocuğu, eski ebeveyninin kalan çocuk bloğunun hemen ardına kök olarak taşır", () => {
      const items = [item("a"), item("a1", "a"), item("a2", "a"), item("b")];
      const next = outdentItem(items, "a1");
      expect(next.map((i) => [i.id, i.parentId])).toEqual([
        ["a", null],
        ["a2", "a"],
        ["a1", null],
        ["b", null],
      ]);
    });

    it("derin bir öğeyi bir üst seviyeye (torun -> çocuk) taşır, alt ağacı birlikte gelir", () => {
      const items = [item("a"), item("b", "a"), item("c", "b"), item("c1", "c")];
      const next = outdentItem(items, "c");
      // "c", "b"nin kardeşi (yani "a"nın çocuğu) olur; "c1" onu takip eder.
      expect(next.map((i) => [i.id, i.parentId])).toEqual([
        ["a", null],
        ["b", "a"],
        ["c", "a"],
        ["c1", "c"],
      ]);
    });
  });

  describe("computeProjection", () => {
    it("önceki öğe yoksa (listenin başı) her zaman derinlik 0 döner", () => {
      const projection = computeProjection([], 0, 0, 0, 999);
      expect(projection).toEqual({ depth: 0, parentId: null });
    });

    it("pozitif yatay ofset önceki kök öğenin altına (derinlik 1) projelenir", () => {
      const without = [item("a")];
      const projection = computeProjection(without, 1, 0, 0, 40);
      expect(projection).toEqual({ depth: 1, parentId: "a" });
    });

    it("önceki öğe zaten bir çocuksa, ılımlı bir ofset aynı ebeveyne kardeş olarak projelenir", () => {
      const without = [item("a"), item("a1", "a")];
      const projection = computeProjection(without, 2, 0, 0, 20);
      expect(projection).toEqual({ depth: 1, parentId: "a" });
    });

    it("NAVIGATION_MAX_DEPTH'i aşamaz — aşırı büyük ofsette bile önceki öğenin derinliği+1 ile sınırlanır", () => {
      const without = [item("a"), item("b", "a"), item("c", "b"), item("d", "c")];
      // "d" zaten NAVIGATION_MAX_DEPTH (3) derinliğinde; ondan sonrasına eklenen bir öğe en fazla
      // derinlik 4'e projelenmeye çalışsa da tavan (previousDepth+1=4) NAVIGATION_MAX_DEPTH'in
      // KENDİSİYLE de sınırlanmalı (depthCeiling burada MAX_DEPTH - 0 = 3).
      const projection = computeProjection(without, 4, 0, 0, 999);
      expect(projection.depth).toBe(NAVIGATION_MAX_DEPTH);
    });

    it("alt ağacı olan (yüksekliği > 0) bir öğe için izin verilen maksimum derinlik düşer", () => {
      const without = [item("a"), item("b", "a"), item("c", "b")];
      // previousItem "c" derinlik 2; aktif öğenin yüksekliği 1 (bir çocuğu var) -> depthCeiling = 3-1=2.
      // previousDepth+1 = 3 ama depthCeiling 2 olduğu için nihai derinlik 2'ye sınırlanır.
      const projection = computeProjection(without, 3, 1, 0, 999);
      expect(projection.depth).toBe(2);
    });

    it("negatif ofset derinliği azaltır, 0'ın altına inmez", () => {
      const without = [item("a"), item("a1", "a")];
      const projection = computeProjection(without, 2, 0, 1, -999);
      expect(projection.depth).toBe(0);
      expect(projection.parentId).toBeNull();
    });
  });

  describe("moveItem", () => {
    it("iki kök öğeyi yer değiştirir (yatay ofset yok → derinlik korunur)", () => {
      const items = [item("a"), item("b")];
      const next = moveItem(items, "b", "a", 0);
      expect(next.map((i) => i.id)).toEqual(["b", "a"]);
      expect(next.every((i) => i.parentId === null)).toBe(true);
    });

    it("bir kök öğeyi TÜM alt ağacıyla BİRLİKTE taşır (blok bütünlüğü korunur)", () => {
      const items = [item("a"), item("a1", "a"), item("a11", "a1"), item("b")];
      const next = moveItem(items, "b", "a", 0);
      expect(next.map((i) => i.id)).toEqual(["b", "a", "a1", "a11"]);
      expect(next.find((i) => i.id === "a1")!.parentId).toBe("a");
      expect(next.find((i) => i.id === "a11")!.parentId).toBe("a1");
    });

    it("bir kök öğeyi başka bir kökün çocuğu yapar (nesting, yatay ofsetle)", () => {
      const items = [item("a"), item("b")];
      const next = moveItem(items, "b", null, 40);
      expect(next.map((i) => [i.id, i.parentId])).toEqual([
        ["a", null],
        ["b", "a"],
      ]);
    });

    it("yatay ofset olmadan (offsetX=0) listenin sonuna bırakma, kök seviyede sona taşır", () => {
      const items = [item("a"), item("b")];
      const next = moveItem(items, "b", null, 0);
      expect(next.map((i) => [i.id, i.parentId])).toEqual([
        ["a", null],
        ["b", null],
      ]);
    });
  });

  describe("canMoveUpSibling / canMoveDownSibling / moveSibling", () => {
    it("ilk kök öğe yukarı taşınamaz, son kök öğe aşağı taşınamaz", () => {
      const items = [item("a"), item("b"), item("c")];
      expect(canMoveUpSibling(items, "a")).toBe(false);
      expect(canMoveDownSibling(items, "c")).toBe(false);
      expect(canMoveUpSibling(items, "b")).toBe(true);
      expect(canMoveDownSibling(items, "b")).toBe(true);
    });

    it("olmayan bir id için her ikisi de false döner", () => {
      const items = [item("a")];
      expect(canMoveUpSibling(items, "yok")).toBe(false);
      expect(canMoveDownSibling(items, "yok")).toBe(false);
    });

    it("iki kök öğeyi yer değiştirir, parentId DEĞİŞMEZ", () => {
      const items = [item("a"), item("b"), item("c")];
      const next = moveSibling(items, "b", -1);
      expect(next.map((i) => i.id)).toEqual(["b", "a", "c"]);
      expect(next.every((i) => i.parentId === null)).toBe(true);
    });

    it("bir kök öğeyi çocuklarıyla BİRLİKTE taşır (blok bütünlüğü korunur)", () => {
      const items = [item("a"), item("a1", "a"), item("b")];
      const next = moveSibling(items, "b", -1);
      expect(next.map((i) => i.id)).toEqual(["b", "a", "a1"]);
      expect(next.find((i) => i.id === "a1")!.parentId).toBe("a");
    });

    it("aynı ebeveyne sahip iki çocuğu (kardeşi) yer değiştirir, kök seviye ETKİLENMEZ", () => {
      const items = [item("a"), item("a1", "a"), item("a2", "a"), item("b")];
      const next = moveSibling(items, "a1", 1);
      expect(next.map((i) => [i.id, i.parentId])).toEqual([
        ["a", null],
        ["a2", "a"],
        ["a1", "a"],
        ["b", null],
      ]);
    });

    it("hareket mümkün değilse (canMove false) diziyi DEĞİŞTİRMEDEN döner", () => {
      const items = [item("a"), item("b")];
      expect(moveSibling(items, "a", -1)).toEqual(items);
      expect(moveSibling(items, "b", 1)).toEqual(items);
    });
  });

  describe("buildTree / toNavigationItemsPayload", () => {
    it("kök+çocuk yapısını doğru gruplar ve kardeş-kapsamlı order üretir", () => {
      const items = [item("a"), item("a1", "a"), item("a2", "a"), item("b"), item("b1", "b")];
      const tree = buildTree(items);
      expect(tree).toHaveLength(2);
      expect(tree[0]!.children.map((c) => c.item.id)).toEqual(["a1", "a2"]);

      const payload = toNavigationItemsPayload(items);
      expect(payload).toEqual([
        { id: "a", label: "a", href: "/a", order: 0, parentId: null },
        { id: "a1", label: "a1", href: "/a1", order: 0, parentId: "a" },
        { id: "a2", label: "a2", href: "/a2", order: 1, parentId: "a" },
        { id: "b", label: "b", href: "/b", order: 1, parentId: null },
        { id: "b1", label: "b1", href: "/b1", order: 0, parentId: "b" },
      ]);
    });

    it("4 seviyeli bir ağacı doğru gruplar ve her seviyede kardeş-kapsamlı order üretir", () => {
      const items = [item("a"), item("b", "a"), item("c", "b"), item("d", "c")];
      const tree = buildTree(items);
      expect(tree).toHaveLength(1);
      expect(tree[0]!.children[0]!.children[0]!.children[0]!.item.id).toBe("d");

      const payload = toNavigationItemsPayload(items);
      expect(payload).toEqual([
        { id: "a", label: "a", href: "/a", order: 0, parentId: null },
        { id: "b", label: "b", href: "/b", order: 0, parentId: "a" },
        { id: "c", label: "c", href: "/c", order: 0, parentId: "b" },
        { id: "d", label: "d", href: "/d", order: 0, parentId: "c" },
      ]);
    });

    it("ebeveyni payload'da bulunamayan (orphan) öğeleri ATLAR, geri kalan ağacı düşürmez", () => {
      const items = [item("a"), item("orphan", "yok"), item("b")];
      const tree = buildTree(items);
      expect(tree.map((n) => n.item.id)).toEqual(["a", "b"]);
    });
  });
});
