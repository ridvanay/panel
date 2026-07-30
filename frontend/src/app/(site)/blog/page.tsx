import type { Metadata } from "next";
import { fetchBlogPostsServer } from "@/lib/api/server-blog";
import { BlogCard } from "@/components/site/blog-card";

export const metadata: Metadata = { title: "Blog" };

export default async function BlogIndexPage() {
  const posts = await fetchBlogPostsServer();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold text-foreground">Blog</h1>

      {posts.length === 0 ? (
        <p className="mt-8 text-sm text-foreground/60">Henüz yazı yayınlanmadı.</p>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {posts.map((post) => (
            <BlogCard key={post.id} title={post.title} excerpt={post.excerpt ?? ""} slug={post.slug} />
          ))}
        </div>
      )}
    </div>
  );
}
