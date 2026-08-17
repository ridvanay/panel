import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useContentList } from "@/components/admin/content-list/use-content-list";
import type { ContentListEntity } from "@/components/admin/content-list/types";
import type { BulkContentActionResult, Page } from "@/lib/api/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

type FakeItem = ContentListEntity;

function makeItem(overrides: Partial<FakeItem>): FakeItem {
  return {
    id: overrides.id ?? "item-1",
    title: "Başlık",
    slug: "baslik",
    status: "PUBLISHED",
    deletedAt: null,
    authorId: null,
    author: null,
    seoScore: 100,
    seoScoreIssues: [],
    publishedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    viewCount: 0,
    ...overrides,
  };
}

describe("useContentList", () => {
  const published = makeItem({ id: "1", status: "PUBLISHED" });
  const draft = makeItem({ id: "2", status: "DRAFT", deletedAt: null });
  const trashed = makeItem({ id: "3", status: "DRAFT", deletedAt: "2026-01-05T00:00:00.000Z" });

  function createMocks() {
    return {
      fetchList: vi.fn(
        async (): Promise<Page<FakeItem>> => ({
          items: [published, draft, trashed],
          meta: { nextCursor: null, counts: { all: 2, published: 1, draft: 1, trashed: 1 } },
        })
      ),
      updateItem: vi.fn(async (id: string, input: Partial<FakeItem>) => ({ ...published, id, ...input })),
      trashItem: vi.fn(async () => undefined),
      restoreItem: vi.fn(async (id: string) => ({ ...trashed, id, deletedAt: null })),
      permanentDeleteItem: vi.fn(async () => undefined),
      bulkAction: vi.fn(
        async (): Promise<BulkContentActionResult> => ({
          action: "trash",
          requestedCount: 1,
          affectedCount: 1,
          skippedIds: [],
        })
      ),
    };
  }

  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
  });

  function setup() {
    return renderHook(() =>
      useContentList<FakeItem>({
        ...mocks,
        matches: (item, query) => item.title.toLowerCase().includes(query),
        nounSingular: "Sayfa",
      })
    );
  }

  it("yükleme sonrası sekme sayaçlarını meta.counts'tan alır (client-side hesaplamaz)", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.counts).toEqual({ all: 2, published: 1, draft: 1, trashed: 1 });
  });

  it("varsayılan 'all' sekmesi çöpteki kayıtları HARİÇ tutar", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visibleItems.map((i) => i.id).sort()).toEqual(["1", "2"]);
  });

  it("'trashed' sekmesi yalnızca çöptekileri gösterir", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setActiveFilter("trashed"));
    await waitFor(() => expect(result.current.visibleItems.map((i) => i.id)).toEqual(["3"]));
  });

  it("Hızlı Düzenle kaydı updateItem'ı çağırır ve öğeyi günceller", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.startQuickEdit(published));
    act(() => result.current.updateQuickEditValues({ title: "Yeni Başlık" }));
    await act(async () => {
      await result.current.saveQuickEdit();
    });

    expect(mocks.updateItem).toHaveBeenCalledWith("1", expect.objectContaining({ title: "Yeni Başlık" }));
    expect(result.current.editingId).toBeNull();
  });

  it("toplu işlem seçili id'leri gönderir ve seçimi temizler", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleSelect("1"));
    await act(async () => {
      await result.current.runBulkAction("trash");
    });

    expect(mocks.bulkAction).toHaveBeenCalledWith(["1"], "trash");
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("kalıcı sil onayı permanentDeleteItem'ı çağırır", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.requestPermanentDelete(trashed));
    expect(result.current.pendingPermanentDelete?.id).toBe("3");

    await act(async () => {
      await result.current.confirmPermanentDelete();
    });

    expect(mocks.permanentDeleteItem).toHaveBeenCalledWith("3");
    expect(result.current.pendingPermanentDelete).toBeNull();
  });

  it("sekme değişince toplu işlem varsayılanı ve seçim sıfırlanır", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleSelect("1"));
    expect(result.current.selectedIds.size).toBe(1);

    act(() => result.current.setActiveFilter("trashed"));

    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.bulkSelectAction).toBe("restore");
  });

  // §10.7.2 — generic ikinci parametre (Q): Blog gibi entity'ye özgü alanlar `quickEditExtras`
  // ile başlangıç değerlerine dahil olur; ortak `QuickEditValues` DEĞİŞMEDEN kalır.
  it("quickEditExtras verildiğinde startQuickEdit entity'ye özgü alanları da başlangıç değerine katar", async () => {
    interface BlogLikeItem extends FakeItem {
      categoryId: string | null;
    }
    interface BlogLikeQuickEditValues {
      title: string;
      slug: string;
      status: FakeItem["status"];
      categoryId: string | null;
      tagIds: string[];
    }
    const blogPost: BlogLikeItem = { ...published, categoryId: "cat-1" };

    const { result } = renderHook(() =>
      useContentList<BlogLikeItem, BlogLikeQuickEditValues>({
        fetchList: vi.fn(async () => ({
          items: [blogPost],
          meta: { nextCursor: null, counts: { all: 1, published: 1, draft: 0, trashed: 0 } },
        })),
        updateItem: vi.fn(async (id, input) => ({ ...blogPost, id, ...input })),
        trashItem: vi.fn(async () => undefined),
        restoreItem: vi.fn(async (id) => ({ ...blogPost, id })),
        permanentDeleteItem: vi.fn(async () => undefined),
        bulkAction: vi.fn(
          async (): Promise<BulkContentActionResult> => ({
            action: "trash",
            requestedCount: 0,
            affectedCount: 0,
            skippedIds: [],
          })
        ),
        matches: (item, query) => item.title.toLowerCase().includes(query),
        nounSingular: "Yazı",
        quickEditExtras: (item) => ({ categoryId: item.categoryId, tagIds: ["tag-1"] }),
      })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.startQuickEdit(blogPost));

    expect(result.current.quickEditValues).toEqual(
      expect.objectContaining({ title: "Başlık", categoryId: "cat-1", tagIds: ["tag-1"] })
    );
  });

  // §10.14.5 — Blog'un (opsiyonel) etikete göre filtresi gibi ek daraltmalar sekme
  // filtresinden SONRA, arama/sayfalamadan ÖNCE uygulanır.
  it("filterTabItems sekme filtresinden sonra ek daraltma uygular", async () => {
    const { result } = renderHook(() =>
      useContentList<FakeItem>({
        ...mocks,
        matches: (item, query) => item.title.toLowerCase().includes(query),
        nounSingular: "Sayfa",
        filterTabItems: (items) => items.filter((i) => i.id === "1"),
      })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.visibleItems.map((i) => i.id)).toEqual(["1"]);
    // `tabItems` (CSV dışa aktarma vb. için) daraltmadan ETKİLENMEZ — 'all' sekmesindeki tüm öğeler.
    expect(result.current.tabItems.map((i) => i.id).sort()).toEqual(["1", "2"]);
  });
});
