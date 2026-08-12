import Link from "next/link";
import { withLocalePrefix } from "@/lib/i18n/site-path";

interface BlogCardProps {
  title: string;
  excerpt: string;
  slug: string;
  activeLocaleCode?: string;
  defaultLocaleCode?: string;
}

export function BlogCard({ title, excerpt, slug, activeLocaleCode, defaultLocaleCode }: BlogCardProps) {
  const href = activeLocaleCode
    ? withLocalePrefix(`/blog/${slug}`, activeLocaleCode, defaultLocaleCode ?? activeLocaleCode)
    : `/blog/${slug}`;

  return (
    <Link href={href} className="block rounded-lg border border-border p-4 hover:bg-surface-muted">
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-foreground/60">{excerpt}</p>
    </Link>
  );
}
