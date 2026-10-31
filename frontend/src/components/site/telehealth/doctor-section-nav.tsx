"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface DoctorSectionNavItem {
  id: string;
  label: string;
}

/**
 * Paket Y — profil bölüm çubuğu. Masaüstünde yapışkan sekme çubuğu, mobilde yatay kaydırılabilir çipler.
 * Gerçek `<a href="#id">` bağlantılarıdır (JS'siz de çalışır); etkin bölüm IntersectionObserver ile izlenir.
 * Yalnızca dolu bölümler `items` olarak gelir (boş bölümler çubukta da yoktur).
 */
export function DoctorSectionNav({ items, ariaLabel }: { items: DoctorSectionNavItem[]; ariaLabel: string }) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const elements = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  if (items.length < 2) return null;

  return (
    <nav aria-label={ariaLabel} className="-mx-4 border-b border-border bg-background/95 backdrop-blur-sm sm:mx-0 lg:sticky lg:top-[88px] lg:z-20">
      <ul className="flex gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] sm:px-0 lg:gap-1 lg:py-0 [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const isActive = item.id === active;
          return (
            <li key={item.id} className="shrink-0">
              <a
                href={`#${item.id}`}
                aria-current={isActive ? "true" : undefined}
                onClick={() => setActive(item.id)}
                className={cn(
                  "inline-flex items-center whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-semibold outline-none transition-all duration-300 focus-visible:ring-2 focus-visible:ring-ring",
                  "lg:rounded-none lg:border-0 lg:border-b-4 lg:px-4 lg:py-3",
                  isActive
                    ? "border-[var(--site-secondary)] bg-[var(--site-secondary)] text-white lg:bg-transparent lg:text-[var(--site-secondary)]"
                    : "border-border bg-surface text-foreground/70 hover:text-foreground lg:border-b-transparent lg:bg-transparent",
                )}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
