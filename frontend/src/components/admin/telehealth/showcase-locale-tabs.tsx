"use client";

import { SHOWCASE_LOCALES } from "@/lib/api/doctor-showcase";
import { cn } from "@/lib/utils";

/** Paket Y — 9 site dili için sade sekme şeridi; dolu dillerin yanında nokta gösterilir. */
export function ShowcaseLocaleTabs({
  value,
  onChange,
  filled,
  label,
}: {
  value: string;
  onChange: (code: string) => void;
  filled: (code: string) => boolean;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1">
      {SHOWCASE_LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          role="tab"
          aria-selected={value === code}
          onClick={() => onChange(code)}
          className={cn("rounded-md px-2.5 py-1 text-xs font-medium", value === code ? "bg-primary text-primary-foreground" : "bg-surface-muted text-foreground/70")}
        >
          {code.toUpperCase()}
          {filled(code) ? " •" : ""}
        </button>
      ))}
    </div>
  );
}
