import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { LinkButton } from "@/components/ui/link-button";
import type { BlockChrome, PricingTableBlock } from "@/lib/page-builder/types";

function gridColsClass(count: number): string {
  if (count <= 2) return "grid-cols-1 sm:grid-cols-2";
  if (count === 3) return "grid-cols-1 sm:grid-cols-3";
  return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
}

/** `billingInterval` — YENİ, SALT GÖRSEL bir rozet (mimar §2.4); yoksa hiç render EDİLMEZ. */
const BILLING_INTERVAL_LABEL: Record<"monthly" | "yearly", string> = {
  monthly: "Aylık",
  yearly: "Yıllık",
};

export function PricingTableBlockView({ block, chrome }: { block: PricingTableBlock; chrome: BlockChrome }) {
  const plans = block.data.plans;
  const billingInterval = block.data.billingInterval;

  return (
    <section className={cn(chrome === "page" && "px-4 py-12 sm:px-6")}>
      {billingInterval && (
        <p className="mx-auto mb-4 w-fit rounded-full border border-border bg-surface-muted px-3 py-1 text-center text-xs font-medium text-foreground/70">
          {BILLING_INTERVAL_LABEL[billingInterval]}
        </p>
      )}
      <div className={cn("mx-auto grid max-w-6xl items-stretch gap-6", gridColsClass(plans.length))}>
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={cn(
              "flex flex-col gap-4 rounded-lg border p-6",
              plan.highlighted ? "border-primary shadow-lg" : "border-border"
            )}
          >
            {plan.highlighted && (
              <span className="w-fit rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                Popüler
              </span>
            )}
            <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
            {plan.description && <p className="text-sm text-foreground/70">{plan.description}</p>}
            <p className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-foreground">{plan.price}</span>
              {plan.period && <span className="text-sm text-foreground/60">{plan.period}</span>}
            </p>
            <ul className="flex-1 space-y-2">
              {plan.features.map((feature, index) => (
                <li key={index} className="flex items-start gap-2 text-sm text-foreground/80">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  {feature}
                </li>
              ))}
            </ul>
            <LinkButton
              href={plan.buttonHref}
              variant={plan.highlighted ? "default" : "outline"}
              className="w-full justify-center"
            >
              {plan.buttonLabel}
            </LinkButton>
          </div>
        ))}
      </div>
    </section>
  );
}
