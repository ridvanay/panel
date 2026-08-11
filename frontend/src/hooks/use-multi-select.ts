"use client";

import { useCallback, useRef, useState, type KeyboardEvent } from "react";

interface SelectClickModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * §10.11.5 Gelişmiş çoklu seçim — Grid ve Liste görünümleri arasında PAYLAŞILAN mantık (frontend-only,
 * backend kontratını etkilemez, bkz. ARCHITECTURE.md §10.11.5): shift+tık aralık seçimi, ctrl/cmd+tık
 * tekil toggle, Ctrl+A "o an görünen tümü". `visibleIds` çağıran tarafın GÜNCEL görünen sırasını
 * (aktif klasör + tür/tarih/arama filtreleri sonrası) yansıtmalı — aralık hesaplaması bu diziye göre yapılır.
 */
export function useMultiSelect(visibleIds: string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // "son tıklanan öğe" (anchor) — shift+tık aralığının başlangıç noktası.
  const anchorRef = useRef<string | null>(null);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    anchorRef.current = null;
  }, []);

  /** Checkbox/tekil tıklama — toggle eder VE anchor'ı günceller (bir sonraki shift+tık buradan başlar). */
  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = id;
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (visibleIds.length === 0) return prev;
      const allSelected = visibleIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }, [visibleIds]);

  /** Ctrl+A — o an görünen (aktif klasör + filtreler sonrası) TÜM öğeleri seçer. */
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(visibleIds));
  }, [visibleIds]);

  /**
   * Kart/satırın kendisine tıklama — shift (aralık) / ctrl-cmd (tekil toggle) davranışını uygular.
   * `true` dönerse çağıran taraf normal tıklama davranışını (örn. önizleme açma) TETİKLEMEMELİDİR.
   */
  const handleItemClick = useCallback(
    (id: string, modifiers: SelectClickModifiers): boolean => {
      if (modifiers.shiftKey && anchorRef.current) {
        const anchorIndex = visibleIds.indexOf(anchorRef.current);
        const clickedIndex = visibleIds.indexOf(id);
        if (anchorIndex !== -1 && clickedIndex !== -1) {
          const [start, end] = anchorIndex < clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex];
          setSelectedIds(new Set(visibleIds.slice(start, end + 1)));
          return true;
        }
      }
      if (modifiers.ctrlKey || modifiers.metaKey) {
        toggle(id);
        return true;
      }
      return false;
    },
    [visibleIds, toggle]
  );

  /**
   * Medya ızgarası/tablosu odaktayken Ctrl+A'yı yakalar — bir input/textarea/contentEditable
   * odaktaysa (örn. arama kutusu) ASLA tetiklenmez, tarayıcının kendi "tümünü seç"i çalışır.
   */
  const handleGridKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAll();
      }
    },
    [selectAll]
  );

  return { selectedIds, setSelectedIds, toggle, toggleSelectAll, selectAll, clear, handleItemClick, handleGridKeyDown };
}
