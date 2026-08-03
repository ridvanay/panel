import type { Metadata } from "next";
import { fetchHomepageServer, fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { BlockRenderer } from "@/components/site/blocks";
import { ViewTracker } from "@/components/site/view-tracker";
import { FallbackHome } from "@/components/marketing/fallback-home";
import { buildContentMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/env";
import type { Block } from "@/lib/page-builder/types";

export async function generateMetadata(): Promise<Metadata> {
  const [homePage, settings] = await Promise.all([fetchHomepageServer(), fetchSiteSettingsServer()]);
  if (!homePage) return {};

  return buildContentMetadata(
    {
      title: homePage.seoTitle || homePage.title,
      description: homePage.seoDescription,
      ogTitle: homePage.ogTitle,
      ogImageUrl: homePage.ogImageUrl,
      canonicalUrl: homePage.canonicalUrl,
      noIndex: homePage.noIndex,
    },
    // Kök `/` rotası her zaman kanonik olarak site kökünü gösterir (bkz. sitemap.ts).
    { fallbackCanonicalUrl: SITE_URL, siteName: settings.siteName, type: "website" },
  );
}

export default async function RootPage() {
  const homePage = await fetchHomepageServer();
  if (!homePage) {
    return <FallbackHome />;
  }

  const [settings, pages] = await Promise.all([fetchSiteSettingsServer(), fetchPublishedPagesServer()]);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader settings={settings} pages={pages} />
      <main className="flex-1">
        <ViewTracker kind="page" slug={homePage.slug} />
        <BlockRenderer blocks={homePage.blocks as unknown as Block[]} />
      </main>
      <SiteFooter siteName={settings.siteName} />
    </div>
  );
}
