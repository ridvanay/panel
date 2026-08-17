"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { useFilteredList } from "@/hooks/use-filtered-list";
import type { BulkContentAction, BulkContentActionResult, ContentCounts, Page, TrashedFilter } from "@/lib/api/types";
import type { ContentListEntity, ContentListFilter, QuickEditValues } from "./types";

const EMPTY_COUNTS: ContentCounts = { all: 0, published: 0, draft: 0, trashed: 0 };

const BULK_ACTION_LABELS: Record<BulkContentAction, string> = {
  trash: "çöpe taşındı",
  restore: "geri yüklendi",
  publish: "yayınlandı",
  draft: "taslağa alındı",
  "permanent-delete": "kalıcı olarak silindi",
};

export interface UseContentListOptions<T extends ContentListEntity, Q extends QuickEditValues = QuickEditValues> {
  /** `pagesApi.listPages` / `blogApi.listPosts` — modül seviyesinde sabit referans olmalı. */
  fetchList: (params: { cursor?: string; trashed?: TrashedFilter; limit?: number }) => Promise<Page<T>>;
  updateItem: (id: string, input: Partial<Q>) => Promise<T>;
  /** Soft-delete (çöpe taşı) — mevcut `deletePage`/`deletePost`. */
  trashItem: (id: string) => Promise<void>;
  restoreItem: (id: string) => Promise<T>;
  permanentDeleteItem: (id: string) => Promise<void>;
  bulkAction: (ids: string[], action: BulkContentAction) => Promise<BulkContentActionResult>;
  matches: (item: T, query: string) => boolean;
  /** Toast mesajlarında kullanılan tekil ad — örn. "Sayfa" / "Yazı". */
  nounSingular: string;
  /**
   * §10.7.2 — entity'ye özgü Hızlı Düzenle alanlarının (ör. Blog Kategori/Etiket)
   * başlangıç değerlerini satırdan üretir. Verilmezse `startQuickEdit` bugünkü
   * `{ title, slug, status }` davranışını korur.
   */
  quickEditExtras?: (item: T) => Omit<Q, keyof QuickEditValues>;
  /**
   * §10.14.5 — entity'ye özgü ek daraltma (ör. Blog'un etikete göre filtresi). Sekme
   * filtresinden SONRA, arama/sayfalamadan ÖNCE uygulanır. Verilmezse hiçbir şey değişmez.
   */
  filterTabItems?: (items: T[]) => T[];
}

function filterByTab<T extends ContentListEntity>(items: T[], filter: ContentListFilter): T[] {
  switch (filter) {
    case "all":
      return items.filter((i) => i.deletedAt === null);
    case "published":
      return items.filter((i) => i.deletedAt === null && i.status === "PUBLISHED");
    case "draft":
      return items.filter((i) => i.deletedAt === null && i.status === "DRAFT");
    case "trashed":
      return items.filter((i) => i.deletedAt !== null);
  }
}

/**
 * Sayfalar/Blog liste ekranlarının paylaştığı TÜM state+akış mantığı: `trashed=include`
 * ile tam listeyi çeker (gerekirse cursor'la devam eder), sekme filtresini bellekte
 * uygular, ardından `useFilteredList` ile arama+sayfalamayı devreder. Seçim, Hızlı
 * Düzenle ve tekil/toplu çöp-geri yükle-kalıcı sil akışlarını da kapsar.
 */
