"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import type { Media } from "@/lib/api/types";

const KEY_STEP = 5;

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Odak noktası seçici — görselin küçük önizlemesine tıklanan nokta `object-position` yüzdesi olur
 * ("Kırp" modunda görselin hangi bölümünün görünür kalacağını belirler). Klavye: ok tuşları %5 adımla
 * taşır. Sayısal alanlar ayrıca yanında durur (erişilebilirlik ve hassas giriş).
 */
export function FocalPointPicker({
  media,
  x,
  y,
  onChange,
  label,
}: {
  media: Media;
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
  label: string;
}) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    onChange(clampPercent(((event.clientX - rect.left) / rect.width) * 100), clampPercent(((event.clientY - rect.top) / rect.height) * 100));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    };
    const step = delta[event.key];
    if (!step) return;
    event.preventDefault();
    onChange(clampPercent(x + step[0]), clampPercent(y + step[1]));
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={`${label}: yatay %${x}, dikey %${y}. Değiştirmek için tıklayın veya ok tuşlarını kullanın.`}
      className="relative block w-full overflow-hidden rounded-md border border-border bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ aspectRatio: media.width && media.height ? `${media.width} / ${media.height}` : "16 / 9" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- admin önizlemesi, medya kütüphanesi URL'si */}
      <img src={media.url} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
      <span
        aria-hidden
        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--primary,#2563eb)] shadow"
        style={{ left: `${x}%`, top: `${y}%` }}
      />
    </button>
  );
}
