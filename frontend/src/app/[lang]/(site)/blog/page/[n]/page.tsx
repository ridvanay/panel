import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { BlogIndexPage, buildBlogIndexMetadata, type BlogSearchParams } from "@/components/site/blog/blog-index-page";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { blogListPath, cleanQuery, cleanTopic, firstParam } from "@/lib/blog/topics";

/**
 * Paket Z1 — `/[lang]/blog/page/[n]`. `n` pozitif tam sayı olmalıdır (aksi 404). `n = 1` kopya içerik üretmesin diye
 * kalıcı olarak `/[lang]/blog`'a (sorgu korunarak) yönlenir. Aralık dışı sayfa 404'tür (`BlogIndexPage`).
 */
type PageProps = {
  params: Promise<{ lang: string; n: string }>;
  searchParams: Promise<BlogSearchParams>;
};

function parsePage(raw: string): number | null {
  if (!/^[1-9]\d{0,3}$/.test(raw)) return null;
  return Number(raw);
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { lang, n } = await params;
  const page = parsePage(n);
  if (page === null || page === 1) return {};
  return buildBlogIndexMetadata({ lang, page, searchParams: await searchParams });
}

export default async function BlogPageRoute({ params, searchParams }: PageProps) {
  const { lang, n } = await params;
  const page = parsePage(n);
  if (page === null) notFound();
  const sp = await searchParams;
  if (page === 1) {
    const locales = await fetchLocalesServer();
    const defaultLocale = locales.find((l) => l.isDefault)?.code ?? lang;
    permanentRedirect(withLocalePrefix(blogListPath({ topic: cleanTopic(firstParam(sp.topic)), q: cleanQuery(firstParam(sp.q)) }), lang, defaultLocale));
  }
  return <BlogIndexPage lang={lang} page={page} searchParams={sp} />;
}
