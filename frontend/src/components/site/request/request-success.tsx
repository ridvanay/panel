import Link from "next/link";
import { BookOpen, CircleCheck, Home, Hotel, MessageCircle } from "lucide-react";
import type { RequestStrings } from "@/lib/i18n/site-dictionaries/en/request";
import { RequestNextSteps } from "./request-next-steps";

const linkCard =
  "group flex items-start gap-3 rounded-[var(--site-radius)] border border-border bg-background p-4 transition-all duration-300 motion-reduce:transition-none hover:border-[var(--site-primary)]/50 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]";
const iconBox = "flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--site-primary)]/10 text-[var(--site-primary)]";

/** Paket AJ — başarı ekranı: talep numarası, "What happens next" ve "While you wait" bağlantıları (takvim yok). */
export function RequestSuccess({
  strings: t,
  requestNumber,
  homeHref,
  servicesHref,
  vipHref,
  guidesHref,
  whatsappHref,
}: {
  strings: RequestStrings;
  requestNumber: string;
  homeHref: string;
  servicesHref: string;
  vipHref: string | null;
  guidesHref: string | null;
  whatsappHref: string | null;
}) {
  const waiting = [
    vipHref && { href: vipHref, title: t.waitVipTitle, text: t.waitVipText, icon: <Hotel className="size-5" aria-hidden="true" />, external: false },
    guidesHref && { href: guidesHref, title: t.waitGuidesTitle, text: t.waitGuidesText, icon: <BookOpen className="size-5" aria-hidden="true" />, external: false },
    whatsappHref && { href: whatsappHref, title: t.waitWhatsapp, text: null, icon: <MessageCircle className="size-5" aria-hidden="true" />, external: true },
  ].filter(Boolean) as { href: string; title: string; text: string | null; icon: React.ReactNode; external: boolean }[];

  return (
    <section aria-labelledby="request-success-title" className="space-y-8 rounded-xl border border-border bg-surface p-5 sm:p-8" data-testid="request-success">
      <div role="status">
        <h2 id="request-success-title" className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight text-foreground">
          <CircleCheck className="size-7 shrink-0 text-success" aria-hidden="true" />
          {t.successTitle}
        </h2>
        {requestNumber && (
          <p className="mt-4 inline-flex rounded-full bg-[var(--site-primary)]/10 px-4 py-1.5 text-base font-semibold text-[var(--site-primary)]" data-testid="request-number">
            {t.successNumber.replace("{number}", requestNumber)}
          </p>
        )}
        <p className="mt-3 text-sm text-foreground/80">{t.successText}</p>
        <p className="mt-1 text-sm text-foreground/70">{t.successEmail}</p>
      </div>

      <RequestNextSteps strings={t} headingLevel={3} />

      {waiting.length > 0 && (
        <div>
          <h3 className="font-heading text-lg font-semibold text-foreground">{t.waitTitle}</h3>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {waiting.map((item) => (
              <li key={item.href}>
                <Link href={item.href} {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className={linkCard}>
                  <span className={iconBox}>{item.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">{item.title}</span>
                    {item.text && <span className="mt-0.5 block text-xs text-foreground/70">{item.text}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Link
          href={homeHref}
          className="inline-flex min-h-11 items-center gap-2 rounded-[var(--site-radius)] bg-[var(--site-button)] px-5 text-sm font-semibold text-[var(--site-button-text)] transition-opacity duration-300 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
        >
          <Home className="size-4" aria-hidden="true" />
          {t.successHome}
        </Link>
        <Link
          href={servicesHref}
          className="inline-flex min-h-11 items-center rounded-[var(--site-radius)] border border-[var(--site-primary)] px-5 text-sm font-semibold text-[var(--site-primary)] transition-colors duration-300 hover:bg-[var(--site-primary)]/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
        >
          {t.successServices}
        </Link>
      </div>
    </section>
  );
}
