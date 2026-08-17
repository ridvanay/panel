import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFilteredList } from "@/hooks/use-filtered-list";

interface Item {
  id: string;
  title: string;
}

function makeItems(count: number): Item[] {
  return Array.from({ length: count }, (_, i) => ({ id: String(i), title: `Öğe ${i}` }));
}

function matches(item: Item, query: string): boolean {
  return item.title.toLowerCase().includes(query);
}

describe("useFilteredList", () => {
  // §10.7.1 — üretimde doğrulanmış kritik bug: `totalPages` SAYFA sayısıdır, öğe sayısı
  // DEĞİLDİR. 229 öğe + 50/sayfa → totalPages=5 (bkz. ARCHITECTURE.md §10.7.1 tablosu).
  // Çağıran taraf (`blog/page.tsx` vb.) bu değeri `> 1` eşiğiyle göstermelidir, `> 10` DEĞİL —
  // aksi halde sayfalama/sayfa-boyutu kontrolleri 50/sayfa'da sessizce kaybolur.
  it("229 öğe + 50/sayfa → totalPages=5 (>1 ile GÖRÜNÜR olması gereken, >10 ile YANLIŞLIKLA gizlenen durum)", () => {
    const { result } = renderHook(() => useFilteredList<Item>(makeItems(229), matches));

    act(() => result.current.setPageSize(50));

    expect(result.current.totalPages).toBe(5);
    expect(result.current.totalPages > 1).toBe(true);
    // Eski (hatalı) kural — bu artık YANLIŞ bir eşiktir, kontrollerin gizlenmesine yol açardı.
    expect(result.current.totalPages > 10).toBe(false);
  });

  it("pageSize değişince sayfa 1'e sıfırlanır (50/sayfa'dan 10/sayfa'ya dönünce kilitlenme YOK)", () => {
    const { result } = renderHook(() => useFilteredList<Item>(makeItems(229), matches));

    act(() => result.current.setPageSize(50));
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);

    act(() => result.current.setPageSize(10));
    expect(result.current.page).toBe(1);
    expect(result.current.totalPages).toBe(23);
  });

  it("totalPages her zaman en az 1'dir (boş listede kontroller >1 eşiğiyle gizli kalır)", () => {
    const { result } = renderHook(() => useFilteredList<Item>([], matches));
    expect(result.current.totalPages).toBe(1);
    expect(result.current.totalPages > 1).toBe(false);
  });
});
