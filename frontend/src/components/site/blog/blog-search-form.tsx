import { Search } from "lucide-react";
import type { BlogStrings } from "@/lib/i18n/site-dictionaries/en/blog";
import { MAX_QUERY_LENGTH } from "@/lib/blog/topics";

/**
 * Paket Z1 — sunucu tarafı arama: düz GET formu (`?q=`), JS gerekmez. Konu seçiliyse gizli alanla korunur;
 * arama her zaman ilk sayfaya döner (`action` her zaman sayfasız blog yoludur).
 */
export function BlogSearchForm({ action, q, topic, t }: { action: string; q: string; topic: string; t: BlogStrings }) {
  return (
    <form role="search" method="get" action={action} className="mt-6 flex max-w-xl gap-2" data-testid="blog-search">
      {topic ? <input type="hidden" name="topic" value={topic} /> : null}
      <div className="relative flex-1">
        <label htmlFor="blog-search-input" className="sr-only">
          {t.searchLabel}
        </label>
        <Search className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-foreground/50" aria-hidden="true" />
        <input
          id="blog-search-input"
          type="search"
          name="q"
          defaultValue={q}
          maxLength={MAX_QUERY_LENGTH}
          placeholder={t.searchPlaceholder}
          className="h-11 w-full rounded-[var(--site-radius)] border border-border bg-background ps-10 pe-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)]"
        />
      </div>
      <button
        type="submit"
        className="inline-flex h-11 items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-primary)] px-5 text-sm font-semibold text-white transition-opacity duration-300 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
      >
        {t.searchSubmit}
      </button>
    </form>
  );
}
