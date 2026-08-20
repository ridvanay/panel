import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchProductBySlugServer } from "@/lib/api/server-products";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteAppearanceServer } from "@/lib/api/server-appearance";
import { ViewTracker } from "@/components/site/view-tracker";
import { ViewCount } from "@/components/site/view-count";
import { AddToCartButton } from "@/components/site/add-to-cart-button";
import { SyncLocaleAlternates } from "@/components/site/sync-locale-alternates";
import { PageHeader } from "@/components/site/page-header";
import { SocialShareButtons } from "@/components/site/social-share-buttons";
import { redirectToCanonicalSlug } from "@/lib/i18n/canonical-slug";
import { buildContentMetadata } from "@/lib/seo";
import { formatPriceFromCents } from "@/lib/format-price";
import { SITE_URL } from "@/lib/env";

type PageProps = { params: Promise<{ lang: string; slug: string }> };

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

export default async function ProductDetailPage({ params }: PageProps) {
  const { lang, slug } = await params;
  const [product, locales, appearance] = await Promise.all([
    fetchProductBySlugServer(slug, lang),
    fetchLocalesServer(),
    fetchSiteAppearanceServer(),
  ]);
  if (!product) notFound();

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

  const soldOut = product.stockQuantity === 0;
  const gallery = product.images.length > 0 ? product.images : [];

  return (
    <>
      <PageHeader
        title={product.title}
        style={appearance.pageHeaderStyle}
        backgroundColor={appearance.pageHeaderBackgroundColor}
        backgroundUrl={appearance.pageHeaderBackgroundUrl}
        overlayOpacity={appearance.pageHeaderOverlayOpacity}
        containerClassName="mx-auto max-w-4xl px-4 sm:px-6"
      />
      <article className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <SyncLocaleAlternates kind="product" items={product.localizations} />
        <ViewTracker kind="product" slug={slug} />

        {product.category && <p className="text-sm font-medium text-primary">{product.category.name}</p>}
        <div className="mt-2 flex items-center gap-3">
          <ViewCount count={product.viewCount} />
          {soldOut && (
            <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-medium text-danger-foreground">Tükendi</span>
          )}
        </div>

        {product.coverMedia && (
          // eslint-disable-next-line @next/next/no-img-element -- kapak URL'si medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil
          <img
            src={product.coverMedia.url}
            alt={product.coverMedia.altText ?? ""}
            className="mt-6 w-full rounded-lg object-cover"
          />
        )}

        {gallery.length > 0 && (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {gallery.map((image) => (
              // eslint-disable-next-line @next/next/no-img-element -- galeri URL'si medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil
              <img
                key={image.id}
                src={image.media.url}
                alt={image.media.altText ?? ""}
                className="aspect-square w-full rounded-md object-cover"
                loading="lazy"
              />
            ))}
          </div>
        )}

        <div className="mt-6 text-2xl font-semibold text-foreground">
          {product.discountPriceCents !== null ? (
            <>
              <span className="mr-3 text-base font-normal text-foreground/40 line-through">
                {formatPriceFromCents(product.priceCents, product.currency)}
              </span>
              {formatPriceFromCents(product.discountPriceCents, product.currency)}
            </>
          ) : (
            formatPriceFromCents(product.priceCents, product.currency)
          )}
        </div>

        {product.excerpt && <p className="mt-2 text-sm text-foreground/60">{product.excerpt}</p>}

        <AddToCartButton productId={product.id} stockQuantity={product.stockQuantity} />

        <div className="prose mt-6 max-w-none" dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} />
        {appearance.socialShareEnabled && appearance.socialShareNetworks.length > 0 && (
          <div className="mt-8">
            <SocialShareButtons url={canonicalUrl} title={product.title} networks={appearance.socialShareNetworks} />
          </div>
        )}
      </article>
    </>
  );
}
