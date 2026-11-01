import type { Metadata } from "next";
import { BlogIndexPage, buildBlogIndexMetadata, type BlogSearchParams } from "@/components/site/blog/blog-index-page";

/** Paket Z1 — `/[lang]/blog` (1. sayfa). Sayfalama `/[lang]/blog/page/[n]`'dedir; canonical/noindex kararı `buildBlogIndexMetadata`'da. */
type PageProps = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<BlogSearchParams>;
};

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { lang } = await params;
  return buildBlogIndexMetadata({ lang, page: 1, searchParams: await searchParams });
}

export default async function BlogIndexRoute({ params, searchParams }: PageProps) {
  const { lang } = await params;
  return <BlogIndexPage lang={lang} page={1} searchParams={await searchParams} />;
}
