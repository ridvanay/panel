import { Headset, Hotel, Building2, HeartPulse } from "lucide-react";
import type { RequestStrings } from "@/lib/i18n/site-dictionaries/en/request";

/** Paket AJ — "What happens next" 4 adımı (Coordinator call → Facility & plan → Travel & stay → Treatment & aftercare). */
export function RequestNextSteps({ strings: t, headingLevel = 2 }: { strings: RequestStrings; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const items = [
    { icon: <Headset className="size-4" aria-hidden="true" />, title: t.next1Title, text: t.next1Text },
    { icon: <Building2 className="size-4" aria-hidden="true" />, title: t.next2Title, text: t.next2Text },
    { icon: <Hotel className="size-4" aria-hidden="true" />, title: t.next3Title, text: t.next3Text },
    { icon: <HeartPulse className="size-4" aria-hidden="true" />, title: t.next4Title, text: t.next4Text },
  ];
  return (
    <div data-testid="request-next-steps">
      <Heading className="font-heading text-lg font-semibold text-foreground">{t.nextTitle}</Heading>
      <ol className="mt-4 space-y-4">
        {items.map((item, index) => (
          <li key={item.title} className="flex gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--site-primary)]/10 text-[var(--site-primary)]">{item.icon}</span>
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-foreground">
                <span className="sr-only">{index + 1}. </span>
                {item.title}
              </p>
              <p className="mt-0.5 text-foreground/70">{item.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
