import type { AboutPageContent } from "@/lib/about-page";
import { Eyebrow } from "./eyebrow";
import { aboutContainerClass } from "./about-buttons";
import { ABOUT_ICONS } from "./about-icons";

export function TreatmentAreas({ treatments }: { treatments: AboutPageContent["treatments"] }) {
  return (
    <section className="bg-card" aria-labelledby="about-treatment-title">
      <div className={`${aboutContainerClass} grid gap-10 py-16 lg:grid-cols-12 lg:gap-12 lg:py-24`}>
        <div className="lg:col-span-5">
          <Eyebrow>{treatments.eyebrow}</Eyebrow>
          <h2 id="about-treatment-title" className="about-serif mt-5 text-3xl leading-tight text-foreground sm:text-4xl">
            {treatments.title}
          </h2>
          <p className="mt-5 text-base leading-relaxed text-[var(--about-body-text)]">{treatments.body}</p>
        </div>

        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:col-span-7 lg:grid-cols-3">
          {treatments.items.map((item) => {
            const Icon = ABOUT_ICONS[item.icon];
            return (
              <li key={item.id} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
                <span className="flex size-11 items-center justify-center rounded-xl bg-[var(--about-accent-tint)] text-primary">
                  <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
                </span>
                <h3 className="text-sm font-semibold leading-snug text-foreground sm:text-base">{item.name}</h3>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
