import type { Metadata } from "next";
import { PackageSearch, SearchX } from "lucide-react";
import { fetchProductCatalogServer } from "@/lib/api/server-products";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteAppearanceServer } from "@/lib/api/server-appearance";
import { ProductCard } from "@/components/site/product-card";
import { PageHeader } from "@/components/site/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CatalogSidebar } from "@/components/site/catalog/catalog-sidebar";
import { CatalogToolbar } from "@/components/site/catalog/catalog-toolbar";
import { ActiveFilterChips } from "@/components/site/catalog/active-filter-chips";
import { CatalogPagination } from "@/components/site/catalog/catalog-pagination";
import { buildClearAllHref, hasActiveCatalogFilters, parseCatalogFilters, type RawSearchParams } from "@/lib/catalog-search-params";
import { withLocalePrefix } from "@/lib/i18n/site-path";

export const metadata: Metadata = { title: "Ürünler" };

interface ProductsIndexPageProps {
  params: Promise<{ lang: string }>;
  /**
   * `.claude/architect-scope-products-catalog.md` §5.4 madde 1 — URL TEK durum kaynağı, bu sayfa
   * SUNUCUDA render edilir; `useSearchParams`/Suspense KULLANILMAZ. Filtre bileşenleri (client)
   * bu sunucu tarafında ayrıştırılmış `CatalogFilters`'ı prop olarak alır, kendi state'lerini
   * `router.replace` ile günceller — `[slug]/page.tsx`'in `?variant=` deseniyle AYNI.
   */
  searchParams: Promise<RawSearchParams>;
}

export default async function ProductsIndexPage({ params, searchParams }: ProductsIndexPageProps) {
  const { lang } = await params;
  const rawSearchParams = await searchParams;
  const filters = parseCatalogFilters(rawSearchParams);

  const [catalog, locales, appearance] = await Promise.all([
    fetchProductCatalogServer(filters, lang),
    fetchLocalesServer(),
    fetchSiteAppearanceServer(),
  ]);

  // Ağ hatası/`!res.ok` — "0 sonuç" (geçerli, filtrelerle eşleşen ürün yok) ile "API'ye
  // ulaşılamadı" (gerçek hata) durumlarını KARIŞTIRMAMAK için `error.tsx` sınırına fırlatılır
  // (bkz. `server-products.ts::fetchProductCatalogServer` yorumu).
  if (!catalog) {
    throw new Error("Ürün kataloğu yüklenemedi.");
  }

  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const { items, meta } = catalog;
  const isFiltered = hasActiveCatalogFilters(filters);
  const clearAllHref = withLocalePrefix(buildClearAllHref("/products", filters), lang, defaultLocaleCode);

  return (
    <>
      <PageHeader
        title="Ürünler"
        style={appearance.pageHeaderStyle}
        layout={appearance.pageHeaderLayout}
        backgroundColor={appearance.pageHeaderBackgroundColor}
        backgroundUrl={appearance.pageHeaderBackgroundUrl}
        overlayOpacity={appearance.pageHeaderOverlayOpacity}
        containerClassName="mx-auto max-w-7xl px-4 sm:px-6"
      />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="lg:flex lg:items-start lg:gap-8">
          <CatalogSidebar filters={filters} facets={meta.facets} />

          <div className="mt-6 min-w-0 flex-1 lg:mt-0">
            <CatalogToolbar filters={filters} total={meta.pagination.total} facets={meta.facets} />
            <div className="mt-4">
              <ActiveFilterChips filters={filters} facets={meta.facets} />
            </div>

            {items.length === 0 ? (
              isFiltered ? (
                <EmptyState
                  icon={SearchX}
                  title="Bu filtrelerle sonuç bulunamadı"
                  description="Filtreleri değiştirmeyi veya temizlemeyi deneyin."
                  className="mt-8"
                  action={
                    <a
                      href={clearAllHref}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Filtreleri Temizle
                    </a>
                  }
                />
              ) : (
                <EmptyState icon={PackageSearch} title="Henüz ürün yayınlanmadı" description="Yeni ürünler eklendiğinde burada listelenecek." className="mt-8" />
              )
            ) : (
              <div
                className={
                  filters.view === "list"
                    ? "mt-6 flex flex-col gap-3"
                    : filters.view === "grid4"
                      ? "mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4"
                      : "mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
                }
              >
                {items.map((product, index) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    activeLocaleCode={lang}
                    defaultLocaleCode={defaultLocaleCode}
                    variant={filters.view === "list" ? "list" : "grid"}
                    priority={index < 4}
                  />
                ))}
              </div>
            )}

            <CatalogPagination filters={filters} pagination={meta.pagination} />
          </div>
        </div>
      </div>
    </>
  );
}
