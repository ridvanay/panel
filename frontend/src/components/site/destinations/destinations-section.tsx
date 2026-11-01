import Link from "next/link";
import { MapPin } from "lucide-react";
import { SafeImage } from "@/components/site/safe-image";
import { MatcherLaunchButton } from "@/components/site/matcher/matcher-modal";
import { DestinationsViewBeacon } from "./destinations-view-beacon";
import { aboutContainerClass } from "@/components/site/about/about-buttons";
import { fetchDestinationsServer, type Destination } from "@/lib/api/server-destinations";
import { formatSiteString, getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import type { DestinationsStrings } from "@/lib/i18n/site-dictionaries/types";
import { withLocalePrefix } from "@/lib/i18n/site-path";

const MAX_TREATMENTS = 3;

export function formatDestinationPrice(price: { from: number; currency: string }, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: price.currency, maximumFractionDigits: 0 }).format(price.from);
  } catch {
    return `${price.currency} ${price.from}`;
  }
}

interface DestinationsViewProps {
  items: Destination[];
  dict: DestinationsStrings;
  lang: string;
  siteName: string;
  packagesHref: string;
}

/** Saf görünüm (test edilebilir). Kayıt yoksa HİÇBİR ŞEY çizilmez. */
export function DestinationsView({ items, dict, lang, siteName, packagesHref }: DestinationsViewProps) {
  if (items.length === 0) return null;
  const periodLabel = items.find((d) => d.dataPeriodLabel)?.dataPeriodLabel ?? null;
  const anyPrice = items.some((d) => d.treatments.slice(0, MAX_TREATMENTS).some((t) => t.price));
  return (
    <section aria-labelledby="home-destinations-title" className="bg-background py-12 sm:py-16" data-testid="home-destinations" data-crm-ignore="">
      <DestinationsViewBeacon />
      <div className={aboutContainerClass}>
        <header className="max-w-2xl">
          <h2 id="home-destinations-title" className="text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
            {dict.sectionTitle}
          </h2>
          <p className="mt-2 text-sm text-foreground/75 sm:text-base">{formatSiteString(dict.sectionIntro, { site: siteName })}</p>
          {periodLabel && (
            <p className="mt-1 text-xs text-foreground/60" data-testid="destinations-period">
              {periodLabel}
            </p>
          )}
        </header>

        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((d) => {
            const treatments = d.treatments.slice(0, MAX_TREATMENTS);
            return (
              <li key={d.id} className="flex flex-col overflow-hidden rounded-[var(--site-radius)] border border-border bg-card" data-testid="destination-card">
                <div className="relative aspect-[16/10] w-full bg-surface-muted">
                  {d.cover ? (
                    <SafeImage
                      src={d.cover.url}
                      alt={d.cover.alt || d.title}
                      fill
                      sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw"
                      className="object-cover"
                    />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-foreground/30" aria-hidden="true">
                      <MapPin className="h-10 w-10" />
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">{d.title}</h3>
                    {d.patientCountLastYear != null && (
                      <p className="mt-0.5 text-xs text-foreground/70" data-testid="destination-patients">
                        {formatSiteString(dict.patientsLastYear, { count: new Intl.NumberFormat(lang).format(d.patientCountLastYear) })}
                      </p>
                    )}
                  </div>
                  {d.summary && <p className="text-sm text-foreground/80">{d.summary}</p>}
                  {treatments.length > 0 && (
                    <ul aria-label={dict.treatmentsLabel} className="space-y-1.5 text-sm">
                      {treatments.map((t, i) => (
                        <li key={`${t.label}-${i}`} className="flex items-baseline justify-between gap-3">
                          <span className="text-foreground">{t.label}</span>
                          {t.price && <span className="shrink-0 font-medium text-[var(--site-primary)]">{formatSiteString(dict.fromPrice, { price: formatDestinationPrice(t.price, lang) })}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {anyPrice && (
          <p className="mt-4 text-xs text-foreground/70" data-testid="destinations-price-note">
            {dict.priceNote}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={packagesHref}
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-primary)] px-4 text-sm font-semibold text-white transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
            data-testid="destinations-explore-packages"
          >
            {dict.explorePackages}
          </Link>
          <MatcherLaunchButton variant="outline" />
        </div>
      </div>
    </section>
  );
}

/**
 * Paket X — anasayfa "Top destinations" (sunucu). Veri kaynaklı: kayıt yoksa (ya da uç hata verirse) bölüm HİÇ görünmez.
 * Site adı sabit yazılmaz; sözlükteki `{site}` yer tutucusuna ayarlardan gelen ad girer.
 */
export async function DestinationsSection({ lang, defaultLocaleCode, siteName }: { lang: string; defaultLocaleCode: string; siteName: string }) {
  const items = await fetchDestinationsServer(lang);
  if (items.length === 0) return null;
  const dict = await getSiteDictionary(lang);
  return <DestinationsView items={items} dict={dict.destinations} lang={lang} siteName={siteName} packagesHref={withLocalePrefix("/packages", lang, defaultLocaleCode)} />;
}
