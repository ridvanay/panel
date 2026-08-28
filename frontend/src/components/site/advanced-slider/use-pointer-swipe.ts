"use client";

import { useRef, type PointerEvent } from "react";

interface PointerSwipeOptions {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  /** `false` iken hook devre dışıdır (`transitionEffect: "slide"` iken bunun yerine framer-motion
   *  `drag="x"` kullanılır — bkz. architect §5.1). */
  enabled?: boolean;
  thresholdPx?: number;
  /** px/ms */
  thresholdVelocity?: number;
}

interface PointerStart {
  x: number;
  y: number;
  t: number;
}

/**
 * Pointer Events tabanlı swipe algılama (`fade`/`cube`/`zoom` geçiş efektleri için) — eşik 50px
 * VEYA hız > 0.4px/ms (architect §5.1 BAĞLAYICI). Dikey kaydırma engellenmez: yatay hareket dikey
 * hareketten büyük değilse swipe sayılmaz, ayrıca `touch-action: pan-y` döndürülür.
 */
export function usePointerSwipe({
  onSwipeLeft,
  onSwipeRight,
  enabled = true,
  thresholdPx = 50,
  thresholdVelocity = 0.4,
}: PointerSwipeOptions) {
  const startRef = useRef<PointerStart | null>(null);

  function onPointerDown(e: PointerEvent) {
    if (!enabled) return;
    startRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  }

  function onPointerUp(e: PointerEvent) {
    if (!enabled || !startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    const dt = Math.max(1, performance.now() - startRef.current.t);
    startRef.current = null;

    if (Math.abs(dx) < Math.abs(dy)) return; // dikey hareket — swipe sayılmaz, scroll serbest bırakılır
    const velocity = Math.abs(dx) / dt;
    if (Math.abs(dx) < thresholdPx && velocity < thresholdVelocity) return;
    if (dx < 0) onSwipeLeft();
    else onSwipeRight();
  }

  function onPointerCancel() {
    startRef.current = null;
  }

  if (!enabled) return {};

  return {
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    style: { touchAction: "pan-y" as const },
  };
}
