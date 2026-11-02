import { Mail, Phone } from "lucide-react";
import { WhatsappIcon } from "@/components/site/contact/contact-cta";
import { IntermediaryNotice } from "@/components/site/intermediary-notice";
import type { IntermediaryStrings } from "@/lib/i18n/site-dictionaries/types";
import type { RequestStrings } from "@/lib/i18n/site-dictionaries/en/request";
import { RequestNextSteps } from "./request-next-steps";

const contactLink =
  "flex min-h-11 items-center gap-3 rounded-[var(--site-radius)] border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors duration-300 motion-reduce:transition-none hover:border-[var(--site-primary)]/50 hover:text-[var(--site-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]";

/**
 * Paket AJ — talep sayfasının yapışkan sağ paneli: "What happens next", koordinatör iletişimi (yalnızca ayarlarda
 * tanımlı kanallar; hiçbiri yoksa blok gizlenir), aracı kuruluş bilgi kutusu (+ belge satırı).
 */
export function RequestSidePanel({
  strings: t,
  intermediary,
  certificateNo,
  whatsappHref,
  phone,
  email,
}: {
  strings: RequestStrings;
  intermediary: IntermediaryStrings;
  certificateNo?: string | null;
  whatsappHref: string | null;
  phone: string | null;
  email: string | null;
}) {
  const telHref = phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null;
  const hasContact = Boolean(whatsappHref || telHref || email);
  return (
    <aside aria-label={t.nextTitle} className="space-y-5 lg:sticky lg:top-28" data-testid="request-side-panel">
      <div className="rounded-xl border border-border bg-surface p-5">
        <RequestNextSteps strings={t} />
      </div>
      {hasContact && (
        <div className="rounded-xl border border-border bg-surface p-5" data-testid="request-contact-panel">
          <h2 className="font-heading text-lg font-semibold text-foreground">{t.contactTitle}</h2>
          <ul className="mt-3 space-y-2">
            {whatsappHref && (
              <li>
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={contactLink}>
                  <WhatsappIcon className="size-5 shrink-0 text-[var(--site-primary)]" />
                  {t.contactWhatsapp}
                </a>
              </li>
            )}
            {telHref && phone && (
              <li>
                <a href={telHref} className={contactLink}>
                  <Phone className="size-5 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
                  <span>
                    {t.contactPhone}: <span dir="ltr">{phone}</span>
                  </span>
                </a>
              </li>
            )}
            {email && (
              <li>
                <a href={`mailto:${email}`} className={contactLink}>
                  <Mail className="size-5 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
                  <span className="min-w-0 break-all">
                    {t.contactEmail}: <span dir="ltr">{email}</span>
                  </span>
                </a>
              </li>
            )}
          </ul>
        </div>
      )}
      <IntermediaryNotice strings={intermediary} certificateNo={certificateNo} />
    </aside>
  );
}
