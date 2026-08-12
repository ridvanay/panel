import type { Metadata } from "next";
import { fetchProductsServer } from "@/lib/api/server-products";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { ProductCard } from "@/components/site/product-card";

export const metadata: Metadata = { title: "Ürünler" };

export default async function ProductsIndexPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const [products, locales] = await Promise.all([fetchProductsServer(lang), fetchLocalesServer()]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold text-foreground">Ürünler</h1>

      {products.length === 0 ? (
        <p className="mt-8 text-sm text-foreground/60">Henüz ürün yayınlanmadı.</p>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              activeLocaleCode={lang}
              defaultLocaleCode={defaultLocaleCode}
            />
          ))}
        </div>
      )}
    </div>
  );
}
