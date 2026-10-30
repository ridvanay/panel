"use client";

import { useEffect, useState } from "react";

/**
 * Paket AB — sayfa `threshold` pikselden fazla kaydırıldı mı (pasif dinleyici). Masaüstünde üst şeridin
 * gizlenmesi ve ana barın 80 → 64 px küçülmesi için. Küçülme sticky `top` ve transform ile yapılır;
 * belge akışındaki yükseklik değişmez (CLS üretmez).
 */
export function useScrolledPast(threshold: number): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}
