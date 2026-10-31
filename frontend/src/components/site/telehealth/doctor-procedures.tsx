import { ChevronDown } from "lucide-react";
import type { DoctorShowcaseProcedure } from "@/lib/api/types";
import type { ReviewsStrings } from "@/lib/i18n/site-dictionaries/en/reviews";

/**
 * Paket Y — "Treatments & Procedures" akordeonu. Yerel `<details>/<summary>`: klavye ve ekran okuyucu desteği
 * hazır gelir, içerik kapalıyken bile HTML'de bulunur (SEO). Fiyat BİLİNÇLİ OLARAK yoktur.
 */
export function DoctorProcedures({ procedures, dict }: { procedures: DoctorShowcaseProcedure[]; dict: ReviewsStrings }) {
  if (procedures.length === 0) return null;
  return (
    <div className="space-y-3">
      {procedures.map((procedure) => {
        const facts: { label: string; value: string }[] = [
          { label: dict.procedureDuration, value: procedure.duration ?? "" },
          { label: dict.procedureAnesthesia, value: procedure.anesthesia ?? "" },
          { label: dict.procedureHospitalStay, value: procedure.hospitalStay ?? "" },
          { label: dict.procedureRecovery, value: procedure.recovery ?? "" },
        ].filter((f) => f.value.trim() !== "");
        return (
          <details key={procedure.id} className="group rounded-[var(--site-radius)] border border-border bg-surface open:shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--site-radius)] px-4 py-3 text-base font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              {procedure.title}
              <ChevronDown className="h-4 w-4 shrink-0 text-foreground/50 transition-transform duration-300 group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="space-y-4 border-t border-border px-4 py-4">
              {procedure.description && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-foreground/50">{dict.procedureWhat}</p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-7 text-foreground/80">{procedure.description}</p>
                </div>
              )}
              {facts.length > 0 && (
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {facts.map((fact) => (
                    <div key={fact.label}>
                      <dt className="text-xs font-semibold uppercase tracking-wider text-foreground/50">{fact.label}</dt>
                      <dd className="mt-0.5 text-sm text-foreground/80">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
