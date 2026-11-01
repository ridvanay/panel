"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { BlogFaqItem } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Paket Z1 — SSS akordeonu (erişilebilir): her soru bir `button` (`aria-expanded`/`aria-controls`), cevap `region`.
 * Metinler DÜZ METİN olarak render edilir (HTML değil). Birden fazla madde aynı anda açık olabilir.
 */
export function BlogFaq({ items, title }: { items: BlogFaqItem[]; title: string }) {
  const baseId = useId();
  const [open, setOpen] = useState<Set<number>>(new Set());
  if (items.length === 0) return null;
  const toggle = (index: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  return (
    <section aria-labelledby={`${baseId}-faq`} className="mt-12" data-testid="blog-faq">
      <h2 id={`${baseId}-faq`} className="font-heading text-2xl font-semibold text-foreground">
        {title}
      </h2>
      <div className="mt-4 divide-y divide-border rounded-[var(--site-radius)] border border-border">
        {items.map((item, index) => {
          const isOpen = open.has(index);
          const buttonId = `${baseId}-q-${index}`;
          const panelId = `${baseId}-a-${index}`;
          return (
            <div key={buttonId}>
              <h3>
                <button
                  type="button"
                  id={buttonId}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(index)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-start text-base font-medium text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--site-primary)]"
                >
                  <span>{item.question}</span>
                  <ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform duration-300", isOpen && "rotate-180")} aria-hidden="true" />
                </button>
              </h3>
              <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!isOpen} className="px-4 pb-4 text-base leading-relaxed text-foreground/80">
                <p className="whitespace-pre-line">{item.answer}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
