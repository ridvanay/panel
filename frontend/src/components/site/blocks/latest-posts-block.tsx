import { cn } from "@/lib/utils";
import { fetchBlogPostsServer } from "@/lib/api/server-blog";
import { BlogCard } from "@/components/site/blog-card";
import type { BlockChrome, LatestPostsBlock } from "@/lib/page-builder/types";

/**
 * `featured-products-block.tsx` ile AYNI desen: blog ARTIK kapatılabilir bir modül değil (bkz.
 * `backend/lib/module-registry.ts` — yalnızca `products`/`portfolio` toggle'lı), bu yüzden
 * "modül kapalı" uyarısı YOK. `fetchBlogPostsServer` ≤50 yazıyı `seq ASC` (eskiden yeniye)
 * döndürür — "Son Yazılar" bloğu için BURADA `publishedAt` DESC'e yeniden sıralanır.
 */
export async function LatestPostsBlockView({ block, chrome }: { block: LatestPostsBlock; chrome: BlockChrome }) {
  const posts = await fetchBlogPostsServer();

  const filtered = posts.filter(
    (post) =>
      (!block.data.categoryId || post.category?.id === block.data.categoryId) &&
      (!block.data.tagId || post.tags.some((tag) => tag.id === block.data.tagId))
  );

  const sorted = [...filtered].sort((a, b) => {
    const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return bTime - aTime;
  });

  const items = sorted.slice(0, block.data.limit);
  if (items.length === 0) return null;

  return (
    <section className={cn(chrome === "page" && "px-4 py-16 sm:px-6")}>
      {block.data.heading && <h2 className="text-center text-2xl font-semibold text-foreground">{block.data.heading}</h2>}
      <div className={cn("mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3", block.data.heading && "mt-8")}>
        {items.map((post) => (
          <BlogCard key={post.id} title={post.title} excerpt={post.excerpt ?? ""} slug={post.slug} />
        ))}
      </div>
    </section>
  );
}
