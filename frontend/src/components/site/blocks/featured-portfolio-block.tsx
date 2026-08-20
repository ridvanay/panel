import { cn } from "@/lib/utils";
import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { fetchPortfolioItemsServer } from "@/lib/api/server-portfolio";
import { PortfolioCard } from "@/components/site/portfolio-card";
import type { BlockChrome, FeaturedPortfolioBlock } from "@/lib/page-builder/types";

/**
 * §Faz 4 Site Şablonu — `portfolio` modülü kapalıysa SESSİZCE hiçbir şey render ETMEZ (`null`
 * döner), hata/boş state göstermez; sayfanın geri kalanı normal render olmaya devam eder.
 */
export async function FeaturedPortfolioBlockView({ block, chrome }: { block: FeaturedPortfolioBlock; chrome: BlockChrome }) {
  const enabled = await isModuleEnabledServer("portfolio");
  if (!enabled) return null;

  const items = await fetchPortfolioItemsServer();
  const filtered = block.data.categoryId
    ? items.filter((item) => item.category?.id === block.data.categoryId)
    : items;
  const visible = filtered.slice(0, block.data.limit);

  if (visible.length === 0) return null;

  return (
    <section className={cn(chrome === "page" && "px-4 py-16 sm:px-6")}>
      {block.data.heading && (
        <h2 className="text-center text-2xl font-semibold text-foreground">{block.data.heading}</h2>
      )}
      <div className={`mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4 ${block.data.heading ? "mt-8" : ""}`}>
        {visible.map((item) => (
          <PortfolioCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
