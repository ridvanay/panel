import type { Metadata } from "next";
import { BlogPostPage, buildBlogPostMetadata } from "@/components/site/blog/blog-post-page";

/** Paket Z1 — `/[lang]/blog/[slug]`: gövde `BlogPostPage`'de (taslak / çevirisiz dil: 404). */
type PageProps = { params: Promise<{ lang: string; slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang, slug } = await params;
  return buildBlogPostMetadata({ lang, slug });
}

export default async function BlogPostRoute({ params }: PageProps) {
  const { lang, slug } = await params;
  return <BlogPostPage lang={lang} slug={slug} />;
}
