import { ClipboardCheck, Globe, Stethoscope, type LucideIcon } from "lucide-react";
import type { AboutStrings } from "@/lib/i18n/site-dictionaries";
import { Eyebrow } from "./eyebrow";
import { aboutContainerClass } from "./about-buttons";

const APPROACH_ITEMS: { number: string; icon: LucideIcon; titleKey: keyof AboutStrings; bodyKey: keyof AboutStrings }[] = [
  { number: "01", icon: Stethoscope, titleKey: "approach1Title", bodyKey: "approach1Body" },
  { number: "02", icon: ClipboardCheck, titleKey: "approach2Title", bodyKey: "approach2Body" },
  { number: "03", icon: Globe, titleKey: "approach3Title", bodyKey: "approach3Body" },
];

export function WhyWmHealth({ dict }: { dict: AboutStrings }) {
  return (
    <section className="bg-background" aria-labelledby="about-approach-title">
      <div className={`${aboutContainerClass} py-16 lg:py-24`}>
        <div className="text-center">
          <Eyebrow align="center">{dict.approachEyebrow}</Eyebrow>
          <h2 id="about-approach-title" className="about-serif mt-5 text-3xl leading-tight text-foreground sm:text-4xl">
            {dict.approachTitle}
          </h2>
        </div>

        <ul className="mt-12 grid gap-5 md:grid-cols-3 lg:gap-6">
          {APPROACH_ITEMS.map(({ number, icon: Icon, titleKey, bodyKey }) => (
            <li key={number} className="relative overflow-hidden rounded-[24px] border border-border bg-card p-6 sm:p-8">
              <span className="absolute inset-x-0 top-0 h-1 bg-[var(--about-accent)]" aria-hidden="true" />
              <div className="flex items-start justify-between gap-4">
                <span className="flex size-12 items-center justify-center rounded-xl bg-[var(--about-accent-tint)] text-primary">
                  <Icon className="size-6" strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="about-serif text-5xl leading-none text-primary" aria-hidden="true">
                  {number}
                </span>
              </div>
              <h3 className="mt-6 text-lg font-semibold text-foreground">{dict[titleKey]}</h3>
              <p className="mt-2 leading-relaxed text-[var(--about-body-text)]">{dict[bodyKey]}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
