import { Check, X } from "lucide-react";
import type { RequestStrings } from "@/lib/i18n/site-dictionaries/en/request";
import { Eyebrow } from "./eyebrow";
import { aboutContainerClass } from "./about-buttons";

/** Paket AH — Hakkımızda "Who we are" bölümü; üst şerit bağlantısı `#authorized-facilities` çapasına gelir. */
export const ABOUT_AUTHORIZED_FACILITIES_ANCHOR = "authorized-facilities";

export function WhoWeAre({ t }: { t: RequestStrings }) {
  return (
    <section id={ABOUT_AUTHORIZED_FACILITIES_ANCHOR} className="scroll-mt-24 bg-card" aria-labelledby="about-who-title" data-testid="about-who-we-are">
      <div className={`${aboutContainerClass} py-16 lg:py-24`}>
        <Eyebrow>{t.aboutWhoTitle}</Eyebrow>
        <h2 id="about-who-title" className="about-serif mt-5 max-w-3xl text-3xl leading-tight text-foreground sm:text-4xl">
          {t.aboutWhoTitle}
        </h2>
        <div className="mt-6 max-w-3xl space-y-4 text-base leading-relaxed text-[var(--about-body-text)] sm:text-lg">
          <p>{t.aboutWhoText1}</p>
          <p className="font-medium text-foreground">{t.aboutWhoText2}</p>
        </div>
      </div>
    </section>
  );
}

/** Paket AH — "Our role / What we do not do": tanı ve tedavi yapılmaz; tıbbi kararları sağlık kuruluşundaki hekim verir. */
export function OurRole({ t }: { t: RequestStrings }) {
  const does = [t.aboutDo1, t.aboutDo2, t.aboutDo3, t.aboutDo4];
  const doesNot = [t.aboutDont1, t.aboutDont2, t.aboutDont3];
  return (
    <section className="bg-background" aria-labelledby="about-role-title" data-testid="about-our-role">
      <div className={`${aboutContainerClass} py-16 lg:py-24`}>
        <Eyebrow>{t.aboutRoleTitle}</Eyebrow>
        <h2 id="about-role-title" className="about-serif mt-5 max-w-3xl text-3xl leading-tight text-foreground sm:text-4xl">
          {t.aboutRoleTitle}
        </h2>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-[var(--about-body-text)] sm:text-lg">{t.aboutRoleText}</p>
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:gap-6">
          <div className="rounded-[24px] border border-border bg-card p-6 sm:p-8">
            <h3 className="text-lg font-semibold text-foreground">{t.aboutDoTitle}</h3>
            <ul className="mt-4 space-y-3">
              {does.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[var(--about-body-text)]">
                  <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[24px] border border-border bg-card p-6 sm:p-8">
            <h3 className="text-lg font-semibold text-foreground">{t.aboutDontTitle}</h3>
            <ul className="mt-4 space-y-3">
              {doesNot.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[var(--about-body-text)]">
                  <X className="mt-1 size-4 shrink-0 text-foreground/60" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
