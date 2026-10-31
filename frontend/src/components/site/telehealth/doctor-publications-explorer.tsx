"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import type { DoctorPublication, DoctorPublicationKind } from "@/lib/api/types";
import type { TelehealthStrings } from "@/lib/i18n/site-dictionaries";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/** Her grupta başlangıçta görünen yayın sayısı. */
export const PUBLICATIONS_PER_GROUP = 5;

/** Sabit grup sırası (akademik gelenekteki önem sırası; veri sırasından bağımsız). */
export const PUBLICATION_GROUP_ORDER: DoctorPublicationKind[] = ["INTERNATIONAL_ARTICLE", "NATIONAL_ARTICLE", "BOOK_CHAPTER", "PROCEEDING", "OTHER"];

function groupLabel(dict: TelehealthStrings, kind: DoctorPublicationKind): string {
  const map: Record<DoctorPublicationKind, string> = {
    INTERNATIONAL_ARTICLE: dict.publicationInternational,
    NATIONAL_ARTICLE: dict.publicationNational,
    PROCEEDING: dict.publicationProceeding,
    BOOK_CHAPTER: dict.publicationBookChapter,
    OTHER: dict.publicationOther,
  };
  return map[kind];
}

function matchesQuery(pub: DoctorPublication, query: string): boolean {
  if (!query) return true;
  return [pub.title, pub.authors, pub.venue].some((field) => field?.toLowerCase().includes(query));
}

/**
 * Paket AE — yayınlar türe göre gruplu; her grupta ilk 5 + "Tümünü göster (N)"; yıl filtresi ve arama.
 * SEO: gizlenen yayınlar DOM'dan KALDIRILMAZ, yalnızca `hidden` ile görsel olarak gizlenir.
 */
export function DoctorPublicationsExplorer({ publications, dict }: { publications: DoctorPublication[]; dict: TelehealthStrings }) {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [expanded, setExpanded] = useState<Partial<Record<DoctorPublicationKind, boolean>>>({});

  const years = useMemo(() => Array.from(new Set(publications.map((p) => p.year))).sort((a, b) => b - a), [publications]);
  const normalizedQuery = query.trim().toLowerCase();

  const groups = PUBLICATION_GROUP_ORDER.map((kind) => {
    const items = publications.map((pub, index) => ({ pub, index })).filter(({ pub }) => pub.kind === kind);
    const matching = items.filter(({ pub }) => (!year || String(pub.year) === year) && matchesQuery(pub, normalizedQuery));
    return { kind, items, matching, matchingKeys: new Set(matching.map((m) => m.index)) };
  }).filter((g) => g.items.length > 0);

  const totalMatching = groups.reduce((sum, g) => sum + g.matching.length, 0);
  const showFilters = publications.length > PUBLICATIONS_PER_GROUP;

  return (
    <div className="space-y-6">
      {showFilters && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" aria-hidden="true" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={dict.pubSearchLabel}
              placeholder={dict.pubSearchPlaceholder}
              className="ps-9"
            />
          </div>
          <Select aria-label={dict.pubYearLabel} value={year} onChange={(e) => setYear(e.target.value)} className="sm:w-40">
            <option value="">{dict.pubAllYears}</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </Select>
        </div>
      )}

      {totalMatching === 0 && (
        <p role="status" className="rounded-[var(--site-radius)] border border-border bg-muted/30 p-4 text-sm text-foreground/60">
          {dict.pubNoResults}
        </p>
      )}

      {groups.map((group) => {
        const isExpanded = Boolean(expanded[group.kind]);
        let shown = 0;
        return (
          <div key={group.kind} data-testid={`publications-group-${group.kind}`} hidden={group.matching.length === 0}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground/50">
              {groupLabel(dict, group.kind)} <span className="font-normal normal-case text-foreground/40">({group.matching.length})</span>
            </h3>
            <ul>
              {group.items.map(({ pub, index }) => {
                const matches = group.matchingKeys.has(index);
                let hidden = !matches;
                if (matches) {
                  shown += 1;
                  if (!isExpanded && shown > PUBLICATIONS_PER_GROUP) hidden = true;
                }
                const href = pub.doi ? `https://doi.org/${pub.doi}` : pub.url;
                return (
                  <li key={index} hidden={hidden} className="border-b border-border/60 py-3 last:border-0">
                    <p className="text-sm font-medium text-foreground">{pub.title}</p>
                    <p className="mt-1 text-xs text-foreground/60">
                      {pub.authors ? `${pub.authors} · ` : ""}
                      {pub.venue} · {pub.year}
                    </p>
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        {dict.viewSource}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
            {group.matching.length > PUBLICATIONS_PER_GROUP && (
              <button
                type="button"
                aria-expanded={isExpanded}
                onClick={() => setExpanded((prev) => ({ ...prev, [group.kind]: !isExpanded }))}
                className="mt-2 text-sm font-semibold text-[var(--site-primary)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {isExpanded ? dict.pubShowLess : formatSiteString(dict.pubShowAll, { count: group.matching.length })}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
