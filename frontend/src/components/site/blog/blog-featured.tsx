import Link from "next/link";
import { ArrowRight, BadgeCheck, Clock } from "lucide-react";
import type { PublicBlogCard } from "@/lib/api/types";
import type { BlogStrings } from "@/lib/i18n/site-dictionaries/en/blog";
import { fillBlogString, formatBlogDate } from "@/lib/blog/format";
import { BlogCover } from "./blog-cover";

/** Paket Z1 — "Latest" öne çıkan blok: büyük kapak, kategori, başlık, özet, ✓ hekim, tarih, okuma süresi, "Read the article". */
export function BlogFeatured({ post, href, t, lang }: { post: PublicBlogCard; href: string; t: BlogStrings; lang: string }) {
  const date = formatBlogDate(post.lastReviewedAt ?? post.publishedAt, lang);
  return (
    <section aria-labelledby="blog-latest-heading" className="mt-8" data-testid="blog-featured">
      <h2 id="blog-latest-heading" className="sr-only">
        {t.latestLabel}
      </h2>
      <article className="grid overflow-hidden rounded-[var(--site-radius)] border border-border bg-background lg:grid-cols-2">
        <BlogCover src={post.coverUrl} specialtySlug={post.specialty?.slug} label={post.specialty?.name ?? t.coverTemplateLabel} sizes="(min-width: 1024px) 50vw, 100vw" priority large className="aspect-[16/9] w-full lg:aspect-auto lg:min-h-80" />
        <div className="flex flex-col justify-center p-6 sm:p-8">
          <p className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide">
            <span className="rounded-full bg-[var(--site-primary)] px-2.5 py-0.5 text-white">{t.latestLabel}</span>
            {post.category ? <span className="text-[var(--site-primary)]">{post.category.name}</span> : null}
          </p>
          <h3 className="mt-3 font-heading text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
            <Link href={href} className="hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]">
              {post.title}
            </Link>
          </h3>
          {post.excerpt ? <p className="mt-3 text-base text-foreground/70">{post.excerpt}</p> : null}
          {post.reviewer ? (
            <p className="mt-4 flex items-center gap-1.5 text-sm font-medium text-foreground/80" data-testid="blog-featured-reviewer">
              <BadgeCheck className="h-4 w-4 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
              <span>{fillBlogString(t.reviewedBy, { name: post.reviewer.name })}</span>
            </p>
          ) : null}
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground/70">
            {date ? <time dateTime={(post.lastReviewedAt ?? post.publishedAt) ?? undefined}>{date}</time> : null}
            <span className="inline-flex items-center gap-1">
              <Clock className="h-4 w-4" aria-hidden="true" />
              {fillBlogString(t.minRead, { n: post.readingMinutes })}
            </span>
          </p>
          <Link
            href={href}
            className="mt-6 inline-flex min-h-11 w-fit items-center gap-2 rounded-[var(--site-radius)] bg-[var(--site-primary)] px-5 text-sm font-semibold text-white transition-opacity duration-300 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
          >
            {t.readArticle}
            <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
          </Link>
        </div>
      </article>
    </section>
  );
}
