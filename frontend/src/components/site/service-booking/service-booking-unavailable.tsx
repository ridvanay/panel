import Link from "next/link";
import { CalendarX2 } from "lucide-react";
import type { ServiceBookingStrings } from "@/lib/i18n/site-dictionaries/en/service-booking";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * `config.enabled=false` veya `SERVICE_NOT_BOOKABLE` iken: ölü takvim yerine talep formuna yönlendiren bilgi kartı
 * ("Request a call back"). Sunucu ve istemci bileşenlerinden kullanılabilir.
 */
export function ServiceBookingUnavailable({ strings: s, callbackHref }: { strings: ServiceBookingStrings; callbackHref: string }) {
  return (
    <div
      role="status"
      className="mx-auto max-w-xl rounded-[var(--site-radius)] border border-border bg-surface p-8 text-center"
      data-testid="service-booking-unavailable"
    >
      <CalendarX2 className="mx-auto h-10 w-10 text-foreground/40" aria-hidden="true" />
      <h2 className="mt-4 font-heading text-xl font-semibold text-foreground">{s.notBookableTitle}</h2>
      <p className="mt-2 text-sm text-foreground/70">{s.notBookableText}</p>
      <Link href={callbackHref} className={cn(buttonVariants({ variant: "default" }), "mt-5 rounded-[var(--site-radius)]")} data-testid="service-booking-callback-cta">
        {s.notBookableCta}
      </Link>
    </div>
  );
}
