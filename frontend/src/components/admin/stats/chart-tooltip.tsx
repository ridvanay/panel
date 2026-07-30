"use client";

import type { TooltipContentProps } from "recharts";

/**
 * Cam efektli (glassmorphism) özel Recharts tooltip içeriği.
 * Not: Bilinçli olarak `Card` bileşenini import etmiyoruz — bu dosya
 * tamamen bağımsız kalsın diye aynı görsel dili kendi class string'i
 * içinde tekrarlıyor.
 */
export function ChartTooltipContent({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-surface/90 px-3 py-2 text-xs shadow-md backdrop-blur-xl">
      {label ? <p className="mb-1 font-medium text-foreground">{label}</p> : null}
      <div className="flex flex-col gap-1">
        {payload.map((entry, index) => (
          <div
            key={`${entry.dataKey ?? entry.name ?? index}`}
            className="flex items-center gap-1.5 text-foreground/70"
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: entry.color }} />
            <span>{entry.name}:</span>
            <span className="font-medium text-foreground">
              {typeof entry.value === "number" ? entry.value.toLocaleString("tr-TR") : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
