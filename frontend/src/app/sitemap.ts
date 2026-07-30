import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/env";
import { fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { fetchBlogPostsServer } from "@/lib/api/server-blog";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [pages, posts, settings] = await Promise.all([
    fetchPublishedPagesServer(),
    fetchBlogPostsServer(),
    fetchSiteSettingsServer(),
  ]);

  const homePage = pages.find((page) => page.id === settings.homePageId);

  const entries: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: homePage?.updatedAt, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/blog`, changeFrequency: "daily", priority: 0.8 },
  ];

  for (const page of pages) {
    // Ana sayfa olarak seçilen sayfa kök URL'de zaten temsil ediliyor — mükerrer girdi olmasın.
    if (page.id === settings.homePageId) continue;
    entries.push({ url: `${SITE_URL}/${page.slug}`, lastModified: page.updatedAt, changeFrequency: "weekly", priority: 0.7 });
  }

  for (const post of posts) {
    entries.push({ url: `${SITE_URL}/blog/${post.slug}`, lastModified: post.updatedAt, changeFrequency: "monthly", priority: 0.6 });
  }

  return entries;
}
