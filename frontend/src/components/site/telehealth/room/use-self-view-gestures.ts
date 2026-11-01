"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { PipCorner } from "./device-prefs";
import { directionOf, distance, nearestCorner, pinchStep } from "./pip-geometry";

const DRAG_THRESHOLD_PX = 6;
export const DOUBLE_TAP_MS = 300;

interface Options {
  /** Kutunun içinde sürüklendiği sahne (köşe hesabı bu dikdörtgene göre). */
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onCorner: (corner: PipCorner) => void;
  /** İki parmakla büyütme/küçültme: +1 / -1 basamak. */
  onSizeStep: (delta: number) => void;
  onTap: () => void;
  onDoubleTap: () => void;
}

/**
 * Kendi görüntü kutusu jestleri — YALNIZCA POINTER EVENTS, kütüphanesiz:
 *  - tek işaretçi sürükleme (6 px eşiği) → bırakınca en yakın köşeye yapışma (mantıksal start/end),
 *  - iki işaretçi (iki parmak) mesafe oranıyla büyüt/küçült (basamaklı),
 *  - hareketsiz kısa dokunuşlar: tek → `onTap`, 300 ms içinde ikinci → `onDoubleTap` (fare çift tıklaması dahil;
 *    `dblclick` olayı ayrıca KULLANILMAZ ki çift tetikleme olmasın).
 * Hiçbiri Room'a/yayına/aboneliğe dokunmaz; yalnızca görsel konum/boyut durumunu değiştirir.
 */
export function useSelfViewGestures({ containerRef, enabled, onCorner, onSizeStep, onTap, onDoubleTap }: Options) {
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const pinchedRef = useRef(false);
  const pinchStartRef = useRef(0);
  const lastTapRef = useRef(0);
  const cbRef = useRef({ onCorner, onSizeStep, onTap, onDoubleTap });
  useEffect(() => {
    cbRef.current = { onCorner, onSizeStep, onTap, onDoubleTap };
  });

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      // Kutunun kendi düğmeleri (boyut/gizle/yer değiştir) jest başlatmaz.
      if ((e.target as HTMLElement).closest("button")) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Yakalama desteklenmiyor/başarısız — sürükleme yine pencere içinde çalışır.
      }
      if (pointers.current.size === 1) {
        startRef.current = { x: e.clientX, y: e.clientY };
        draggingRef.current = false;
        pinchedRef.current = false;
      } else if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        pinchStartRef.current = distance(a!, b!);
        pinchedRef.current = true;
        draggingRef.current = false;
        setOffset(null);
      }
    },
    [enabled]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || !pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        const current = distance(a!, b!);
        const step = pinchStep(pinchStartRef.current, current);
        if (step !== 0) {
          cbRef.current.onSizeStep(step);
          pinchStartRef.current = current;
        }
        return;
      }

      const start = startRef.current;
      if (!start || pinchedRef.current) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!draggingRef.current && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      draggingRef.current = true;
      setOffset({ x: dx, y: dy });
    },
    [enabled]
  );

  const finish = useCallback(
    (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.delete(e.pointerId);
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      } catch {
        // Yakalama zaten bırakılmış.
      }
      if (pointers.current.size > 0) return; // Pinch'in ilk parmağı kalktı — ikincisi kalkana dek bekle.

      const wasDragging = draggingRef.current;
      const wasPinch = pinchedRef.current;
      draggingRef.current = false;
      pinchedRef.current = false;
      startRef.current = null;
      setOffset(null);
      if (cancelled || wasPinch) return;

      if (wasDragging) {
        const rect = e.currentTarget.getBoundingClientRect();
        const stage = containerRef.current?.getBoundingClientRect();
        if (stage) {
          const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          cbRef.current.onCorner(nearestCorner(center, stage, directionOf(containerRef.current)));
        }
        lastTapRef.current = 0;
        return;
      }

      const now = Date.now();
      if (lastTapRef.current && now - lastTapRef.current <= DOUBLE_TAP_MS) {
        lastTapRef.current = 0;
        cbRef.current.onDoubleTap();
      } else {
        lastTapRef.current = now;
        cbRef.current.onTap();
      }
    },
    [containerRef]
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => finish(e, false), [finish]);
  const onPointerCancel = useCallback((e: ReactPointerEvent<HTMLElement>) => finish(e, true), [finish]);

  return { offset, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } };
}
