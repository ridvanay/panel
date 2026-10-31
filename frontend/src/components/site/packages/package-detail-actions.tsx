"use client";

import { ContactCta } from "@/components/site/contact/contact-cta";
import { MatcherLaunchButton } from "@/components/site/matcher/matcher-modal";
import { usePackagesStrings } from "@/lib/i18n/use-packages-strings";
import { PackageInquiryForm, focusPackageInquiryForm } from "./package-inquiry-form";

/** Paket X — tam sayfadaki istemci eylemleri: "Find my physician", `ContactCta` (topic = paket adı) ve talep formu. */
export function PackageDetailActions({ slug, title }: { slug: string; title: string }) {
  const t = usePackagesStrings();
  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-4">
        <p className="text-sm font-semibold text-foreground">{t.findPhysicianText}</p>
        <MatcherLaunchButton />
      </div>
      <div className="space-y-3">
        <p className="text-sm font-semibold text-foreground">{t.contactTitle}</p>
        <ContactCta topic={title} onCallback={focusPackageInquiryForm} />
      </div>
      <PackageInquiryForm slug={slug} />
    </div>
  );
}
