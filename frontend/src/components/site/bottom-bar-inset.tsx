"use client";

import { useEffect } from "react";

/**
 * Alta sabitlenmiş çubuklar için ORTAK mekanizma. Ekranın altına sabitlenen her çubuk (çerez
 * bildirimi, doktor sayfasının mobil randevu çubuğu, ürün sepete ekle çubuğu…) kök elemanına
 * `data-bottom-bar` özniteliğini ekler. Bu gözlemci görünür çubukların ekranın altından ne kadar
 * yer kapladığını ölçer ve `<html>` üzerinde `--site-bottom-inset` CSS değişkenine yazar
 * (piksel). Yüzen düğmeler (canlı sohbet, yukarı çık) konumlarını bu değişkene göre hesaplar:
 *
 *   bottom: calc(1.5rem + var(--site-bottom-inset, 0px) + env(safe-area-inset-bottom, 0px))
 *
 * Yeni bir alt çubuk eklemek için yalnızca özniteliği eklemek yeterlidir — sayfaya özel kod yok.
 *
 * Ölçüm: `display:none`/`visibility:hidden`, boyutsuz veya ekranın tamamen altına kaydırılmış
 * (ör. `translate-y-full` ile gizlenmiş) çubuklar SAYILMAZ; üst üste binen çubuklarda en yüksekte
 * olanın üst kenarı esas alınır. Çubuk animasyonla girip çıkarken geçiş bitiminde tekrar ölçülür.
 */
export const BOTTOM_BAR_ATTRIBUTE = "data-bottom-bar";
export const BOTTOM_INSET_VARIABLE = "--site-bottom-inset";

export function measureBottomInset(doc: Document = document, viewportHeight: number = window.innerHeight): number {
  let inset = 0;
  doc.querySelectorAll<HTMLElement>(`[${BOTTOM_BAR_ATTRIBUTE}]`).forEach((element) => {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (rect.top >= viewportHeight) return;
    inset = Math.max(inset, viewportHeight - rect.top);
  });
  return Math.max(0, Math.round(inset));
}

export function BottomBarInsetObserver() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    let lateTimer: ReturnType<typeof setTimeout> | undefined;

    const apply = () => {
      frame = 0;
      root.style.setProperty(BOTTOM_INSET_VARIABLE, `${measureBottomInset()}px`);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(apply);
      // Çubukların giriş/çıkış animasyonu (~300 ms) bittikten sonra bir kez daha ölç.
      if (lateTimer) clearTimeout(lateTimer);
      lateTimer = setTimeout(scheduleLate, 350);
    };
    const scheduleLate = () => {
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    const observeBars = () => {
      if (!resizeObserver) return;
      resizeObserver.disconnect();
      document.querySelectorAll(`[${BOTTOM_BAR_ATTRIBUTE}]`).forEach((element) => resizeObserver.observe(element));
    };

    const mutationObserver = new MutationObserver(() => {
      observeBars();
      schedule();
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden", BOTTOM_BAR_ATTRIBUTE],
    });

    observeBars();
    apply();
    window.addEventListener("resize", schedule);
    document.addEventListener("transitionend", scheduleLate, true);

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("transitionend", scheduleLate, true);
      if (frame) window.cancelAnimationFrame(frame);
      if (lateTimer) clearTimeout(lateTimer);
      root.style.removeProperty(BOTTOM_INSET_VARIABLE);
    };
  }, []);

  return null;
}
