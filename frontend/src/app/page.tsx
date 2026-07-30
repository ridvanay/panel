import type { Metadata } from "next";
import { fetchHomepageServer, fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { BlockRenderer } from "@/components/site/blocks";
import { ViewTracker } from "@/components/site/view-tracker";
import { FallbackHome } from "@/components/marketing/fallback-home";
import type { Block } from "@/lib/page-builder/types";

export async function generateMetadata(): Promise<Metadata> {
  const homePage = await fetchHomepageServer();
  if (!homePage) return {};

  const title = homePage.seoTitle || homePage.title;
  const description = homePage.seoDescription ?? undefined;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
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
