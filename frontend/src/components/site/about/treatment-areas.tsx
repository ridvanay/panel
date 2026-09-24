import { Baby, Ribbon, Scale, Scissors, Smile, Sparkles, type LucideIcon } from "lucide-react";
import type { AboutStrings } from "@/lib/i18n/site-dictionaries";
import { Eyebrow } from "./eyebrow";
import { aboutContainerClass } from "./about-buttons";

/** lucide'de diş ikonu olmadığı için "Dental care" → `Smile`. */
const TREATMENT_AREAS: { key: keyof AboutStrings; icon: LucideIcon }[] = [
  { key: "treatmentObesity", icon: Scale },
  { key: "treatmentOncology", icon: Ribbon },
  { key: "treatmentIvf", icon: Baby },
  { key: "treatmentDental", icon: Smile },
  { key: "treatmentHair", icon: Scissors },
  { key: "treatmentPlastic", icon: Sparkles },
];

export function TreatmentAreas({ dict }: { dict: AboutStrings }) {
  return (
    <section className="bg-card" aria-labelledby="about-treatment-title">
      <div className={`${aboutContainerClass} grid gap-10 py-16 lg:grid-cols-12 lg:gap-12 lg:py-24`}>
        <div className="lg:col-span-5">
          <Eyebrow>{dict.treatmentEyebrow}</Eyebrow>
          <h2 id="about-treatment-title" className="about-serif mt-5 text-3xl leading-tight text-foreground sm:text-4xl">
            {dict.treatmentTitle}
          </h2>
          <p className="mt-5 text-base leading-relaxed text-[var(--about-body-text)]">{dict.treatmentBody}</p>
        </div>

        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:col-span-7 lg:grid-cols-3">
          {TREATMENT_AREAS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
              <span className="flex size-11 items-center justify-center rounded-xl bg-[var(--about-accent-tint)] text-primary">
                <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <h3 className="text-sm font-semibold leading-snug text-foreground sm:text-base">{dict[key]}</h3>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
