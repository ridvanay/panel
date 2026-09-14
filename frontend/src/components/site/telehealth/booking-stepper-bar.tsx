import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ui-designer — randevu sihirbazı (`/doctors/[slug]`) için SAF SUNUM adım çubuğu. Hiçbir
 * hook/state İÇERMEZ; hangi adımın `current`/`completed`/`upcoming` olduğu TAMAMEN üst
 * bileşenin (frontend-agent'ın Stepper mimarisi) sorumluluğundadır — bu bileşen yalnızca
 * `steps` prop'unu render eder.
 *
 * Ton dili: `--site-*`/`text-primary`/`bg-primary`/`border-border`/`bg-surface` (proje
 * `.site-scope` içinde render edildiği için ham hex KULLANILMAZ). `availability-calendar.tsx`
 * (`SELECTION_PILL_SELECTED`/dolu takvim günü hücresi) ve `doctor-portal-quick-links-card.tsx`
 * (kart yüzeyi/ikon deseni) İLHAM kaynağıdır — bu bileşen o dosyalara DOKUNMAZ.
 */
export type BookingStepStatus = "completed" | "current" | "upcoming";

export interface BookingStepperStep {
  /** 1..5 — sırayla, boşluksuz. */
  index: number;
  /** Ör. "Hekim Seçimi", "Tarih & Saat", "Hasta & Kimlik", "Tıbbi Belge", "Ödeme & Onay". */
  label: string;
  status: BookingStepStatus;
}

export function BookingStepperBar({ steps }: { steps: BookingStepperStep[] }) {
  return (
    <nav aria-label="Randevu adımları" data-testid="booking-stepper-bar" className="w-full">
      <ol className="flex w-full items-start">
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1;

          return (
            <li
              key={step.index}
              data-testid="booking-stepper-step"
              data-step={step.index}
              data-status={step.status}
              aria-current={step.status === "current" ? "step" : undefined}
              className={cn("flex flex-col", isLast ? "flex-none items-center" : "flex-1 items-start")}
            >
              {/* Daire + bağlayıcı çizgi satırı — çizgi dairenin dikey merkeziyle hizalanır. */}
              <div className="flex w-full items-center gap-1.5 sm:gap-2">
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums transition-all duration-200 sm:h-9 sm:w-9 sm:text-sm",
                    step.status === "completed" && "bg-primary text-primary-foreground",
                    step.status === "current" &&
                      "scale-105 border-2 border-primary bg-surface text-primary ring-4 ring-primary/10",
                    step.status === "upcoming" && "border border-border bg-surface text-foreground/40"
                  )}
                >
                  {step.status === "completed" ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <span aria-hidden="true">{step.index}</span>
                  )}
                </span>

                {!isLast && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-0.5 flex-1 rounded-full transition-colors duration-200",
                      step.status === "completed" ? "bg-primary" : "bg-border"
                    )}
                  />
                )}
              </div>

              {/* Etiket — `sm:` altında görsel olarak gizlenir (`sr-only`), tam erişilebilir metin
                  korunur; daireler + ilerleme çubuğu taşma yaratmadan dar ekranlara sığar. */}
              <span
                className={cn(
                  "sr-only text-[11px] font-medium leading-tight sm:not-sr-only sm:mt-1.5 sm:block sm:max-w-[104px] sm:text-left",
                  isLast && "sm:text-left",
                  step.status === "completed" && "sm:text-foreground/70",
                  step.status === "current" && "sm:font-semibold sm:text-foreground",
                  step.status === "upcoming" && "sm:text-foreground/40"
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
