import Link from "next/link";
import type { AboutStrings } from "@/lib/i18n/site-dictionaries";
import { aboutButtonClass, aboutContainerClass } from "./about-buttons";

/** Primary zeminli kapanış bandı — başlık altında açıklama paragrafı BİLİNÇLİ olarak YOK. */
export function ClosingBand({ dict, bookHref, contactHref }: { dict: AboutStrings; bookHref: string; contactHref: string }) {
  return (
    <section className="bg-primary text-primary-foreground" aria-labelledby="about-closing-title">
      <div className={`${aboutContainerClass} flex flex-col items-center py-16 text-center lg:py-20`}>
        <span className="h-1 w-12 rounded-full bg-[var(--about-accent)]" aria-hidden="true" />
        <h2 id="about-closing-title" className="about-serif mt-6 text-3xl leading-tight sm:text-4xl">
          {dict.closingTitle}
        </h2>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href={bookHref} className={aboutButtonClass.onPrimarySolid}>
            {dict.bookConsultationCta}
          </Link>
          <Link href={contactHref} className={aboutButtonClass.onPrimaryOutline}>
            {dict.contactCta}
          </Link>
        </div>
      </div>
    </section>
  );
}
