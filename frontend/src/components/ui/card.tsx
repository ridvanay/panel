"use client";

import type { HTMLAttributes, MouseEvent as ReactMouseEvent } from "react";
import { cn } from "@/lib/cn";
import { useMouseGlow } from "@/hooks/use-mouse-glow";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * true ise, imleci takip eden yumuşak bir radial glow efekti eklenir.
   * Opt-in — her Card'da varsayılan AÇIK DEĞİL (performans/görsel gürültü riski).
   */
  interactive?: boolean;
}

export function Card({ className, interactive = false, onMouseMove, children, ...props }: CardProps) {
  const glow = useMouseGlow<HTMLDivElement>();

  function handleMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    glow.onMouseMove(event);
    onMouseMove?.(event);
  }

  return (
    <div
      ref={interactive ? glow.ref : undefined}
      onMouseMove={interactive ? handleMouseMove : onMouseMove}
      className={cn(
        "rounded-xl border border-border/60 bg-surface/70 p-6 shadow-sm backdrop-blur-xl transition-all duration-300 hover:border-border hover:shadow-md",
        interactive && "group/card relative overflow-hidden",
        className
      )}
      {...props}
    >
      {interactive ? (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-300 [@media(hover:hover)_and_(pointer:fine)]:group-hover/card:opacity-100"
            style={{
              background:
                "radial-gradient(circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(var(--accent-rgb-500), 0.15), transparent 40%)",
            }}
          />
          <div className="relative z-10">{children}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
}
