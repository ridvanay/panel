import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchPageBySlugServer } from "@/lib/api/server-pages";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { BlockRenderer } from "@/components/site/blocks";
import { ViewTracker } from "@/components/site/view-tracker";
import { ViewCount } from "@/components/site/view-count";
import { buildContentMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/env";
import type { Block } from "@/lib/page-builder/types";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [page, settings] = await Promise.all([fetchPageBySlugServer(slug), fetchSiteSettingsServer()]);
  if (!page) return {};

  // Ana sayfa olarak seçilen sayfa kök URL'de de yayınlanır (bkz. src/app/page.tsx) —
  // mükerrer içerik olmasın diye kanonik URL kök adresi göstermeli (sitemap.ts'teki mantıkla tutarlı).
  const isHomePage = page.id === settings.homePageId;
  const fallbackCanonicalUrl = isHomePage ? SITE_URL : `${SITE_URL}/${slug}`;

  return buildContentMetadata(
    {
      title: page.seoTitle || page.title,
      description: page.seoDescription,
      ogTitle: page.ogTitle,
      ogImageUrl: page.ogImageUrl,
      canonicalUrl: page.canonicalUrl,
      noIndex: page.noIndex,
    },
    { fallbackCanonicalUrl, siteName: settings.siteName, type: "website" },
  );
}

export default async function DynamicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await fetchPageBySlugServer(slug);
  if (!page) notFound();

  return (
    <>
      <ViewTracker kind="page" slug={slug} />
      <div className="mx-auto max-w-3xl px-4 pt-4 sm:px-6">
        <ViewCount count={page.viewCount} />
      </div>
      <BlockRenderer blocks={page.blocks as unknown as Block[]} />
    </>
  );
}
