import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { AboutPageContent } from "@/lib/about-page";
import { ScrollReveal } from "@/components/site/blocks/scroll-reveal";
import type { RevealDelay } from "@/lib/page-builder/types";
import { Eyebrow } from "./eyebrow";
import { aboutContainerClass } from "./about-buttons";
import { ABOUT_ICONS } from "./about-icons";
import { cn } from "@/lib/utils";

/** `ScrollReveal`'ın `delayMs`'i 100ms'lik kapalı bir kümedir (bkz. `RevealEffectControl`) — ~80ms
 *  hedefine en yakın uyumlu adım bu. 10. karttan sonra (`ABOUT_MAX_TREATMENT_ITEMS=12`) 1000ms'de sabitlenir. */
const REVEAL_DELAYS: readonly RevealDelay[] = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
function revealDelay(index: number): RevealDelay {
  return REVEAL_DELAYS[Math.min(index, REVEAL_DELAYS.length - 1)]!;
}

const cardClass = cn(
  "group relative flex h-full flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-5",
  "transition-all duration-300 hover:-translate-y-1.5 hover:border-transparent hover:shadow-xl",
  "focus-visible:-translate-y-1.5 focus-visible:border-transparent focus-visible:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-accent)] focus-visible:ring-offset-2"
);
/** `--site-primary` → `--site-accent` gradyanı — hover/focus'ta `opacity-0 → 100` ile belirir (sabit HEX yok). */
const gradientOverlayClass =
  "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 [background-image:linear-gradient(135deg,var(--site-primary),var(--site-accent))] group-hover:opacity-100 group-focus-visible:opacity-100";
const iconBoxClass =
  "relative z-10 flex size-11 items-center justify-center rounded-xl bg-[var(--about-accent-tint)] text-primary transition-colors duration-300 group-hover:bg-white/90 group-focus-visible:bg-white/90";
const iconGlyphClass = "size-5 transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110 group-focus-visible:rotate-6 group-focus-visible:scale-110";
const titleClass =
  "relative z-10 text-sm font-semibold leading-snug text-foreground transition-colors duration-300 group-hover:text-white group-focus-visible:text-white sm:text-base";
const arrowClass =
  "absolute right-3 bottom-3 z-10 size-4 translate-x-1 translate-y-1 text-white opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:translate-y-0 group-focus-visible:opacity-100";

/**
 * "Our treatment areas" kutuları — scroll'da sırayla (~stagger) aşağıdan yukarı belirir
 * (`ScrollReveal`, `prefers-reduced-motion` açıkken otomatik kapanır — bkz. `globals.css::.pb-reveal-*`).
 * Hover/focus'ta kutu yükselir, `--site-primary`→`--site-accent` gradyanıyla dolar, başlık beyaza
 * döner, ikon döner/büyür, sağ altta bir ok belirir. Bir kart `specialtyHrefByName`'de (isim bazlı,
 * case-insensitive eşleşme — backend'de ayrı bir `specialtySlug` alanı YOK) karşılık bulursa
 * `/specialties/<slug>`'a giden bir bağlantı olur; bulamazsa sade bir kutu kalır (klavye odağı da
 * yalnızca gerçek bağlantılarda anlamlıdır).
 */
export function TreatmentAreas({
  treatments,
  specialtyHrefByName,
}: {
  treatments: AboutPageContent["treatments"];
  /** Uzmanlık adı (küçük harf, kırpılmış) → o uzmanlığın dil önekli `/specialties/<slug>` bağlantısı. */
  specialtyHrefByName: Record<string, string>;
}) {
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
          {treatments.items.map((item, index) => {
            const Icon = ABOUT_ICONS[item.icon];
            const href = specialtyHrefByName[item.name.trim().toLowerCase()] ?? null;
            const content = (
              <>
                <span aria-hidden="true" className={gradientOverlayClass} />
                <span className={iconBoxClass}>
                  <Icon className={iconGlyphClass} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <h3 className={titleClass}>{item.name}</h3>
                {href && <ArrowRight aria-hidden="true" className={arrowClass} />}
              </>
            );
            return (
              <li key={item.id}>
                <ScrollReveal effect="fade-up" delayMs={revealDelay(index)} style={{ height: "100%" }}>
                  {href ? (
                    <Link href={href} className={cardClass}>
                      {content}
                    </Link>
                  ) : (
                    <div className={cardClass}>{content}</div>
                  )}
                </ScrollReveal>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
