import { describe, expect, it } from "vitest";
import {
  appendRootItems,
  buildTree,
  canIndent,
  canMoveDownSibling,
  canMoveUpSibling,
  canOutdent,
  computeProjection,
  indentItem,
  moveItem,
  moveSibling,
  outdentItem,
  removeItemCascade,
  toNavigationItemsPayload,
  updateItem,
  type FlatNavItem,
} from "@/components/admin/navigation/nav-tree-utils";

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

  describe("removeItemCascade", () => {
    it("bir kök öğe silindiğinde çocukları da kaldırır", () => {
      const items = [item("a"), item("a1", "a"), item("b")];
      const next = removeItemCascade(items, "a");
      expect(next).toEqual([item("b")]);
    });

    it("bir çocuk silindiğinde sadece kendisi kaldırılır", () => {
      const items = [item("a"), item("a1", "a"), item("a2", "a")];
      const next = removeItemCascade(items, "a1");
      expect(next.map((i) => i.id)).toEqual(["a", "a2"]);
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
    it("ilk kök öğe indent edilemez (önünde başka kök yok)", () => {
      const items = [item("a"), item("b")];
      expect(canIndent(items, "a")).toBe(false);
    });

    it("çocuğu olan bir kök öğe indent edilemez (3. seviye engeli)", () => {
      const items = [item("a"), item("a1", "a"), item("b")];
      expect(canIndent(items, "b")).toBe(true);
      expect(canIndent(items, "a")).toBe(false);
    });

    it("zaten çocuk olan bir öğe (depth 1) indent edilemez", () => {
      const items = [item("a"), item("a1", "a")];
      expect(canIndent(items, "a1")).toBe(false);
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
  });

  describe("canOutdent / outdentItem", () => {
    it("kök öğe outdent edilemez", () => {
      const items = [item("a")];
      expect(canOutdent(items, "a")).toBe(false);
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
  });

  describe("computeProjection", () => {
    it("önceki öğe yoksa (listenin başı) her zaman derinlik 0 döner", () => {
      const projection = computeProjection([], 0, false, 0, 999);
      expect(projection).toEqual({ depth: 0, parentId: null });
    });

    it("pozitif yatay ofset önceki kök öğenin altına (derinlik 1) projelenir", () => {
      const without = [item("a")];
      const projection = computeProjection(without, 1, false, 0, 40);
      expect(projection).toEqual({ depth: 1, parentId: "a" });
    });

    it("önceki öğe zaten bir çocuksa aynı ebeveyne kardeş olarak projelenir", () => {
      const without = [item("a"), item("a1", "a")];
      const projection = computeProjection(without, 2, false, 0, 40);
      expect(projection).toEqual({ depth: 1, parentId: "a" });
    });

    it("maksimum derinlik 2'yi (kök+1) aşamaz — önceki öğe zaten derinlik 1 olsa bile", () => {
      const without = [item("a"), item("a1", "a")];
      // Aşırı büyük ofset verilse bile derinlik en fazla önceki öğenin derinliği+1 ile sınırlanır,
      // bu da burada zaten 1 (MAX_DEPTH) ile sınırlı.
      const projection = computeProjection(without, 2, false, 0, 999);
      expect(projection.depth).toBe(1);
    });

    it("çocuğu olan bir öğe için projelenen derinlik her zaman 0'dır", () => {
      const without = [item("a")];
      const projection = computeProjection(without, 1, true, 0, 999);
      expect(projection).toEqual({ depth: 0, parentId: null });
    });

    it("negatif ofset derinliği azaltır, 0'ın altına inmez", () => {
      const without = [item("a"), item("a1", "a")];
      const projection = computeProjection(without, 2, false, 1, -999);
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

    it("bir kök öğeyi çocuklarıyla BİRLİKTE taşır (blok bütünlüğü korunur)", () => {
      const items = [item("a"), item("a1", "a"), item("b")];
      const next = moveItem(items, "b", "a", 0);
      // "b" en başa taşınır; "a" ve çocuğu "a1" birlikte, sıraları bozulmadan onu takip eder.
      expect(next.map((i) => i.id)).toEqual(["b", "a", "a1"]);
      expect(next.find((i) => i.id === "a1")!.parentId).toBe("a");
    });

    it("bir kök öğeyi başka bir kökün çocuğu yapar (nesting, yatay ofsetle)", () => {
      // Son öğenin altına iç-içe geçirmenin tek yolu: pointer listenin sonunu geçer
      // (dnd-kit `DragEndEvent.over === null`) — bu durumda "önceki öğe" son kalan kök olur.
      const items = [item("a"), item("b")];
      const next = moveItem(items, "b", null, 40);
      // "b", "a"nın hemen ardına (çocuğu olarak) eklenir.
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
      expect(tree[0]!.children.map((c) => c.id)).toEqual(["a1", "a2"]);

      const payload = toNavigationItemsPayload(items);
      expect(payload).toEqual([
        { id: "a", label: "a", href: "/a", order: 0, parentId: null },
        { id: "a1", label: "a1", href: "/a1", order: 0, parentId: "a" },
        { id: "a2", label: "a2", href: "/a2", order: 1, parentId: "a" },
        { id: "b", label: "b", href: "/b", order: 1, parentId: null },
        { id: "b1", label: "b1", href: "/b1", order: 0, parentId: "b" },
      ]);
    });
  });
});
