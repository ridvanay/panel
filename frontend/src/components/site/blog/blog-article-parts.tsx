import Link from "next/link";
import { CalendarCheck, Check, Clock, ExternalLink, Eye, UserRound } from "lucide-react";
import { SafeImage } from "@/components/site/safe-image";
import type { PublicBlogDetail, PublicBlogPreviewDetail } from "@/lib/api/types";
import type { BlogStrings } from "@/lib/i18n/site-dictionaries/en/blog";
import { BLOG_AUTHOR_NAME } from "@/lib/blog/json-ld";
import { fillBlogString, formatBlogDate } from "@/lib/blog/format";
import { cn } from "@/lib/utils";

export function BlogAvatar({ src, size }: { src: string | null; size: number }) {
  return (
    <span className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--site-primary)]/10 text-[var(--site-primary)]" style={{ width: size, height: size }}>
      {src ? <SafeImage src={src} alt="" fill sizes={`${size}px`} className="object-cover" /> : <UserRound className="h-1/2 w-1/2" aria-hidden="true" />}
    </span>
  );
}

/**
 * Paket AH — yazar (kurum: "WM Health Editorial Team") + yayın tarihi + okuma süresi. Hekim/inceleyen
 * satırı (Medically reviewed by / Review pending) ziyaretçi görünümünde YOKTUR. Tarihler sunucuda biçimlenir.
 */
export function BlogByline({ post, t, lang }: { post: PublicBlogDetail; t: BlogStrings; lang: string }) {
  const published = formatBlogDate(post.publishedAt, lang);
  return (
    <div className="mt-5 space-y-4" data-testid="blog-byline">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="flex items-center gap-3">
          <BlogAvatar src={null} size={44} />
          <p className="text-sm">
            <span className="block text-foreground/70">{t.writtenBy}</span>
            <span className="font-semibold text-foreground">{BLOG_AUTHOR_NAME}</span>
          </p>
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-foreground/70">
          {published ? (
            <span className="inline-flex items-center gap-1.5" data-testid="blog-published-date">
              <CalendarCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
              <time dateTime={post.publishedAt ?? undefined}>{published}</time>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-4 w-4" aria-hidden="true" />
            {fillBlogString(t.minRead, { n: post.readingMinutes })}
          </span>
        </p>
      </div>
    </div>
  );
}

/** Taslak önizleme şeridi (admin): yayında ise "Preview", değilse "yayın bekliyor" (Paket AH — hekim onayı ifadesi yok). */
export function BlogPreviewBanner({ t, status }: { t: BlogStrings; status?: PublicBlogPreviewDetail["status"] }) {
  const live = status === "PUBLISHED";
  return (
    <div role="status" className="mb-6 flex items-center gap-2 rounded-[var(--site-radius)] border border-warning/40 bg-warning/10 px-4 py-3 text-sm font-medium text-foreground" data-testid="blog-preview-banner">
      <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
      {live ? t.previewBannerLive : t.previewBannerPublish}
    </div>
  );
}

/** Paket Z1-ek — yazı sonu yazar kutusu: Editorial Team + "Content standards" bağlantısı. */
export function BlogAuthorBox({ t, standardsHref }: { t: BlogStrings; standardsHref: string }) {
  const linkClass = "inline-flex min-h-11 items-center text-sm font-semibold text-[var(--site-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]";
  return (
    <aside className="mt-10 flex gap-4 rounded-[var(--site-radius)] border border-border bg-surface p-5" data-testid="blog-author-box" aria-labelledby="blog-author-box-title">
      <BlogAvatar src={null} size={48} />
      <div className="min-w-0">
        <p id="blog-author-box-title" className="font-heading text-base font-semibold text-foreground">
          {t.authorBoxTitle}
        </p>
        <p className="mt-0.5 text-sm font-medium text-foreground">{BLOG_AUTHOR_NAME}</p>
        <p className="mt-1 text-sm text-foreground/75">{t.authorBoxText}</p>
        <p className="mt-1 flex flex-wrap gap-x-5">
          <Link href={standardsHref} className={linkClass}>
            {t.contentStandards}
          </Link>
        </p>
      </div>
    </aside>
  );
}

/** Paket Z1 — "Key takeaways" kutusu. Maddeler DÜZ METİN olarak yazılır (HTML değil). */
export function BlogKeyTakeaways({ items, title }: { items: string[]; title: string }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="blog-key-takeaways" className="mt-8 rounded-[var(--site-radius)] border border-[var(--site-primary)]/30 bg-[var(--site-primary)]/5 p-5" data-testid="blog-key-takeaways">
      <h2 id="blog-key-takeaways" className="font-heading text-lg font-semibold text-foreground">
        {title}
      </h2>
      <ul className="mt-3 space-y-2">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-2 text-base text-foreground/90">
            <Check className="mt-1 h-4 w-4 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Paket AH — yazı sonu "Talk to a patient coordinator" kartı → talep formu (hekim kartlarının yerine). */
export function BlogCoordinatorCard({ t, requestHref, className }: { t: BlogStrings; requestHref: string; className?: string }) {
  return (
    <aside className={cn("my-8 rounded-[var(--site-radius)] border border-border bg-surface p-5 sm:flex sm:items-center sm:justify-between sm:gap-6", className)} data-testid="blog-coordinator-card" aria-label={t.coordinatorTitle}>
      <div>
        <p className="font-heading text-lg font-semibold text-foreground">{t.coordinatorTitle}</p>
        <p className="mt-1 text-sm text-foreground/70">{t.coordinatorText}</p>
      </div>
      <Link
        href={requestHref}
        data-testid="blog-coordinator-cta"
        className="mt-4 inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-primary)] px-5 text-sm font-semibold text-white transition-opacity duration-300 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)] sm:mt-0 sm:w-auto"
      >
        {t.coordinatorButton}
      </Link>
    </aside>
  );
}

/** Paket Z1 — "References": dış bağlantılar yeni sekmede ve `rel="noopener noreferrer nofollow"` ile; yalnızca https bağlanır. */
export function BlogReferences({ items, t, lang }: { items: PublicBlogDetail["references"]; t: BlogStrings; lang: string }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="blog-references" className="mt-12" data-testid="blog-references">
      <h2 id="blog-references" className="font-heading text-2xl font-semibold text-foreground">
        {t.referencesTitle}
      </h2>
      <ol className="mt-4 list-decimal space-y-3 ps-6 text-sm text-foreground/80">
        {items.map((ref, index) => {
          const accessed = formatBlogDate(ref.accessedAt, lang);
          const safe = /^https:\/\//i.test(ref.url);
          return (
            <li key={`${ref.url}-${index}`}>
              {safe ? (
                <a href={ref.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium text-[var(--site-primary)] hover:underline">
                  {ref.title}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">{t.referenceOpensNew}</span>
                </a>
              ) : (
                <span className="font-medium text-foreground">{ref.title}</span>
              )}
              <span className="block text-foreground/70">
                {ref.publisher}
                {accessed ? ` · ${fillBlogString(t.referenceAccessed, { date: accessed })}` : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
