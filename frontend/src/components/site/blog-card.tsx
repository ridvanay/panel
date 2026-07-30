import Link from "next/link";

interface BlogCardProps {
  title: string;
  excerpt: string;
  slug: string;
}

export function BlogCard({ title, excerpt, slug }: BlogCardProps) {
  return (
    <Link href={`/blog/${slug}`} className="block rounded-lg border border-border p-4 hover:bg-surface-muted">
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-foreground/60">{excerpt}</p>
    </Link>
  );
}
