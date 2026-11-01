import type { Metadata } from "next";
import { ContentStandardsPage } from "@/components/site/trust/content-standards-page";
import { buildTrustMetadata } from "@/lib/blog/trust-pages";

/**
 * Paket Z1-ek - statik klasor oldugu icin dinamik `[slug]` CMS rotasindan ONCELIKLIDIR; ayni slug'li CMS
 * `Page` kaydi (varsa) artik gosterilmez. Metin site sozlugunden (9 dil) gelir.
 */
type PageProps = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params;
  return buildTrustMetadata(lang, "content-standards");
}

export default async function ContentStandardsRoute({ params }: PageProps) {
  const { lang } = await params;
  return <ContentStandardsPage lang={lang} />;
}
