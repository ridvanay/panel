"use client";

import { useLayoutEffect, useState } from "react";

/**
 * Paket AB — masaüstü ana bar (≥1024 px) yerleşimi ÖLÇEREK seçilir (sabit piksel tahmini yok):
 *   "full"    → geniş menü aralığı, "Find my physician" metinli
 *   "compact" → dar aralık, "Find my physician" yalnızca ikon (tooltip + aria-label)
 *   compact + `overflowCount > 0` → sondaki ikincil öğeler "More ▾" altına toplanır
 * 1024 px ve üstünde hamburger YOKTUR.
 *
 * Ölçüm, görünmez bir ölçüm kabındaki (`data-measure`) doğal genişliklerden yapılır; böylece gerçek
 * satırın o anki düzeninden bağımsızdır (titreme/döngü yok). `null` = henüz ölçülmedi (SSR/jsdom):
 * kırılım sınıfları geçerlidir (≥1280 tam, 1024–1279 dar) — hidrasyonda çoğu durumda düzen değişmez (CLS yok).
 */
export interface DesktopNavLayout {
  mode: "full" | "compact";
  /** Menünün sonundan "More" altına alınacak öğe sayısı. */
  overflowCount: number;
}

export const NAV_GAP_FULL = 28;
export const NAV_GAP_COMPACT = 16;
/** Logo ↔ menü ↔ düğmeler arası en az boşluk (iki tarafta). */
const SECTION_GAP = 24;
/** Düğmeler arası boşluk (`gap-2`). */
const ACTION_GAP = 8;

export function computeDesktopNavLayout(input: {
  available: number;
  itemWidths: number[];
  findFull: number;
  findIcon: number;
  cta: number;
  more: number;
}): DesktopNavLayout {
  const { available, itemWidths, findFull, findIcon, cta, more } = input;
  const actions = (find: number) => (find > 0 ? find + (cta > 0 ? ACTION_GAP : 0) : 0) + cta;
  const menu = (widths: number[], gap: number) => widths.reduce((sum, w) => sum + w, 0) + Math.max(0, widths.length - 1) * gap;
  const fits = (menuWidth: number, actionsWidth: number) => menuWidth + actionsWidth + 2 * SECTION_GAP <= available;

  if (fits(menu(itemWidths, NAV_GAP_FULL), actions(findFull))) return { mode: "full", overflowCount: 0 };
  if (fits(menu(itemWidths, NAV_GAP_COMPACT), actions(findIcon))) return { mode: "compact", overflowCount: 0 };
  // İkincil öğeler sondan "More" altına; en az bir öğe görünür kalır.
  for (let k = 1; k < itemWidths.length; k++) {
    const visible = itemWidths.slice(0, itemWidths.length - k);
    if (fits(menu(visible, NAV_GAP_COMPACT) + NAV_GAP_COMPACT + more, actions(findIcon))) return { mode: "compact", overflowCount: k };
  }
  return { mode: "compact", overflowCount: Math.max(0, itemWidths.length - 1) };
}

export function useDesktopNavLayout(
  rowRef: React.RefObject<HTMLElement | null>,
  logoRef: React.RefObject<HTMLElement | null>,
  measureRef: React.RefObject<HTMLElement | null>
): DesktopNavLayout | null {
  const [layout, setLayout] = useState<DesktopNavLayout | null>(null);

  // Boyamadan önce ölç: geniş düzen bir kare bile taşmasın.
  useLayoutEffect(() => {
    const measure = () => {
      const row = rowRef.current;
      const logo = logoRef.current;
      const box = measureRef.current;
      if (!row || !logo || !box || row.clientWidth === 0) return; // yerleşim yok (jsdom, gizli ağaç)
      if (window.innerWidth < 1024) return; // mobil düzen; masaüstü satırı gizli
      const width = (sel: string) => (box.querySelector<HTMLElement>(sel)?.offsetWidth ?? 0);
      const style = window.getComputedStyle(row);
      const padding = parseFloat(style.paddingLeft || "0") + parseFloat(style.paddingRight || "0");
      const next = computeDesktopNavLayout({
        available: row.clientWidth - padding - logo.offsetWidth,
        itemWidths: Array.from(box.querySelectorAll<HTMLElement>("[data-measure='item']")).map((el) => el.offsetWidth),
        findFull: width("[data-measure='find-full']"),
        findIcon: width("[data-measure='find-icon']"),
        cta: width("[data-measure='cta']"),
        more: width("[data-measure='more']"),
      });
      setLayout((prev) => (prev && prev.mode === next.mode && prev.overflowCount === next.overflowCount ? prev : next));
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (rowRef.current) observer?.observe(rowRef.current);
    if (measureRef.current) observer?.observe(measureRef.current);
    window.addEventListener("resize", measure);
    // Web yazı tipi yüklenince genişlikler değişir.
    void document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [rowRef, logoRef, measureRef]);

  return layout;
}
