import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchBlogPostBySlugServer } from "@/lib/api/server-blog";
import { ViewTracker } from "@/components/site/view-tracker";
import { ViewCount } from "@/components/site/view-count";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await fetchBlogPostBySlugServer(slug);
  if (!post) return {};

  const description = post.excerpt ?? undefined;
  const images = post.coverImageUrl ? [post.coverImageUrl] : undefined;

  return {
    title: post.title,
    description,
    openGraph: { title: post.title, description, type: "article", images },
    twitter: { card: images ? "summary_large_image" : "summary", title: post.title, description, images },
  };
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = await fetchBlogPostBySlugServer(slug);
  if (!post) notFound();

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <ViewTracker kind="blog" slug={slug} />
      {post.category && <p className="text-sm font-medium text-primary">{post.category.name}</p>}
      <h1 className="mt-1 text-3xl font-semibold text-foreground">{post.title}</h1>
      <div className="mt-2">
        <ViewCount count={post.viewCount} />
      </div>
      {post.coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- kapak URL'si medya kütüphanesinden gelecek, next/image remotePatterns henüz tanımlı değil
        <img src={post.coverImageUrl} alt="" className="mt-6 w-full rounded-lg object-cover" />
      )}
      <div className="prose mt-6 max-w-none" dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
    </article>
  );
}
