import Link from "next/link";
import type { AboutPageContent } from "@/lib/about-page";
import { aboutButtonClass, aboutContainerClass } from "./about-buttons";

/** Primary zeminli kapanış bandı — başlık altında açıklama paragrafı BİLİNÇLİ olarak YOK. */
export function ClosingBand({
  closing,
  primaryHref,
  secondaryHref,
}: {
  closing: AboutPageContent["closing"];
  primaryHref: string;
  secondaryHref: string;
}) {
  return (
    <section className="bg-primary text-primary-foreground" aria-labelledby="about-closing-title">
      <div className={`${aboutContainerClass} flex flex-col items-center py-16 text-center lg:py-20`}>
        <span className="h-1 w-12 rounded-full bg-[var(--about-accent)]" aria-hidden="true" />
        <h2 id="about-closing-title" className="about-serif mt-6 text-3xl leading-tight sm:text-4xl">
          {closing.title}
        </h2>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href={primaryHref} className={aboutButtonClass.onPrimarySolid}>
            {closing.primaryCta.label}
          </Link>
          <Link href={secondaryHref} className={aboutButtonClass.onPrimaryOutline}>
            {closing.secondaryCta.label}
          </Link>
        </div>
      </div>
    </section>
  );
}
