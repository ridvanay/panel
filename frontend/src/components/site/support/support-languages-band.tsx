import Link from "next/link";
import { CalendarCheck, Globe } from "lucide-react";
import { LocaleFlag } from "@/components/site/locale-flag";
import { ContactCta } from "@/components/site/contact/contact-cta";
import { aboutContainerClass } from "@/components/site/about/about-buttons";
import { localeDirection } from "@/lib/i18n/locale-direction";
import type { CommonStrings } from "@/lib/i18n/site-dictionaries";
import type { ResolvedLanguageSupport } from "@/lib/language-support";

interface SupportLanguagesBandProps {
  support: ResolvedLanguageSupport | null;
  dict: Pick<CommonStrings, "supportBandTitle" | "supportBandText" | "supportInterpreterIncluded" | "supportLanguagesLabel" | "supportHoursLabel">;
  /** Paket X — WhatsApp mesajına ve sohbet bağlamına giren ad (site adı); kişisel veri değil. */
  topic?: string;
  /** Paket AJ — "Book a consultation" düğmesi (verilmezse çizilmez). */
  bookHref?: string;
  bookLabel?: string;
}

/**
 * Paket V/AJ — anasayfada hero'nun hemen altındaki "kendi dilinizde destek" bandı. `support` `null` ise
 * (desteklenen dil seçilmemiş) HİÇBİR ŞEY render edilmez. İki dengeli kolon: solda başlık, açıklama ve eşit
 * genişlikte dil çipleri ızgarası; sağda dikey düğmeler (WhatsApp birincil, Live chat, call back, Book a
 * consultation). Dikey ortalı; mobilde tek kolon, düğmeler tam genişlik. Bayraklar dekoratif; dil adları kendi
 * dilinde ve yönünde işaretlenir (`lang`/`dir`).
 */
export function SupportLanguagesBand({ support, dict, topic = "Support", bookHref, bookLabel }: SupportLanguagesBandProps) {
  if (!support) return null;
  return (
    // Hero ile aynı genişlik: aynı kapsayıcı (`aboutContainerClass`); renkli alan o genişlikte bir kutu.
    <section data-testid="support-languages-band" aria-labelledby="support-band-title" className="bg-background pt-6 sm:pt-8">
      <div className={aboutContainerClass}>
        <div
          data-testid="support-languages-band-box"
          className="grid gap-8 rounded-[var(--site-radius)] bg-[var(--site-primary)] px-5 py-8 text-white sm:px-8 lg:grid-cols-2 lg:items-center lg:gap-12 lg:px-10 lg:py-10"
        >
          <div className="min-w-0 space-y-4">
            <h2 id="support-band-title" className="flex items-start gap-3 text-xl font-semibold leading-snug sm:text-2xl">
              <Globe className="mt-1 h-6 w-6 shrink-0" aria-hidden="true" />
              <span>{dict.supportBandTitle}</span>
            </h2>
            <p className="max-w-xl text-sm leading-relaxed text-white/90 sm:text-base">{dict.supportBandText}</p>
            {support.interpreterIncluded && <p className="text-sm font-medium text-white">{dict.supportInterpreterIncluded}</p>}
            <ul aria-label={dict.supportLanguagesLabel} className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {support.languages.map((l) => (
                <li key={l.code} className="flex min-h-10 items-center gap-2 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium">
                  <LocaleFlag code={l.code} />
                  <span lang={l.code} dir={localeDirection(l.code)}>
                    {l.nativeName}
                  </span>
                </li>
              ))}
            </ul>
            {support.hours && (
              <p className="text-sm text-white/85">
                <span className="font-semibold">{dict.supportHoursLabel}:</span> {support.hours}
              </p>
            )}
          </div>
          <div className="w-full max-w-md lg:justify-self-end">
            {/* Paket X — WhatsApp (yalnızca açıksa) / canlı destek / "Sizi arayalım"; kanallar ContactChannelsProvider'dan gelir. */}
            <ContactCta
              topic={topic}
              tone="onPrimary"
              className="flex-col items-stretch"
              trailing={
                bookHref && bookLabel ? (
                  <Link
                    href={bookHref}
                    data-testid="support-band-book"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] border border-white/70 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current motion-reduce:transition-none"
                  >
                    <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                    {bookLabel}
                  </Link>
                ) : null
              }
            />
          </div>
        </div>
      </div>
    </section>
  );
}
