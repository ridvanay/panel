"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import type { BeforeAfterSliderBlock, BlockChrome } from "@/lib/page-builder/types";

/** Sürükleme adımı — klavye ile (ok tuşları) erişilebilirlik. */
const KEYBOARD_STEP = 5;

export function BeforeAfterSliderBlockView({ block, chrome }: { block: BeforeAfterSliderBlock; chrome: BlockChrome }) {
  const { beforeUrl, afterUrl, beforeLabel, afterLabel, orientation } = block.data;
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [percent, setPercent] = useState(50);

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const raw =
        orientation === "horizontal" ? ((clientX - rect.left) / rect.width) * 100 : ((clientY - rect.top) / rect.height) * 100;
      setPercent(Math.min(100, Math.max(0, raw)));
    },
    [orientation]
  );

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    updateFromPointer(e.clientX, e.clientY);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    updateFromPointer(e.clientX, e.clientY);
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    (e.target as Element).releasePointerCapture(e.pointerId);
  }

  // Her ikisi de doldurulmadan (backend `.min(1)` ile ZORUNLU, `ImageBlock.url` ile AYNI
  // desen) kaydedilemez — bu yalnızca eski/bozuk bir kayda karşı savunmacı bir düşüş.
  if (!beforeUrl || !afterUrl) return null;

  const clipPath = orientation === "horizontal" ? `inset(0 ${100 - percent}% 0 0)` : `inset(0 0 ${100 - percent}% 0)`;
  const handleStyle = orientation === "horizontal" ? { left: `${percent}%`, top: "50%" } : { top: `${percent}%`, left: "50%" };

  return (
    <section className={cn(chrome === "page" && "px-4 py-8 sm:px-6")}>
      <div
        ref={containerRef}
        className="relative mx-auto aspect-video max-w-3xl touch-none overflow-hidden rounded-lg select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* "Sonra" — taban katman, tam görünür. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- image-block.tsx ile AYNI gerekçe (remotePatterns tanımlı değil) */}
        <img src={afterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        {/* "Önce" — üst katman, tutamaç konumuna göre `clip-path` ile kırpılır. */}
        <div className="absolute inset-0" style={{ clipPath }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- AYNI gerekçe */}
          <img src={beforeUrl} alt="" className="h-full w-full object-cover" draggable={false} />
        </div>

        <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
          {beforeLabel}
        </span>
        <span className="pointer-events-none absolute top-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
          {afterLabel}
        </span>

        {orientation === "horizontal" ? (
          <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${percent}%` }} />
        ) : (
          <div className="pointer-events-none absolute inset-x-0 h-0.5 bg-white shadow" style={{ top: `${percent}%` }} />
        )}

        <div
          className="absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full bg-white text-foreground shadow-lg active:cursor-grabbing"
          style={handleStyle}
          role="slider"
          aria-label="Karşılaştırma tutamacı"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-orientation={orientation}
          tabIndex={0}
          onKeyDown={(e) => {
            const decreaseKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
            const increaseKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
            if (e.key === decreaseKey) setPercent((p) => Math.max(0, p - KEYBOARD_STEP));
            if (e.key === increaseKey) setPercent((p) => Math.min(100, p + KEYBOARD_STEP));
          }}
        >
          <svg viewBox="0 0 24 24" className={cn("h-4 w-4", orientation === "vertical" && "rotate-90")} fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </section>
  );
}
