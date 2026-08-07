import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { fetchPortfolioItemBySlugServer } from "@/lib/api/server-portfolio";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { ViewTracker } from "@/components/site/view-tracker";
import { ViewCount } from "@/components/site/view-count";
import { LinkButton } from "@/components/ui/link-button";
import { buildContentMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/env";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const [item, settings] = await Promise.all([fetchPortfolioItemBySlugServer(slug), fetchSiteSettingsServer()]);
  if (!item) return {};

  return buildContentMetadata(
    {
      title: item.title,
      description: item.summary,
      ogTitle: item.ogTitle,
      ogImageUrl: item.ogImageUrl,
      canonicalUrl: item.canonicalUrl,
      noIndex: item.noIndex,
    },
    {
      fallbackCanonicalUrl: `${SITE_URL}/portfolio/${slug}`,
      siteName: settings.siteName,
      type: "website",
      fallbackImageUrl: item.coverMedia?.url ?? null,
    },
  );
}

export default async function PortfolioDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const item = await fetchPortfolioItemBySlugServer(slug);
  if (!item) notFound();

  const gallery = item.images.length > 0 ? item.images : [];

  return (
    <article className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <ViewTracker kind="portfolio" slug={slug} />

      {item.category && <p className="text-sm font-medium text-primary">{item.category.name}</p>}
      <h1 className="mt-1 text-3xl font-semibold text-foreground">{item.title}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <ViewCount count={item.viewCount} />
        {item.clientName && <span className="text-sm text-foreground/60">Müşteri: {item.clientName}</span>}
        {item.completedAt && (
          <span className="text-sm text-foreground/60">
            Tamamlanma: {new Date(item.completedAt).toLocaleDateString("tr-TR", { dateStyle: "medium" })}
          </span>
        )}
      </div>

      {item.coverMedia && (
        // eslint-disable-next-line @next/next/no-img-element -- kapak URL'si medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil
        <img
          src={item.coverMedia.url}
          alt={item.coverMedia.altText ?? ""}
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

      {item.summary && <p className="mt-6 text-sm text-foreground/60">{item.summary}</p>}

      {item.projectUrl && (
        <LinkButton href={item.projectUrl} target="_blank" rel="noopener noreferrer" className="mt-6">
          Projeyi Görüntüle
          <ExternalLink className="h-4 w-4" />
        </LinkButton>
      )}

      <div className="prose mt-6 max-w-none" dangerouslySetInnerHTML={{ __html: item.contentHtml }} />
    </article>
  );
}
