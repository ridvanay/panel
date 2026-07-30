import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchPageBySlugServer } from "@/lib/api/server-pages";
import { BlockRenderer } from "@/components/site/blocks";
import { ViewTracker } from "@/components/site/view-tracker";
import { ViewCount } from "@/components/site/view-count";
import type { Block } from "@/lib/page-builder/types";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await fetchPageBySlugServer(slug);
  if (!page) return {};
  return {
    title: page.seoTitle || page.title,
    description: page.seoDescription ?? undefined,
  };
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
