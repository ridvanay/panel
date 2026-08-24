import type { Metadata } from "next";
import { fetchProductsServer } from "@/lib/api/server-products";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteAppearanceServer } from "@/lib/api/server-appearance";
import { ProductCard } from "@/components/site/product-card";
import { PageHeader } from "@/components/site/page-header";

export const metadata: Metadata = { title: "Ürünler" };

export default async function ProductsIndexPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const [products, locales, appearance] = await Promise.all([
    fetchProductsServer(lang),
    fetchLocalesServer(),
    fetchSiteAppearanceServer(),
  ]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;

  return (
    <>
      <PageHeader
        title="Ürünler"
        style={appearance.pageHeaderStyle}
        layout={appearance.pageHeaderLayout}
        backgroundColor={appearance.pageHeaderBackgroundColor}
        backgroundUrl={appearance.pageHeaderBackgroundUrl}
        overlayOpacity={appearance.pageHeaderOverlayOpacity}
        containerClassName="mx-auto max-w-5xl px-4 sm:px-6"
      />
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
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
    </>
  );
}
