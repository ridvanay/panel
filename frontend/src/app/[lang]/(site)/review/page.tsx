import type { Metadata } from "next";
import { ReviewInvitePage as ReviewInviteGate } from "@/components/site/reviews/review-invite-view";

/**
 * Paket AP — e-postadaki "Deneyiminizi paylaşın" bağlantısı: `/{lang}/review#<token>` (token `#` parçasında,
 * sunucuya gitmez; eski `/{lang}/review/<token>` geçiş süresince `[token]/page.tsx`). Sayfa indekslenmez ve
 * `referrer` kapatılır.
 */
interface ReviewInvitePageProps {
  searchParams: Promise<{ optout?: string }>;
}

export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function ReviewInvitePage({ searchParams }: ReviewInvitePageProps) {
  const { optout } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <ReviewInviteGate optOut={optout === "1"} />
    </div>
  );
}
