"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Compass, Search } from "lucide-react";
import { resolveIcon } from "@/lib/page-builder/icon-options";
import { resolveServiceGroup, SERVICE_GROUP_ORDER, type ServiceGroupId } from "@/lib/service-groups";
import type { RequestStrings } from "@/lib/i18n/site-dictionaries/en/request";
import { cn } from "@/lib/utils";

export interface RequestServiceGroup {
  slug: string;
  name: string;
  /** lucide ikon anahtarı (uzmanlık `icon` alanı); yoksa varsayılan ikon. */
  icon?: string;
  /** Paket AI hizmet grubu anahtarı; yoksa "other". */
  serviceGroup?: string | null;
  children: { slug: string; name: string }[];
}

/** `react-hooks/static-components` yanlış-pozitifinden kaçınma deseni. */
function iconGlyph(name: string | undefined, className: string) {
  const Icon = resolveIcon(name);
  return <Icon className={className} aria-hidden="true" />;
}

const cardBase =
  "flex min-h-14 cursor-pointer items-center gap-3 rounded-[var(--site-radius)] border border-border bg-background px-4 py-3 text-start text-sm font-medium text-foreground transition-all duration-300 motion-reduce:transition-none hover:border-[var(--site-primary)]/50 peer-checked:border-[var(--site-primary)] peer-checked:bg-[var(--site-primary)]/5 peer-checked:ring-1 peer-checked:ring-[var(--site-primary)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--site-primary)] peer-focus-visible:ring-offset-2";

/**
 * Paket AJ — hizmet adımı: gruplu, ikonlu seçilebilir kartlar (açılır liste değil), arama kutusu ve
 * "Find your treatment" bağlantısı. Kartlar yerel radyo girdileridir (klavye: ok tuşları, boşluk).
 */
export function RequestServicePicker({
  strings: t,
  groups,
  groupTitles,
  value,
  onChange,
  error,
  findTreatmentHref,
}: {
  strings: RequestStrings;
  groups: RequestServiceGroup[];
  groupTitles: Record<ServiceGroupId, string>;
  value: string;
  onChange: (slug: string) => void;
  error?: string;
  findTreatmentHref: string;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();

  const visible = useMemo(() => {
    if (!needle) return groups;
    return groups.flatMap((g) => {
      const parentHit = g.name.toLocaleLowerCase().includes(needle);
      const children = parentHit ? g.children : g.children.filter((c) => c.name.toLocaleLowerCase().includes(needle));
      return parentHit || children.length > 0 ? [{ ...g, children }] : [];
    });
  }, [groups, needle]);

  const sections = useMemo(() => {
    const buckets = new Map<ServiceGroupId, (RequestServiceGroup)[]>();
    for (const item of visible) {
      const id = resolveServiceGroup(item.serviceGroup);
      buckets.set(id, [...(buckets.get(id) ?? []), item]);
    }
    return SERVICE_GROUP_ORDER.flatMap((id) => {
      const items = buckets.get(id);
      return items && items.length > 0 ? [{ id, items }] : [];
    });
  }, [visible]);
  const showHeadings = sections.length > 1 || (sections.length === 1 && sections[0]!.id !== "other");

  return (
    <fieldset className="min-w-0 space-y-5" aria-describedby={error ? "request-service-error" : "request-service-hint"}>
      <legend className="sr-only">{t.serviceLabel}</legend>
      <p id="request-service-hint" className="text-sm text-foreground/70">
        {t.serviceHint}
      </p>

      <div className="relative">
        <label htmlFor="request-service-search" className="sr-only">
          {t.serviceSearchLabel}
        </label>
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-foreground/50" aria-hidden="true" />
        <input
          id="request-service-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.serviceSearchPlaceholder}
          autoComplete="off"
          className="h-11 w-full rounded-[var(--site-radius)] border border-border bg-background ps-10 pe-3 text-base outline-none transition-all duration-300 focus-visible:ring-2 focus-visible:ring-[var(--site-primary)] md:text-sm"
          data-testid="request-service-search"
        />
      </div>

      <div aria-live="polite" className="space-y-6">
        {sections.length === 0 ? (
          <p className="rounded-[var(--site-radius)] border border-dashed border-border p-4 text-sm text-foreground/70" data-testid="request-service-empty">
            {t.serviceNoResults}
          </p>
        ) : (
          sections.map((section) =>
            (
              <div key={section.id} role="group" aria-label={showHeadings ? groupTitles[section.id] : t.serviceLabel} className="space-y-3">
                {showHeadings && <h3 className="text-sm font-semibold text-foreground/70">{groupTitles[section.id]}</h3>}
                <div className="grid gap-3 sm:grid-cols-2">
                  {section.items.map((item) => (
                    <div key={item.slug} className={cn("space-y-2", item.children.length > 0 && "sm:col-span-2")}>
                      <label className="block">
                        <input
                          type="radio"
                          name="request-service"
                          value={item.slug}
                          checked={value === item.slug}
                          onChange={() => onChange(item.slug)}
                          className="peer sr-only"
                          data-testid={`request-service-${item.slug}`}
                        />
                        <span className={cardBase}>
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--site-primary)]/10 text-[var(--site-primary)]">
                            {iconGlyph(item.icon, "size-5")}
                          </span>
                          <span className="min-w-0">{item.name}</span>
                        </span>
                      </label>
                      {item.children.length > 0 && (
                        <div className="flex flex-wrap gap-2 ps-2">
                          {item.children.map((child) => (
                            <label key={child.slug} className="block">
                              <input
                                type="radio"
                                name="request-service"
                                value={child.slug}
                                checked={value === child.slug}
                                onChange={() => onChange(child.slug)}
                                className="peer sr-only"
                                data-testid={`request-service-${child.slug}`}
                              />
                              <span className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-border bg-background px-3.5 text-sm text-foreground transition-all duration-300 motion-reduce:transition-none hover:border-[var(--site-primary)]/50 peer-checked:border-[var(--site-primary)] peer-checked:bg-[var(--site-primary)] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--site-primary)] peer-focus-visible:ring-offset-2">
                                {child.name}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          )
        )}
      </div>

      {error && (
        <span id="request-service-error" role="alert" className="block text-xs text-danger">
          {error}
        </span>
      )}

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--site-radius)] bg-[var(--site-primary)]/5 px-4 py-3 text-sm text-foreground/80">
        <Compass className="size-4 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
        <span>{t.notSure}</span>
        <Link href={findTreatmentHref} className="font-semibold text-[var(--site-primary)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--site-primary)]" data-testid="request-find-treatment">
          {t.findTreatmentLink}
        </Link>
      </p>
    </fieldset>
  );
}
