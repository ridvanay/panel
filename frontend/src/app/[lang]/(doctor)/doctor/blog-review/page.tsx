import type { Metadata } from "next";
import { DoctorPortalShell } from "@/components/site/telehealth/doctor-portal-shell";
import { DoctorBlogReviewPanel } from "@/components/site/telehealth/doctor-blog-review-panel";

/** Paket Z1 — `/{lang}/doctor/blog-review`: atanan blog yazılarının tıbbi incelemesi. `noindex` (`/doctor/**` ile aynı). */
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default function DoctorBlogReviewPage() {
  return (
    <DoctorPortalShell>
      <DoctorBlogReviewPanel />
    </DoctorPortalShell>
  );
}
