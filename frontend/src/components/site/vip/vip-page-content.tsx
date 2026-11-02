import Link from "next/link";
import {
  ArrowRight,
  BedDouble,
  Building2,
  Car,
  Headset,
  HeartPulse,
  KeyRound,
  MapPinned,
  Plane,
  PlaneLanding,
  PlaneTakeoff,
  Sofa,
  Users,
  type LucideIcon,
} from "lucide-react";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { IntermediaryStrings, VipStrings } from "@/lib/i18n/site-dictionaries/types";
import type { VipImage } from "@/lib/vip-images";
import { IntermediaryNotice } from "@/components/site/intermediary-notice";

/**
 * Paket AJ (AJ-3) — VIP Accommodation & Transfer. Tema token'ları (`--site-primary`, `--site-accent`) ile boyanır,
 * tema dışı renk yok. Fiyat/garanti/abartı YOK. `--site-accent` açık bir ton olabileceği için yalnızca süs
 * (zemin tonu) olarak kullanılır, metin rengi olarak asla. Hareket `motion-reduce` ile kapanır.
 */

type Hrefs = { request: string; find: string };

const ring =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)] motion-reduce:transition-none";
const primaryButton = `inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] bg-[var(--site-button)] px-5 text-sm font-semibold text-[var(--site-button-text)] shadow-sm transition-all duration-300 hover:opacity-90 ${ring}`;
const secondaryButton = `inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] border border-[var(--site-primary)] bg-transparent px-5 text-sm font-semibold text-[var(--site-primary)] transition-all duration-300 hover:bg-[var(--site-primary)]/5 ${ring}`;

/** Talep formuna hizmet notu olarak `topic` parametresi eklenir (form henüz okumuyorsa yok sayılır). */
export function vipRequestHref(base: string, topic: string): string {
  return `${base}${base.includes("?") ? "&" : "?"}topic=${topic}`;
}

function ImageSlot({ image, icon: Icon }: { image: VipImage | undefined; icon: LucideIcon }) {
  return (
    <div
      className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--site-primary)]/10"
      data-testid={image ? "vip-image" : "vip-image-placeholder"}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- admin'den yüklenen görsel; sabit oran + object-cover
        <img src={image.url} alt={image.alt} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--site-primary)]/10 via-transparent to-[var(--site-accent)]/20"
        >
          <span className="flex size-16 items-center justify-center rounded-full bg-[var(--site-background)] text-[var(--site-primary)] shadow-sm">
            <Icon className="size-8" strokeWidth={1.75} />
          </span>
        </div>
      )}
    </div>
  );
}

export function VipPageContent({
  strings: t,
  intermediary,
  certificateNo,
  images,
  hrefs,
}: {
  strings: VipStrings;
  intermediary: IntermediaryStrings;
  certificateNo: string | null | undefined;
  images: VipImage[];
  hrefs: Hrefs;
}) {
  const sections: { key: string; topic: string; icon: LucideIcon; title: string; text: string }[] = [
    { key: "transfer", topic: "vip-transfer", icon: Plane, title: t.transferTitle, text: t.transferText },
    { key: "stay", topic: "vip-accommodation", icon: BedDouble, title: t.stayTitle, text: t.stayText },
    { key: "coordinator", topic: "vip-coordinator", icon: Headset, title: t.coordinatorTitle, text: t.coordinatorText },
    { key: "city", topic: "vip-city-transport", icon: MapPinned, title: t.cityTitle, text: t.cityText },
    { key: "companion", topic: "vip-companion", icon: Users, title: t.companionTitle, text: t.companionText },
    { key: "recovery", topic: "vip-recovery", icon: HeartPulse, title: t.recoveryTitle, text: t.recoveryText },
  ];
  const flow: { icon: LucideIcon; title: string; text: string }[] = [
    { icon: PlaneLanding, title: t.flowArrival, text: t.flowArrivalText },
    { icon: Car, title: t.flowTransfer, text: t.flowTransferText },
    { icon: KeyRound, title: t.flowCheckIn, text: t.flowCheckInText },
    { icon: Building2, title: t.flowFacility, text: t.flowFacilityText },
    { icon: Sofa, title: t.flowRecovery, text: t.flowRecoveryText },
    { icon: PlaneTakeoff, title: t.flowReturn, text: t.flowReturnText },
  ];

  return (
    <div data-testid="vip-page">
      <section className="bg-[var(--site-primary)]/5">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-20">
          <p className="text-sm font-semibold text-[var(--site-primary)]">{t.eyebrow}</p>
          <h1 className="mt-2 max-w-3xl font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            {t.title}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-foreground/80 sm:text-lg">{t.intro}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href={hrefs.request} className={primaryButton} data-testid="vip-hero-book">
              {t.ctaBook}
            </Link>
            <Link href={hrefs.find} className={secondaryButton}>
              {t.ctaFind}
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-20" aria-labelledby="vip-sections-heading">
        <h2 id="vip-sections-heading" className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {t.sectionsHeading}
        </h2>
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3" data-testid="vip-items">
          {sections.map((item, index) => (
            <li
              key={item.key}
              className="flex flex-col overflow-hidden rounded-[var(--site-radius)] border border-border bg-[var(--site-surface)] shadow-sm transition-all duration-300 hover:shadow-md motion-reduce:transition-none"
            >
              <ImageSlot image={images[index]} icon={item.icon} />
              <div className="flex flex-1 flex-col p-6">
                <span className="flex size-10 items-center justify-center rounded-full bg-[var(--site-primary)]/10 text-[var(--site-primary)]">
                  <item.icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
                </span>
                <h3 className="mt-4 font-heading text-lg font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-foreground/75">{item.text}</p>
                <Link
                  href={vipRequestHref(hrefs.request, item.topic)}
                  aria-label={formatSiteString(t.requestAria, { title: item.title })}
                  className={`${secondaryButton} mt-6 w-full sm:w-fit`}
                  data-testid="vip-request"
                >
                  {t.requestCta}
                  <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-[var(--site-surface)]" aria-labelledby="vip-flow-heading">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-20">
          <h2 id="vip-flow-heading" className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {t.flowHeading}
          </h2>
          <ol aria-label={t.flowAria} className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-6" data-testid="vip-flow">
            {flow.map((step, index) => (
              <li
                key={step.title}
                className="flex gap-4 rounded-[var(--site-radius)] border border-border bg-[var(--site-background)] p-4 lg:flex-col lg:gap-3"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--site-primary)] text-white">
                  <step.icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-[var(--site-primary)]">{index + 1}</p>
                  <h3 className="font-heading text-base font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-foreground/75">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-20" aria-labelledby="vip-cta-heading">
        <div className="rounded-2xl bg-[var(--site-primary)] px-6 py-10 text-white sm:px-12 sm:py-14" data-testid="vip-cta">
          <h2 id="vip-cta-heading" className="max-w-2xl font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            {t.ctaTitle}
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/90">{t.ctaText}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={hrefs.request}
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--site-radius)] bg-white px-5 text-sm font-semibold text-[var(--site-primary)] transition-all duration-300 hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
              data-testid="vip-cta-book"
            >
              {t.ctaBook}
            </Link>
            <Link
              href={hrefs.find}
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--site-radius)] border border-white/70 px-5 text-sm font-semibold text-white transition-all duration-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
            >
              {t.ctaFind}
            </Link>
          </div>
        </div>
        <p className="mt-8 max-w-3xl text-sm text-foreground/70">{t.note}</p>
        <IntermediaryNotice strings={intermediary} certificateNo={certificateNo} className="mt-6" />
      </section>
    </div>
  );
}
