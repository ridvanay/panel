"use client";

import { useEffect, useState } from "react";
import { ChevronDown, List } from "lucide-react";
import type { TocItem } from "@/lib/blog/toc";
import { cn } from "@/lib/utils";

/** Görünür başlıklar arasında belge sırasındaki ilk olanı seçer; hiçbiri görünmüyorsa önceki seçim korunur. */
export function pickActiveHeading(items: TocItem[], visible: ReadonlySet<string>, current: string | null): string | null {
  const first = items.find((item) => visible.has(item.id));
  return first ? first.id : current;
}

function TocList({ items, activeId, onNavigate }: { items: TocItem[]; activeId: string | null; onNavigate?: () => void }) {
  return (
    <ol className="space-y-1 text-sm">
      {items.map((item) => (
        <li key={item.id} className={cn(item.level === 3 && "ps-4")}>
          <a
            href={`#${item.id}`}
            onClick={onNavigate}
            aria-current={activeId === item.id ? "location" : undefined}
            className={cn(
              "block rounded-md border-s-2 py-1 ps-3 pe-2 transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]",
              activeId === item.id
                ? "border-[var(--site-primary)] bg-[var(--site-primary)]/10 font-medium text-foreground"
                : "border-transparent text-foreground/70 hover:text-foreground"
            )}
          >
            {item.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

/**
 * Paket Z1 — içindekiler. Masaüstünde yapışkan yan sütun (`lg+`), mobilde açılır kutu. Aktif başlık
 * IntersectionObserver ile izlenir (kaydırmada vurgulanır, `aria-current="location"`). Başlık yoksa/1 tane ise çizilmez.
 */
export function BlogToc({ items, title, ariaLabel, variant }: { items: TocItem[]; title: string; ariaLabel: string; variant: "mobile" | "sidebar" }) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    if (items.length < 2 || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    let current: string | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        current = pickActiveHeading(items, visible, current);
        if (current) setActiveId(current);
      },
      { rootMargin: "0px 0px -65% 0px", threshold: 0 }
    );
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  if (items.length < 2) return null;
  if (variant === "mobile") {
    return (
      <details className="group rounded-[var(--site-radius)] border border-border bg-surface lg:hidden" data-testid="blog-toc-mobile">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)] [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2">
            <List className="h-4 w-4" aria-hidden="true" />
            {title}
          </span>
          <ChevronDown className="h-4 w-4 transition-transform duration-300 group-open:rotate-180" aria-hidden="true" />
        </summary>
        <nav aria-label={ariaLabel} className="px-3 pb-3">
          <TocList items={items} activeId={activeId} />
        </nav>
      </details>
    );
  }
  return (
    <nav aria-label={ariaLabel} className="hidden lg:block" data-testid="blog-toc">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground/70">{title}</p>
      <TocList items={items} activeId={activeId} />
    </nav>
  );
}
