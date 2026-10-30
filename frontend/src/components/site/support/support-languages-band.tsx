import { Globe } from "lucide-react";
import { LocaleFlag } from "@/components/site/locale-flag";
import { ContactActions } from "@/components/site/contact-actions";
import { aboutContainerClass } from "@/components/site/about/about-buttons";
import { localeDirection } from "@/lib/i18n/locale-direction";
import type { CommonStrings } from "@/lib/i18n/site-dictionaries";
import type { ResolvedLanguageSupport } from "@/lib/language-support";

interface SupportLanguagesBandProps {
  support: ResolvedLanguageSupport | null;
  dict: Pick<CommonStrings, "supportBandTitle" | "supportInterpreterIncluded" | "supportLanguagesLabel" | "supportHoursLabel" | "liveChatCta" | "contactUsCta" | "talkToUsCta">;
  chatEnabled: boolean;
  contactHref: string;
}

/**
 * Paket V — anasayfada hero'nun hemen altındaki "kendi dilinizde destek" bandı. `support` `null` ise
 * (desteklenen dil seçilmemiş) HİÇBİR ŞEY render edilmez. Bayraklar dekoratif; dil adları kendi
 * dilinde ve yönünde işaretlenir (`lang`/`dir`).
 */
export function SupportLanguagesBand({ support, dict, chatEnabled, contactHref }: SupportLanguagesBandProps) {
  if (!support) return null;
  return (
    // Hero ile aynı genişlik: aynı kapsayıcı (`aboutContainerClass`); renkli alan o genişlikte bir kutu.
    <section data-testid="support-languages-band" aria-labelledby="support-band-title" className="bg-background pt-6 sm:pt-8">
      <div className={aboutContainerClass}>
        <div
          data-testid="support-languages-band-box"
          className="flex flex-col gap-5 rounded-[var(--site-radius)] bg-[var(--site-primary)] px-5 py-6 text-white sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8 lg:px-8"
        >
          <div className="min-w-0 space-y-3">
            <h2 id="support-band-title" className="flex items-start gap-2 text-base font-semibold leading-snug sm:text-lg">
              <Globe className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <span>{dict.supportBandTitle}</span>
            </h2>
            {support.interpreterIncluded && <p className="text-sm text-white/90">{dict.supportInterpreterIncluded}</p>}
            <ul aria-label={dict.supportLanguagesLabel} className="flex flex-wrap gap-x-3 gap-y-2">
              {support.languages.map((l) => (
                <li key={l.code} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium">
                  <LocaleFlag code={l.code} />
                  <span lang={l.code} dir={localeDirection(l.code)}>
                    {l.nativeName}
                  </span>
                </li>
              ))}
            </ul>
            {support.hours && (
              <p className="text-xs text-white/85">
                <span className="font-semibold">{dict.supportHoursLabel}:</span> {support.hours}
              </p>
            )}
          </div>
          <div className="shrink-0">
            <ContactActions tone="onPrimary" chatEnabled={chatEnabled} contactHref={contactHref} chatLabel={dict.liveChatCta} contactLabel={dict.talkToUsCta} />
          </div>
        </div>
      </div>
    </section>
  );
}
