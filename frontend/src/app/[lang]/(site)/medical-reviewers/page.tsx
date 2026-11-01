import type { Metadata } from "next";
import { MedicalReviewersPage } from "@/components/site/trust/medical-reviewers-page";
import { buildTrustMetadata } from "@/lib/blog/trust-pages";

/** Paket Z1-ek - bkz. `content-standards/page.tsx` (statik klasor `[slug]` CMS rotasinin onune gecer). */
type PageProps = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params;
  return buildTrustMetadata(lang, "medical-reviewers");
}

export default async function MedicalReviewersRoute({ params }: PageProps) {
  const { lang } = await params;
  return <MedicalReviewersPage lang={lang} />;
}
