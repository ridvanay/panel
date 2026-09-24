import Image from "next/image";
import Link from "next/link";
import { ArrowDown, MapPin } from "lucide-react";
import type { AboutStrings } from "@/lib/i18n/site-dictionaries";
import { Eyebrow } from "./eyebrow";
import { aboutButtonClass, aboutContainerClass } from "./about-buttons";

interface AboutHeroProps {
  dict: AboutStrings;
  homeLabel: string;
  homeHref: string;
  bookHref: string;
  /** `false` iken (doktor bölümü gizliyse) "#doctors" bağlantısı render edilmez — ölü çapa olmasın. */
  showMeetDoctorsLink: boolean;
  /** Fotoğraf eklendiğinde verilir; verilmezse nötr yer tutucu gösterilir. */
  imageSrc?: string;
  imageAlt?: string;
}

export function AboutHero({ dict, homeLabel, homeHref, bookHref, showMeetDoctorsLink, imageSrc, imageAlt = "" }: AboutHeroProps) {
  return (
    <section className="bg-background">
      <div className={`${aboutContainerClass} pt-8 pb-16 sm:pt-10 lg:pb-24`}>
        <nav aria-label="Breadcrumb" className="text-sm text-[var(--about-muted-text)]">
          <ol className="flex items-center gap-2">
            <li>
              <Link href={homeHref} className="inline-flex min-h-11 items-center hover:text-foreground hover:underline">
                {homeLabel}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="font-medium text-foreground">
              {dict.breadcrumbCurrent}
            </li>
          </ol>
        </nav>

        <div className="mt-6 grid items-center gap-10 lg:mt-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <Eyebrow>{dict.heroEyebrow}</Eyebrow>
            <h1 className="about-serif mt-5 text-4xl leading-[1.1] tracking-tight text-foreground sm:text-5xl lg:text-[56px]">
              {dict.heroTitle}
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-[var(--about-body-text)] sm:text-lg">{dict.heroBody}</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link href={bookHref} className={aboutButtonClass.primary}>
                {dict.bookConsultationCta}
              </Link>
              {showMeetDoctorsLink && (
                <a
                  href="#doctors"
                  className="inline-flex min-h-11 items-center gap-2 text-base font-semibold text-primary underline-offset-4 hover:underline"
                >
                  {dict.meetDoctorsCta}
                  <ArrowDown className="size-4" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>

          <div className="relative">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[28px] bg-[var(--about-accent-tint)] sm:aspect-[5/4]">
              {imageSrc ? (
                <Image src={imageSrc} alt={imageAlt} fill priority sizes="(min-width: 1024px) 600px, 100vw" className="object-cover" />
              ) : (
                // Nötr yer tutucu — fotoğraf eklenene kadar. Dekoratif, ekran okuyucudan gizli.
                <div
                  className="absolute inset-0 bg-[linear-gradient(135deg,var(--about-accent-tint),color-mix(in_oklch,var(--site-primary)_14%,var(--site-surface)))]"
                  aria-hidden="true"
                />
              )}
            </div>

            <div className="absolute bottom-4 left-4 right-4 flex max-w-xs items-center gap-3 rounded-2xl bg-card p-4 shadow-lg shadow-foreground/10 sm:bottom-6 sm:left-6 sm:right-auto">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--about-accent-tint)] text-primary">
                <MapPin className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="font-bold text-foreground">{dict.locationTitle}</p>
                <p className="text-sm text-[var(--about-muted-text)]">{dict.locationSubtitle}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
