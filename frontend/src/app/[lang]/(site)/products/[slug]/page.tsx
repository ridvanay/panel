import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchProductBySlugServer } from "@/lib/api/server-products";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { ViewTracker } from "@/components/site/view-tracker";
import { SyncLocaleAlternates } from "@/components/site/sync-locale-alternates";
import { SocialShareButtons } from "@/components/site/social-share-buttons";
import { fetchSiteAppearanceServer } from "@/lib/api/server-appearance";
import { RichContentWithShortcodes } from "@/components/site/blocks/rich-content-with-shortcodes";
import { ProductPurchasePanel } from "@/components/site/product/product-purchase-panel";
import { ProductDocuments } from "@/components/site/product/product-documents";
import { ProductBreadcrumbs } from "@/components/site/product/product-breadcrumbs";
import { ProductTabs } from "@/components/site/product/product-tabs";
import { redirectToCanonicalSlug } from "@/lib/i18n/canonical-slug";
import { resolveReturnsPolicyPage } from "@/lib/legal-pages";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { buildContentMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/env";
import { buttonVariants } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

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
  const [product, locales, appearance, settings, pages, resolvedSearchParams] = await Promise.all([
    fetchProductBySlugServer(slug, lang),
    fetchLocalesServer(),
    fetchSiteAppearanceServer(),
    fetchSiteSettingsServer(),
    fetchPublishedPagesServer(lang),
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
  const defaultLocaleCode = defaultLocale?.code ?? lang;
  const canonicalUrl = `${SITE_URL}${lang === defaultLocale?.code ? "" : `/${lang}`}/products/${slug}`;
  const legalPage = resolveReturnsPolicyPage(pages);
  const legalHref = legalPage ? withLocalePrefix(`/${legalPage.slug}`, lang, defaultLocaleCode) : null;

  return (
    <article className="mx-auto max-w-6xl px-4 py-10 pb-24 sm:px-6 lg:pb-10">
      <SyncLocaleAlternates kind="product" items={product.localizations} />
      <ViewTracker kind="product" slug={slug} />

      <ProductBreadcrumbs
        activeLocaleCode={lang}
        defaultLocaleCode={defaultLocaleCode}
        category={product.category}
        productTitle={product.title}
      />

      <ProductPurchasePanel
        product={product}
        initialVariantId={initialVariantId}
        activeLocaleCode={lang}
        defaultLocaleCode={defaultLocaleCode}
        shippingEstimatedDaysMin={settings.shippingEstimatedDaysMin}
        shippingEstimatedDaysMax={settings.shippingEstimatedDaysMax}
      />

      <ProductTabs
        descriptionContent={<RichContentWithShortcodes html={product.descriptionHtml} className="prose max-w-none" />}
        documentsContent={product.documents.length > 0 ? <ProductDocuments documents={product.documents} showHeading={false} /> : null}
        returnsContent={
          <>
            <p>İade ve garanti koşulları hakkında detaylı bilgi için:</p>
            {legalPage && legalHref ? (
              <Link href={legalHref} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-3 rounded-[var(--site-radius)]")}>
                {legalPage.title} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <p className="mt-2 text-foreground/50">Şu anda yayınlanmış bir iade/garanti sayfası bulunmuyor.</p>
            )}
          </>
        }
      />

      {appearance.socialShareEnabled && appearance.socialShareNetworks.length > 0 && (
        <div className="mt-8">
          <SocialShareButtons url={canonicalUrl} title={product.title} networks={appearance.socialShareNetworks} />
        </div>
      )}
    </article>
  );
}
