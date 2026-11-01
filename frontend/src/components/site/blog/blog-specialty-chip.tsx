import { createElement } from "react";
import { specialtyIconFor, specialtyToneFor } from "@/lib/blog/specialty-icon";
import { cn } from "@/lib/utils";

/** Paket Z1-ek - uzmanliga gore tutarli ikon + ton (tema paletinden) tasiyan kucuk cip. */
export function BlogSpecialtyChip({ slug, label, className }: { slug: string | null | undefined; label: string; className?: string }) {
  const tone = specialtyToneFor(slug);
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", tone.soft, className)} data-testid="blog-specialty-chip">
      {createElement(specialtyIconFor(slug), { className: "h-3.5 w-3.5 shrink-0", "aria-hidden": true })}
      <span className="truncate">{label}</span>
    </span>
  );
}
