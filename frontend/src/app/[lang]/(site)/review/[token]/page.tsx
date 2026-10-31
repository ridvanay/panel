import type { Metadata } from "next";
import { ReviewInviteView } from "@/components/site/reviews/review-invite-view";

/**
 * Paket Y — e-postadaki "Deneyiminizi paylaşın" bağlantısı. Token URL'de olduğu için sayfa indekslenmez
 * (`noindex`) ve bağlantı başka sitelere sızmasın diye `referrer` kapatılır.
 */
interface ReviewInvitePageProps {
  params: Promise<{ lang: string; token: string }>;
  searchParams: Promise<{ optout?: string }>;
}

export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function ReviewInvitePage({ params, searchParams }: ReviewInvitePageProps) {
  const { token } = await params;
  const { optout } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <ReviewInviteView token={token} optOut={optout === "1"} />
    </div>
  );
}
