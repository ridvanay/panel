import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { PublicBlogTopicGroup } from "@/lib/api/types";
import type { BlogStrings } from "@/lib/i18n/site-dictionaries/en/blog";
import { cn } from "@/lib/utils";
import { findActiveGroup, splitTopicChips } from "@/lib/blog/topics";

type Chip = PublicBlogTopicGroup["topics"][number];

/** Aktif uzmanlık yokken: tüm gruplardaki konular slug'a göre toplanır (her yazı tek uzmanlıkta olduğundan sayılar kesindir). */
function aggregateTopics(groups: PublicBlogTopicGroup[]): Chip[] {
  const map = new Map<string, Chip>();
  for (const group of groups) {
    for (const topic of group.topics) {
      const existing = map.get(topic.slug);
      map.set(topic.slug, existing ? { ...existing, count: existing.count + topic.count } : { ...topic });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const pillBase =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]";
const pillIdle = "border-border bg-background text-foreground/80 hover:border-[var(--site-primary)]";
const pillActive = "border-[var(--site-primary)] bg-[var(--site-primary)] text-white";

/**
 * Paket Z1 — konu filtresi (sunucu bileşeni, JS gerekmez). Üstte uzmanlık grupları + sayıları ("All topics" dahil),
 * altında etkin gruptaki konu çipleri + sayıları; ilk 6 dışındakiler yerel `<details>` ile "More topics" altında.
 * Her seçenek düz bir bağlantıdır (`?topic=`), böylece filtreli görünüm paylaşılabilir ve taranabilir.
 */
export function BlogTopicFilter({
  groups,
  activeTopic,
  total,
  t,
  hrefFor,
}: {
  groups: PublicBlogTopicGroup[];
  activeTopic: string;
  /** "All topics" yanındaki sayı (filtresiz toplam). */
  total: number;
  t: BlogStrings;
  hrefFor: (topic: string) => string;
}) {
  if (groups.length === 0) return null;
  const activeGroup = findActiveGroup(groups, activeTopic);
  const chips = activeGroup ? activeGroup.topics : aggregateTopics(groups);
  const { visible, hidden } = splitTopicChips(chips, activeTopic);

  const chipLink = (chip: Chip) => (
    <li key={chip.slug}>
      <Link
        href={hrefFor(chip.slug)}
        aria-current={activeTopic === chip.slug ? "true" : undefined}
        className={cn(pillBase, activeTopic === chip.slug ? pillActive : pillIdle)}
        data-testid="blog-topic-chip"
      >
        {chip.label}
        <span className="text-xs opacity-80">({chip.count})</span>
      </Link>
    </li>
  );

  return (
    <nav aria-label={t.topicsAria} className="mt-8" data-testid="blog-topic-filter">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/70">{t.topicsTitle}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        <li>
          <Link href={hrefFor("")} aria-current={!activeTopic ? "true" : undefined} className={cn(pillBase, !activeTopic ? pillActive : pillIdle)} data-testid="blog-topic-all">
            {t.allTopics}
            <span className="text-xs opacity-80">({total})</span>
          </Link>
        </li>
        {groups.map((group) => {
          const active = activeGroup?.specialty.slug === group.specialty.slug && activeTopic === group.specialty.slug;
          return (
            <li key={group.specialty.slug}>
              <Link
                href={hrefFor(group.specialty.slug)}
                aria-current={active ? "true" : undefined}
                className={cn(pillBase, "font-medium", active ? pillActive : activeGroup?.specialty.slug === group.specialty.slug ? "border-[var(--site-primary)] bg-[var(--site-primary)]/10 text-foreground" : pillIdle)}
                data-testid="blog-topic-group"
              >
                {group.specialty.name}
                <span className="text-xs opacity-80">({group.count})</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {chips.length > 0 ? (
        <>
          <ul className="mt-3 flex flex-wrap gap-2" data-testid="blog-topic-chips">
            {visible.map(chipLink)}
          </ul>
          {hidden.length > 0 ? (
            <details className="group mt-2" data-testid="blog-more-topics">
              <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-md text-sm font-medium text-[var(--site-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)] [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">{t.moreTopics}</span>
                <span className="hidden group-open:inline">{t.lessTopics}</span>
                <ChevronDown className="h-4 w-4 transition-transform duration-300 group-open:rotate-180" aria-hidden="true" />
              </summary>
              <ul className="mt-2 flex flex-wrap gap-2">{hidden.map(chipLink)}</ul>
            </details>
          ) : null}
        </>
      ) : null}
    </nav>
  );
}