export function useContentList<T extends ContentListEntity, Q extends QuickEditValues = QuickEditValues>({
  fetchList,
  updateItem,
  trashItem,
  restoreItem,
  permanentDeleteItem,
  bulkAction,
  matches,
  nounSingular,
  quickEditExtras,
  filterTabItems,
}: UseContentListOptions<T, Q>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [counts, setCounts] = useState<ContentCounts>(EMPTY_COUNTS);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilterRaw] = useState<ContentListFilter>("all");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [editingId, setEditingId] = useState<string | null>(null);
  // Başlangıç değeri yalnızca bir yer tutucudur — `editingId === null` iken hiç render
  // edilmez, gerçek değerler `startQuickEdit` içinde (extras dahil) kurulur.
  const [quickEditValues, setQuickEditValues] = useState<Q>({
    title: "",
    slug: "",
    status: "DRAFT",
  } as Q);
  const [quickEditSaving, setQuickEditSaving] = useState(false);
  const [quickEditError, setQuickEditError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingPermanentDelete, setPendingPermanentDelete] = useState<T | null>(null);
  const [permanentDeleting, setPermanentDeleting] = useState(false);

  const [bulkApplying, setBulkApplying] = useState(false);
  const [pendingBulkPermanentDelete, setPendingBulkPermanentDelete] = useState(false);
  const [bulkSelectAction, setBulkSelectAction] = useState<BulkContentAction | "delete">("publish");

  const load = useCallback(async () => {
    try {
      let cursor: string | undefined;
      const collected: T[] = [];
      let nextCounts: ContentCounts = EMPTY_COUNTS;
      // `meta.counts` filtrelerden etkilenmez; tam liste `trashed=include` ile çekilir.
      while (true) {
        const result = await fetchList({ cursor, trashed: "include", limit: 100 });
        collected.push(...result.items);
        if (result.meta.counts) nextCounts = result.meta.counts;
        if (!result.meta.nextCursor) break;
        cursor = result.meta.nextCursor;
      }
      setItems(collected);
      setCounts(nextCounts);
      setError(null);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, [fetchList]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  function setActiveFilter(filter: ContentListFilter) {
    setActiveFilterRaw(filter);
    setSelectedIds(new Set());
    // Toplu işlem seçenekleri sekmeye göre değişir (bkz. ContentListBulkBar) — geçersiz
    // bir seçimde kalınmasın diye sekmeye uygun varsayılana sıfırlanır.
    setBulkSelectAction(filter === "trashed" ? "restore" : "publish");
  }

  const tabItems = useMemo(() => (items ? filterByTab(items, activeFilter) : []), [items, activeFilter]);

  // §10.14.5 — Blog'un (opsiyonel) etikete göre filtresi gibi entity'ye özgü ek daraltmalar
  // sekme filtresinden SONRA, arama/sayfalamadan ÖNCE uygulanır. Verilmezse `tabItems` aynen geçer.
  const searchableItems = useMemo(
    () => (filterTabItems ? filterTabItems(tabItems) : tabItems),
    [filterTabItems, tabItems]
  );

  const {
    search,
    setSearch,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    filteredCount,
    items: visibleItems,
  } = useFilteredList(items === null ? null : searchableItems, matches);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (visibleItems.length === 0) return;
    const visibleIds = visibleItems.map((i) => i.id);
    const allVisibleSelected = visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  const allSelected = visibleItems.length > 0 && visibleItems.every((i) => selectedIds.has(i.id));

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function startQuickEdit(item: T) {
    setEditingId(item.id);
    const base: QuickEditValues = { title: item.title, slug: item.slug, status: item.status };
    const extras = quickEditExtras ? quickEditExtras(item) : ({} as Omit<Q, keyof QuickEditValues>);
    setQuickEditValues({ ...base, ...extras } as Q);
    setQuickEditError(null);
  }

  function cancelQuickEdit() {
    setEditingId(null);
    setQuickEditError(null);
  }

  function updateQuickEditValues(partial: Partial<Q>) {
    setQuickEditValues((prev) => ({ ...prev, ...partial }));
  }

  async function saveQuickEdit() {
    if (!editingId) return;
    setQuickEditSaving(true);
    setQuickEditError(null);
    try {
      const updated = await updateItem(editingId, quickEditValues);
      setItems((prev) => (prev ? prev.map((i) => (i.id === updated.id ? updated : i)) : prev));
      toast.success(`${nounSingular} güncellendi.`);
      setEditingId(null);
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setQuickEditError(message);
      toast.error(message);
    } finally {
      setQuickEditSaving(false);
    }
  }

  async function handleTrash(item: T) {
    setBusyId(item.id);
    try {
      await trashItem(item.id);
      toast.success(`${nounSingular} çöpe taşındı.`);
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(item: T) {
    setBusyId(item.id);
    try {
      const updated = await restoreItem(item.id);
      setItems((prev) => (prev ? prev.map((i) => (i.id === updated.id ? updated : i)) : prev));
      toast.success(`${nounSingular} geri yüklendi.`);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  function requestPermanentDelete(item: T) {
    setPendingPermanentDelete(item);
  }

  function cancelPermanentDelete() {
    setPendingPermanentDelete(null);
  }

  async function confirmPermanentDelete() {
    if (!pendingPermanentDelete) return;
    setPermanentDeleting(true);
    try {
      await permanentDeleteItem(pendingPermanentDelete.id);
      toast.success(`${nounSingular} kalıcı olarak silindi.`);
      setPendingPermanentDelete(null);
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setPermanentDeleting(false);
    }
  }

  async function runBulkAction(action: BulkContentAction) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkApplying(true);
    try {
      const result = await bulkAction(ids, action);
      setSelectedIds(new Set());
      await load();
      const label = BULK_ACTION_LABELS[action];
      const noun = nounSingular.toLowerCase();
      if (result.skippedIds.length === 0) {
        toast.success(`${result.affectedCount} ${noun} ${label}.`);
      } else if (result.affectedCount > 0) {
        toast.success(`${result.affectedCount} ${noun} ${label}, ${result.skippedIds.length} atlandı.`);
      } else {
        toast.error(`İşlem uygulanamadı (${result.skippedIds.length} ${noun} atlandı).`);
      }
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBulkApplying(false);
    }
  }

  function requestBulkPermanentDelete() {
    setPendingBulkPermanentDelete(true);
  }

  function cancelBulkPermanentDelete() {
    setPendingBulkPermanentDelete(false);
  }

  async function confirmBulkPermanentDelete() {
    setPendingBulkPermanentDelete(false);
    await runBulkAction("permanent-delete");
  }

  /** Toplu işlem barındaki "Uygula" butonu — kalıcı sil onay ister, diğerleri direkt uygulanır. */
  function applyBulkSelectAction() {
    if (bulkSelectAction === "delete") {
      requestBulkPermanentDelete();
    } else {
      void runBulkAction(bulkSelectAction);
    }
  }

  return {
    error,
    counts,
    loading: items === null,
    totalItemCount: items?.length ?? 0,
    activeFilter,
    setActiveFilter,
    search,
    setSearch,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    filteredCount,
    visibleItems,
    /** Aktif sekmenin TAM listesi (arama/sayfalama uygulanmadan) — çoklu sayfaya yayılan seçimler için (ör. CSV dışa aktarma). */
    tabItems,
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    allSelected,
    clearSelection,
    editingId,
    quickEditValues,
    quickEditSaving,
    quickEditError,
    startQuickEdit,
    cancelQuickEdit,
    updateQuickEditValues,
    saveQuickEdit,
    busyId,
    handleTrash,
    handleRestore,
    pendingPermanentDelete,
    requestPermanentDelete,
    cancelPermanentDelete,
    confirmPermanentDelete,
    permanentDeleting,
    bulkApplying,
    runBulkAction,
    bulkSelectAction,
    setBulkSelectAction,
    applyBulkSelectAction,
    pendingBulkPermanentDelete,
    requestBulkPermanentDelete,
    cancelBulkPermanentDelete,
    confirmBulkPermanentDelete,
    reload: load,
  };
}
