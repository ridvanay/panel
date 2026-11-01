import Link from "next/link";
import { Clock } from "lucide-react";
import type { PublicBlogCard } from "@/lib/api/types";
import type { BlogStrings } from "@/lib/i18n/site-dictionaries/en/blog";
import { fillBlogString, formatBlogDate } from "@/lib/blog/format";
import { BlogCover } from "./blog-cover";
import { BlogAvatar } from "./blog-article-parts";
import { BlogSpecialtyChip } from "./blog-specialty-chip";

/**
 * Paket Z1 — kart ızgarası öğesi: kapak, kategori, başlık, özet, onaylayan hekim ✓, tarih, okuma süresi.
 * Tüm kart "gerilmiş bağlantı" (başlığın `after:` katmanı) ile tıklanır; kart içinde başka bağlantı yoktur.
 * Hekim satırı yalnızca onaylı hekim varken çizilir (backend `reviewer` alanı yalnızca `approved` iken dolu).
 */
export function BlogPostCard({
  post,
  href,
  t,
  lang,
  priority = false,
}: {
  post: PublicBlogCard;
  href: string;
  t: BlogStrings;
  lang: string;
  priority?: boolean;
}) {
  const date = formatBlogDate(post.lastReviewedAt ?? post.publishedAt, lang);
  return (
    <article
      className="group relative flex flex-col overflow-hidden rounded-[var(--site-radius)] border border-border bg-background transition-colors duration-300 focus-within:border-[var(--site-primary)] hover:border-[var(--site-primary)]"
      data-testid="blog-card"
    >
      <BlogCover src={post.coverUrl} specialtySlug={post.specialty?.slug} label={post.specialty?.name ?? t.coverTemplateLabel} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" priority={priority} className="aspect-[16/9] w-full" />
      <div className="flex flex-1 flex-col p-4">
        {post.category || post.specialty ? (
          <p>
            <BlogSpecialtyChip slug={post.specialty?.slug} label={(post.category ?? post.specialty)!.name} />
          </p>
        ) : null}
        <h3 className="mt-2 font-heading text-lg font-semibold leading-snug text-foreground">
          <Link href={href} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[var(--site-primary)]">
            {post.title}
          </Link>
        </h3>
        {post.excerpt ? <p className="mt-2 line-clamp-3 text-sm text-foreground/70">{post.excerpt}</p> : null}
        <div className="mt-auto space-y-1.5 pt-4 text-xs text-foreground/70">
          {post.reviewer ? (
            <p className="flex items-center gap-1.5 font-medium text-foreground/80" data-testid="blog-card-reviewer">
              <BlogAvatar src={post.reviewer.avatarUrl} size={24} />
              <span>{fillBlogString(t.reviewedBy, { name: post.reviewer.name })}</span>
            </p>
          ) : null}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {date ? <time dateTime={(post.lastReviewedAt ?? post.publishedAt) ?? undefined}>{date}</time> : null}
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {fillBlogString(t.minRead, { n: post.readingMinutes })}
            </span>
          </p>
        </div>
      </div>
    </article>
  );
}
