import type { Metadata } from "next";
import { fetchBlogPostsServer } from "@/lib/api/server-blog";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteAppearanceServer } from "@/lib/api/server-appearance";
import { BlogCard } from "@/components/site/blog-card";
import { PageHeader } from "@/components/site/page-header";

export const metadata: Metadata = { title: "Blog" };

export default async function BlogIndexPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const [posts, locales, appearance] = await Promise.all([
    fetchBlogPostsServer(lang),
    fetchLocalesServer(),
    fetchSiteAppearanceServer(),
  ]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;

  return (
    <>
      <PageHeader
        title="Blog"
        style={appearance.pageHeaderStyle}
        backgroundColor={appearance.pageHeaderBackgroundColor}
        backgroundUrl={appearance.pageHeaderBackgroundUrl}
        overlayOpacity={appearance.pageHeaderOverlayOpacity}
        containerClassName="mx-auto max-w-4xl px-4 sm:px-6"
      />
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        {posts.length === 0 ? (
          <p className="mt-8 text-sm text-foreground/60">Henüz yazı yayınlanmadı.</p>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {posts.map((post) => (
              <BlogCard
                key={post.id}
                title={post.title}
                excerpt={post.excerpt ?? ""}
                slug={post.slug}
                activeLocaleCode={lang}
                defaultLocaleCode={defaultLocaleCode}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
