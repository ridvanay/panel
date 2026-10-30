import { ExternalLink } from "lucide-react";
import { AccreditationLogo } from "@/components/site/accreditations/accreditation-logo";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { CommonStrings } from "@/lib/i18n/site-dictionaries";
import type { PublicAccreditation } from "@/lib/api/types";

type ListStrings = Pick<
  CommonStrings,
  "accreditationListTitle" | "accreditationCertificateNo" | "accreditationVerify" | "accreditationVerifyAria" | "accreditationIssuer" | "accreditationValidUntil"
>;

/**
 * Paket V — Hakkımızda sayfasındaki ayrıntılı liste: logo, ad, veren kurum, belge numarası, geçerlilik
 * ve "Doğrula" (resmi doğrulama sayfası, yeni sekmede). Liste boşsa render edilmez.
 */
export function AccreditationList({ badges, dict, intlLocale }: { badges: PublicAccreditation[]; dict: ListStrings; intlLocale: string }) {
  if (badges.length === 0) return null;
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(intlLocale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  return (
    <section id="accreditations" data-testid="accreditation-list" aria-labelledby="accreditation-list-title" className="bg-background">
      <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <h2 id="accreditation-list-title" className="font-heading text-2xl font-semibold text-foreground">
          {dict.accreditationListTitle}
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {badges.map((b) => (
            <li key={b.id} className="flex gap-4 rounded-[var(--site-radius)] border border-border bg-surface p-4">
              <div className="flex h-14 w-20 shrink-0 items-center justify-center">
                <AccreditationLogo badge={b} className="max-h-14 max-w-20" />
              </div>
              <div className="min-w-0 space-y-1 text-sm">
                <p className="font-semibold text-foreground">{b.name}</p>
                {b.description && <p className="text-foreground/70">{b.description}</p>}
                <p className="text-foreground/70">{formatSiteString(dict.accreditationIssuer, { issuer: b.issuer })}</p>
                <p className="text-foreground/70">{formatSiteString(dict.accreditationCertificateNo, { number: b.certificateNo })}</p>
                {b.validUntil && <p className="text-foreground/60">{formatSiteString(dict.accreditationValidUntil, { date: formatDate(b.validUntil) })}</p>}
                {b.verificationUrl && /^https:\/\//i.test(b.verificationUrl) && (
                  <a
                    href={b.verificationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={formatSiteString(dict.accreditationVerifyAria, { name: b.name })}
                    className="inline-flex min-h-11 items-center gap-1 font-semibold text-[var(--site-link,var(--site-primary))] hover:underline"
                  >
                    {dict.accreditationVerify}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
