import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchProductBySlugServer } from "@/lib/api/server-products";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteAppearanceServer } from "@/lib/api/server-appearance";
import { ViewTracker } from "@/components/site/view-tracker";
import { ViewCount } from "@/components/site/view-count";
import { FavoriteButton } from "@/components/site/favorite-button";
import { SyncLocaleAlternates } from "@/components/site/sync-locale-alternates";
import { PageHeader } from "@/components/site/page-header";
import { SocialShareButtons } from "@/components/site/social-share-buttons";
import { RichContentWithShortcodes } from "@/components/site/blocks/rich-content-with-shortcodes";
import { ProductPurchasePanel } from "@/components/site/product/product-purchase-panel";
import { ProductDocuments } from "@/components/site/product/product-documents";
import { redirectToCanonicalSlug } from "@/lib/i18n/canonical-slug";
import { buildContentMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/env";

type PageProps = {
  params: Promise<{ lang: string; slug: string }>;
  /** `?variant=<id>` — PDP varyasyon seçici burada okunur (bkz. `product-purchase-panel.tsx`); `useSearchParams`/Suspense KULLANILMAZ. */
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang, slug } = await params;
  const [product, settings, locales] = await Promise.all([
    fetchProductBySlugServer(slug, lang),
    fetchSiteSettingsServer(),
    fetchLocalesServer(),
  ]);
  if (!product) return {};

  const defaultLocale = locales.find((l) => l.isDefault);

  return buildContentMetadata(
    {
      title: product.title,
      description: product.excerpt,
      ogTitle: product.ogTitle,
      ogImageUrl: product.ogImageUrl,
      canonicalUrl: product.canonicalUrl,
      noIndex: product.noIndex,
    },
    {
      fallbackCanonicalUrl: `${SITE_URL}${lang === defaultLocale?.code ? "" : `/${lang}`}/products/${slug}`,
      siteName: settings.siteName,
      type: "website",
      fallbackImageUrl: product.coverMedia?.url ?? null,
      localizations: product.localizations,
      locales,
      activeLocale: lang,
      pathPrefix: "/products",
    },
  );
}

export default async function ProductDetailPage({ params, searchParams }: PageProps) {
  const { lang, slug } = await params;
  const [product, locales, appearance, resolvedSearchParams] = await Promise.all([
    fetchProductBySlugServer(slug, lang),
    fetchLocalesServer(),
    fetchSiteAppearanceServer(),
    searchParams,
  ]);
  if (!product) notFound();

  const variantParam = resolvedSearchParams.variant;
  const initialVariantId = typeof variantParam === "string" ? variantParam : null;

  // §12.2 — duplicate content önleme, bkz. `[slug]/page.tsx` AYNI mantık.
  redirectToCanonicalSlug({
    requestedSlug: slug,
    activeLocale: lang,
    localizations: product.localizations,
    locales,
    pathPrefix: "/products",
  });

  const defaultLocale = locales.find((l) => l.isDefault);
  const canonicalUrl = `${SITE_URL}${lang === defaultLocale?.code ? "" : `/${lang}`}/products/${slug}`;

  return (
    <>
      <PageHeader
        title={product.title}
        style={appearance.pageHeaderStyle}
        layout={appearance.pageHeaderLayout}
        backgroundColor={appearance.pageHeaderBackgroundColor}
        backgroundUrl={appearance.pageHeaderBackgroundUrl}
        overlayOpacity={appearance.pageHeaderOverlayOpacity}
        containerClassName="mx-auto max-w-4xl px-4 sm:px-6"
      />
      <article className="mx-auto max-w-4xl px-4 py-10 pb-24 sm:px-6 lg:pb-10">
        <SyncLocaleAlternates kind="product" items={product.localizations} />
        <ViewTracker kind="product" slug={slug} />

        {product.category && <p className="text-sm font-medium text-primary">{product.category.name}</p>}
        <div className="mt-2 flex items-center gap-3">
          <ViewCount count={product.viewCount} />
          <FavoriteButton productId={product.id} className="ml-auto border border-border" />
        </div>

        <ProductPurchasePanel product={product} initialVariantId={initialVariantId} />

        <RichContentWithShortcodes html={product.descriptionHtml} className="prose mt-6 max-w-none" />

        <ProductDocuments documents={product.documents} />

        {appearance.socialShareEnabled && appearance.socialShareNetworks.length > 0 && (
          <div className="mt-8">
            <SocialShareButtons url={canonicalUrl} title={product.title} networks={appearance.socialShareNetworks} />
          </div>
        )}
      </article>
    </>
  );
}
