import Link from "next/link";
import { BadgeCheck, CalendarCheck, Check, Clock, ExternalLink, UserRound } from "lucide-react";
import { SafeImage } from "@/components/site/safe-image";
import type { PublicBlogDetail } from "@/lib/api/types";
import type { BlogStrings } from "@/lib/i18n/site-dictionaries/en/blog";
import { BLOG_AUTHOR_NAME } from "@/lib/blog/json-ld";
import { fillBlogString, formatBlogDate } from "@/lib/blog/format";
import { cn } from "@/lib/utils";

function Avatar({ src, size }: { src: string | null; size: number }) {
  return (
    <span className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--site-primary)]/10 text-[var(--site-primary)]" style={{ width: size, height: size }}>
      {src ? <SafeImage src={src} alt="" fill sizes={`${size}px`} className="object-cover" /> : <UserRound className="h-1/2 w-1/2" aria-hidden="true" />}
    </span>
  );
}

/**
 * Paket Z1 — yazar (kurum) + tıbbi gözden geçiren hekim (foto, ad, unvan, profil bağlantısı) + "Last reviewed"
 * + okuma süresi. Hekim satırı yalnızca onaylı hekim varken; "Last reviewed" yalnızca tarih doluyken çizilir.
 * Tarihler sunucuda biçimlenir (hidrasyon güvenli).
 */
export function BlogByline({ post, t, lang, physicianHref }: { post: PublicBlogDetail; t: BlogStrings; lang: string; physicianHref: (slug: string) => string }) {
  const reviewed = formatBlogDate(post.lastReviewedAt, lang);
  const reviewer = post.reviewer;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-4" data-testid="blog-byline">
      <div className="flex items-center gap-3">
        <Avatar src={null} size={44} />
        <p className="text-sm">
          <span className="block text-foreground/70">{t.writtenBy}</span>
          <span className="font-semibold text-foreground">{BLOG_AUTHOR_NAME}</span>
        </p>
      </div>
      {reviewer ? (
        <div className="flex items-center gap-3" data-testid="blog-byline-reviewer">
          <Avatar src={reviewer.avatarUrl} size={44} />
          <p className="text-sm">
            <span className="flex items-center gap-1 text-foreground/70">
              <BadgeCheck className="h-4 w-4 text-[var(--site-primary)]" aria-hidden="true" />
              {t.medicalReviewBy}
            </span>
            <Link href={physicianHref(reviewer.slug)} aria-label={fillBlogString(t.profileAria, { name: reviewer.name })} className="font-semibold text-foreground hover:text-[var(--site-primary)] hover:underline">
              {reviewer.name}
            </Link>
            {reviewer.specialty ? <span className="block text-foreground/70">{reviewer.specialty.name}</span> : null}
          </p>
        </div>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-foreground/70">
        {reviewed ? (
          <span className="inline-flex items-center gap-1.5" data-testid="blog-last-reviewed">
            <CalendarCheck className="h-4 w-4" aria-hidden="true" />
            <time dateTime={post.lastReviewedAt ?? undefined}>{fillBlogString(t.lastReviewed, { date: reviewed })}</time>
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-4 w-4" aria-hidden="true" />
          {fillBlogString(t.minRead, { n: post.readingMinutes })}
        </span>
      </p>
    </div>
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

/** Paket Z1 — "Consult a physician" kartı (yazının ortasında ve sonunda): ilgili uzmanlığın 2 hekimi + "Book" → profil #randevu. */
export function BlogConsultCard({
  doctors,
  t,
  physicianHref,
  className,
}: {
  doctors: PublicBlogDetail["consultDoctors"];
  t: BlogStrings;
  physicianHref: (slug: string) => string;
  className?: string;
}) {
  if (doctors.length === 0) return null;
  return (
    <aside className={cn("my-8 rounded-[var(--site-radius)] border border-border bg-surface p-5", className)} data-testid="blog-consult-card" aria-label={t.consultTitle}>
      <p className="font-heading text-lg font-semibold text-foreground">{t.consultTitle}</p>
      <p className="mt-1 text-sm text-foreground/70">{t.consultText}</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {doctors.map((doctor) => (
          <li key={doctor.slug} className="flex items-center gap-3 rounded-[var(--site-radius)] border border-border bg-background p-3">
            <Avatar src={doctor.avatarUrl} size={48} />
            <div className="min-w-0 flex-1">
              <Link href={physicianHref(doctor.slug)} aria-label={fillBlogString(t.profileAria, { name: doctor.name })} className="block truncate text-sm font-semibold text-foreground hover:underline">
                {doctor.name}
              </Link>
              {doctor.specialty ? <p className="truncate text-xs text-foreground/70">{doctor.specialty.name}</p> : null}
            </div>
            <Link
              href={`${physicianHref(doctor.slug)}#randevu`}
              aria-label={fillBlogString(t.bookAria, { name: doctor.name })}
              className="inline-flex min-h-10 shrink-0 items-center rounded-[var(--site-radius)] bg-[var(--site-primary)] px-4 text-sm font-semibold text-white transition-opacity duration-300 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
            >
              {t.bookButton}
            </Link>
          </li>
        ))}
      </ul>
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
