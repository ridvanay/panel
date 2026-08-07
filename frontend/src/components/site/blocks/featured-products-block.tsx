import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { fetchProductsServer } from "@/lib/api/server-products";
import { ProductCard } from "@/components/site/product-card";
import type { FeaturedProductsBlock } from "@/lib/page-builder/types";

/**
 * §Faz 4 Site Şablonu — `products` modülü kapalıysa SESSİZCE hiçbir şey render ETMEZ (`null`
 * döner), hata/boş state göstermez; sayfanın geri kalanı normal render olmaya devam eder.
 */
export async function FeaturedProductsBlockView({ block }: { block: FeaturedProductsBlock }) {
  const enabled = await isModuleEnabledServer("products");
  if (!enabled) return null;

  const products = await fetchProductsServer();
  const filtered = block.data.categoryId
    ? products.filter((product) => product.category?.id === block.data.categoryId)
    : products;
  const items = filtered.slice(0, block.data.limit);

  if (items.length === 0) return null;

  return (
    <section className="px-4 py-16 sm:px-6">
      {block.data.heading && (
        <h2 className="text-center text-2xl font-semibold text-foreground">{block.data.heading}</h2>
      )}
      <div className={`mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4 ${block.data.heading ? "mt-8" : ""}`}>
        {items.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
