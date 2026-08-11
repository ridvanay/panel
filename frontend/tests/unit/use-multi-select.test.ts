import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { KeyboardEvent } from "react";
import { useMultiSelect } from "@/hooks/use-multi-select";

/**
 * §10.11.5 Gelişmiş çoklu seçim — `use-multi-select.ts` çağırandan (Grid/Liste) BAĞIMSIZ, izole
 * test edilebilir bir hook (herhangi bir DOM/component'e bağımlılığı yok, `handleGridKeyDown`
 * hariç — o da yalnızca `event.target`/`ctrlKey`/`metaKey`/`key` okur, gerçek bir React event
 * gerektirmez). qa-agent kullanıcı odak noktası #1 — backend-agent/frontend-agent'ın smoke
 * testleri bu hook'u hiç doğrudan test etmiyordu, bu dosya boşluğu kapatır.
 */

const VISIBLE_IDS = ["a", "b", "c", "d", "e"];

function makeGridKeyDownEvent(
  overrides: Partial<{ tagName: string; isContentEditable: boolean; ctrlKey: boolean; metaKey: boolean; key: string }> = {}
) {
  const target = document.createElement(overrides.tagName ?? "DIV");
  if (overrides.isContentEditable) {
    Object.defineProperty(target, "isContentEditable", { value: true });
  }
  let prevented = false;
  const event = {
    target,
    ctrlKey: overrides.ctrlKey ?? false,
    metaKey: overrides.metaKey ?? false,
    key: overrides.key ?? "a",
    preventDefault: () => {
      prevented = true;
    },
  } as unknown as KeyboardEvent;
  return { event, wasPrevented: () => prevented };
}

