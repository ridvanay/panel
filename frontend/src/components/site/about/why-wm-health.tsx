import type { AboutPageContent } from "@/lib/about-page";
import { Eyebrow } from "./eyebrow";
import { aboutContainerClass } from "./about-buttons";
import { ABOUT_ICONS } from "./about-icons";

/** Numaralar (01, 02, …) madde sırasından otomatik üretilir — admin'de ayrı bir alan YOK. */
export function WhyWmHealth({ approach }: { approach: AboutPageContent["approach"] }) {
  return (
    <section className="bg-background" aria-labelledby="about-approach-title">
      <div className={`${aboutContainerClass} py-16 lg:py-24`}>
        <div className="text-center">
          <Eyebrow align="center">{approach.eyebrow}</Eyebrow>
          <h2 id="about-approach-title" className="about-serif mt-5 text-3xl leading-tight text-foreground sm:text-4xl">
            {approach.title}
          </h2>
        </div>

        <ol className="mt-12 grid gap-5 md:grid-cols-3 lg:gap-6">
          {approach.items.map((item, index) => {
            const Icon = ABOUT_ICONS[item.icon];
            return (
              <li key={item.id} className="relative overflow-hidden rounded-[24px] border border-border bg-card p-6 sm:p-8">
                <span className="absolute inset-x-0 top-0 h-1 bg-[var(--about-accent)]" aria-hidden="true" />
                <div className="flex items-start justify-between gap-4">
                  <span className="flex size-12 items-center justify-center rounded-xl bg-[var(--about-accent-tint)] text-primary">
                    <Icon className="size-6" strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <span className="about-serif text-5xl leading-none text-primary" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-6 text-lg font-semibold text-foreground">{item.title}</h3>
                {item.body && <p className="mt-2 leading-relaxed text-[var(--about-body-text)]">{item.body}</p>}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
