import { ShieldCheck } from "lucide-react";
import { AccreditationLogo } from "@/components/site/accreditations/accreditation-logo";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { CommonStrings } from "@/lib/i18n/site-dictionaries";
import type { PublicAccreditation } from "@/lib/api/types";

/**
 * Paket V — anasayfadaki "Licensed & accredited" şeridi. Liste boşsa render edilmez. Her logonun
 * altında belge numarası; ayrıntı ve "Doğrula" bağlantısı Hakkımızda sayfasındadır (`detailsHref`).
 */
export function AccreditationStrip({
  badges,
  dict,
  detailsHref,
}: {
  badges: PublicAccreditation[];
  dict: Pick<CommonStrings, "accreditationStripTitle" | "accreditationCertificateNo" | "accreditationListTitle">;
  detailsHref: string;
}) {
  if (badges.length === 0) return null;
  return (
    <section data-testid="accreditation-strip" aria-labelledby="accreditation-strip-title" className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-6 sm:px-6 md:flex-row md:gap-8">
        <h2 id="accreditation-strip-title" className="flex shrink-0 items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground/70">
          <ShieldCheck className="h-4 w-4 text-[var(--site-primary)]" aria-hidden="true" />
          <a href={detailsHref} className="hover:underline">
            {dict.accreditationStripTitle}
          </a>
        </h2>
        <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 md:justify-start">
          {badges.map((b) => (
            <li key={b.id} className="flex flex-col items-center gap-1 text-center">
              <AccreditationLogo badge={b} className="h-10 max-w-[9rem]" />
              <span className="text-[11px] text-foreground/60">{formatSiteString(dict.accreditationCertificateNo, { number: b.certificateNo })}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