describe("useMultiSelect", () => {
  describe("toggle", () => {
    it("tekil öğeyi seçer, tekrar çağrılınca kaldırır", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));
      act(() => result.current.toggle("b"));
      expect(result.current.selectedIds.has("b")).toBe(true);
      act(() => result.current.toggle("b"));
      expect(result.current.selectedIds.has("b")).toBe(false);
    });
  });

  describe("shift+tık aralık seçimi", () => {
    it("anchor'dan hedefe (ileri yönde) TÜM görünen öğeleri seçer", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));
      act(() => result.current.toggle("b")); // anchor = b (index 1)

      let handled = false;
      act(() => {
        handled = result.current.handleItemClick("d", { shiftKey: true, ctrlKey: false, metaKey: false });
      });

      expect(handled).toBe(true);
      expect([...result.current.selectedIds].sort()).toEqual(["b", "c", "d"]);
    });

    it("anchor'dan hedefe (GERİ yönde) tıklanınca da aralığı doğru hesaplar", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));
      act(() => result.current.toggle("d")); // anchor = d (index 3)

      act(() => {
        result.current.handleItemClick("b", { shiftKey: true, ctrlKey: false, metaKey: false });
      });

      expect([...result.current.selectedIds].sort()).toEqual(["b", "c", "d"]);
    });

    it("aralık seçimi ÖNCEKİ seçimin üzerine EKLEMEZ, seçimi aralıkla DEĞİŞTİRİR", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));
      act(() => result.current.toggle("a")); // önce alakasız bir öğe seçili + anchor = a
      act(() => result.current.toggle("e")); // anchor artık e, seçili = {a, e}

      act(() => {
        result.current.handleItemClick("d", { shiftKey: true, ctrlKey: false, metaKey: false });
      });

      // Aralık e→d = {d, e} — "a" aralığın dışında kaldığı için seçimden DÜŞMELİ.
      expect([...result.current.selectedIds].sort()).toEqual(["d", "e"]);
    });

    it("hiç anchor yokken (henüz tıklanmamışken) shift+tık aralık seçmez, false döner", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));

      let handled = true;
      act(() => {
        handled = result.current.handleItemClick("b", { shiftKey: true, ctrlKey: false, metaKey: false });
      });

      expect(handled).toBe(false);
      expect(result.current.selectedIds.size).toBe(0);
    });

    it("clear() sonrası anchor sıfırlanır — bir sonraki shift+tık aralık seçmez", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));
      act(() => result.current.toggle("b"));
      act(() => result.current.clear());

      let handled = true;
      act(() => {
        handled = result.current.handleItemClick("d", { shiftKey: true, ctrlKey: false, metaKey: false });
      });

      expect(handled).toBe(false);
      expect(result.current.selectedIds.size).toBe(0);
    });
  });

  describe("ctrl/cmd+tık tekil toggle", () => {
    it("ctrl+tık seçili değilse ekler ve true döner", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));

      let handled = false;
      act(() => {
        handled = result.current.handleItemClick("c", { shiftKey: false, ctrlKey: true, metaKey: false });
      });

      expect(handled).toBe(true);
      expect(result.current.selectedIds.has("c")).toBe(true);
    });

    it("ctrl+tık zaten seçiliyse ÇIKARIR (toggle)", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));
      act(() => result.current.toggle("c"));

      act(() => {
        result.current.handleItemClick("c", { shiftKey: false, ctrlKey: true, metaKey: false });
      });

      expect(result.current.selectedIds.has("c")).toBe(false);
    });

    it("cmd (metaKey)+tık ctrl ile AYNI davranışı gösterir (macOS)", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));

      act(() => {
        result.current.handleItemClick("c", { shiftKey: false, ctrlKey: false, metaKey: true });
      });

      expect(result.current.selectedIds.has("c")).toBe(true);
    });

    it("düz tıklama (modifiersız) false döner — çağıran taraf normal davranışı (önizleme) tetikleyebilir", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));

      let handled = true;
      act(() => {
        handled = result.current.handleItemClick("c", { shiftKey: false, ctrlKey: false, metaKey: false });
      });

      expect(handled).toBe(false);
      expect(result.current.selectedIds.size).toBe(0);
    });
  });

  describe("Ctrl+A / Cmd+A — 'o an görünen' tümünü seçme", () => {
    it("medya ızgarası odaktayken (input DEĞİLKEN) Ctrl+A tüm görüneni seçer ve preventDefault çağırır", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));
      const { event, wasPrevented } = makeGridKeyDownEvent({ tagName: "DIV", ctrlKey: true, key: "a" });

      act(() => result.current.handleGridKeyDown(event));

      expect(wasPrevented()).toBe(true);
      expect([...result.current.selectedIds].sort()).toEqual([...VISIBLE_IDS].sort());
    });

    it("Cmd+A (metaKey, macOS) da aynı şekilde tetiklenir, büyük/küçük harf duyarsız", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));
      const { event } = makeGridKeyDownEvent({ tagName: "DIV", metaKey: true, key: "A" });

      act(() => result.current.handleGridKeyDown(event));

      expect(result.current.selectedIds.size).toBe(VISIBLE_IDS.length);
    });

    it("bir <input> odaktayken Ctrl+A ASLA tetiklenmez (native metin seçimi korunur)", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));
      const { event, wasPrevented } = makeGridKeyDownEvent({ tagName: "INPUT", ctrlKey: true, key: "a" });

      act(() => result.current.handleGridKeyDown(event));

      expect(wasPrevented()).toBe(false);
      expect(result.current.selectedIds.size).toBe(0);
    });

    it("bir <textarea> odaktayken Ctrl+A ASLA tetiklenmez", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));
      const { event, wasPrevented } = makeGridKeyDownEvent({ tagName: "TEXTAREA", ctrlKey: true, key: "a" });

      act(() => result.current.handleGridKeyDown(event));

      expect(wasPrevented()).toBe(false);
      expect(result.current.selectedIds.size).toBe(0);
    });

    it("contentEditable bir öğe odaktayken Ctrl+A ASLA tetiklenmez", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));
      const { event, wasPrevented } = makeGridKeyDownEvent({ tagName: "DIV", isContentEditable: true, ctrlKey: true, key: "a" });

      act(() => result.current.handleGridKeyDown(event));

      expect(wasPrevented()).toBe(false);
      expect(result.current.selectedIds.size).toBe(0);
    });

    it("Ctrl olmadan sadece 'a' tuşuna basmak hiçbir şey seçmez", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));
      const { event } = makeGridKeyDownEvent({ tagName: "DIV", ctrlKey: false, metaKey: false, key: "a" });

      act(() => result.current.handleGridKeyDown(event));

      expect(result.current.selectedIds.size).toBe(0);
    });
  });

  describe("toggleSelectAll (Liste görünümü — üst checkbox)", () => {
    it("hiçbiri seçili değilken tümünü seçer", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));
      act(() => result.current.toggleSelectAll());
      expect(result.current.selectedIds.size).toBe(VISIBLE_IDS.length);
    });

    it("tümü seçiliyken tekrar çağrılınca tümünü kaldırır", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));
      act(() => result.current.toggleSelectAll());
      act(() => result.current.toggleSelectAll());
      expect(result.current.selectedIds.size).toBe(0);
    });

    it("KISMEN seçiliyken (indeterminate) çağrılırsa TÜMÜNÜ seçer (kaldırmaz)", () => {
      const { result } = renderHook(() => useMultiSelect(VISIBLE_IDS));
      act(() => result.current.toggle("a"));
      act(() => result.current.toggleSelectAll());
      expect(result.current.selectedIds.size).toBe(VISIBLE_IDS.length);
    });
  });

  describe("Grid ve Liste arasında paylaşılan davranış", () => {
    it("aynı `visibleIds` dizisiyle shift-aralık hesaplaması Grid/Liste için birebir aynıdır", () => {
      const gridHook = renderHook(() => useMultiSelect(VISIBLE_IDS));
      const listHook = renderHook(() => useMultiSelect(VISIBLE_IDS));

      for (const hook of [gridHook, listHook]) {
        act(() => hook.result.current.toggle("a"));
        act(() => hook.result.current.handleItemClick("c", { shiftKey: true, ctrlKey: false, metaKey: false }));
      }

      expect([...gridHook.result.current.selectedIds].sort()).toEqual([...listHook.result.current.selectedIds].sort());
      expect([...gridHook.result.current.selectedIds].sort()).toEqual(["a", "b", "c"]);
    });
  });
});
