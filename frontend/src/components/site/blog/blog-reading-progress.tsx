"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Paket Z1-ek - yazi sayfasinin ustunde ince okuma ilerleme cubugu. `targetId` makalenin kimligidir; ilerleme o
 * elemanin gorunur kismina gore hesaplanir. Ilk render 0'dir (SSR ile ayni; hidrasyon guvenli). `prefers-reduced-motion`
 * acikken gecis animasyonu yoktur (deger yine guncellenir, yalnizca yumusatma kapanir).
 */
export function BlogReadingProgress({ label, targetId }: { label: string; targetId: string }) {
  const [value, setValue] = useState(0);
  const frame = useRef(0);

  useEffect(() => {
    const compute = () => {
      frame.current = 0;
      const el = document.getElementById(targetId);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      const next = scrollable <= 0 ? (rect.top < 0 ? 100 : 0) : Math.min(100, Math.max(0, Math.round((-rect.top / scrollable) * 100)));
      setValue((prev) => (prev === next ? prev : next));
    };
    const schedule = () => {
      if (!frame.current) frame.current = window.requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame.current) window.cancelAnimationFrame(frame.current);
    };
  }, [targetId]);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-1 bg-transparent"
      data-testid="blog-reading-progress"
    >
      <div
        className="h-full origin-left bg-[var(--site-primary)] transition-transform duration-150 ease-out motion-reduce:transition-none rtl:origin-right"
        style={{ transform: `scaleX(${value / 100})` }}
      />
    </div>
  );
}
