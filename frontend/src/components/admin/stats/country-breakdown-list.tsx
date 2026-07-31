"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import * as statsApi from "@/lib/api/stats";
import type { CountryBreakdownItem } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { Globe, Info } from "lucide-react";

/** "UNKNOWN"/"OTHER" gibi backend kodlarını okunabilir Türkçe etiketlere çevirir. */
function countryLabel(country: string): string {
  if (country === "UNKNOWN") return "Bilinmiyor";
  if (country === "OTHER") return "Diğer";
  return country;
}

interface CountryBreakdownListProps {
  /** Son kaç günün verisi çekilecek. Verilmezse mevcut varsayılan (30) korunur. */
  days?: number;
}

export function CountryBreakdownList({ days = 30 }: CountryBreakdownListProps) {
  const [countries, setCountries] = useState<CountryBreakdownItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setCountries(null);
      setError(null);
      try {
        const breakdown = await statsApi.getBreakdown(days);
        setCountries(breakdown.countries);
      } catch (err) {
        setError(friendlyErrorMessage(err));
      }
    })();
  }, [days]);

  const total = countries?.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const maxCount = countries?.reduce((max, item) => Math.max(max, item.count), 0) ?? 0;
  const hasUnknown = countries?.some((item) => item.country === "UNKNOWN") ?? false;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut", delay: 0.1 }}
    >
      <Card>
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-medium text-foreground">Ülke Trafiği</h3>
          {hasUnknown && (
            <Tooltip>
              <TooltipTrigger
                type="button"
                aria-label="Bilinmiyor açıklaması"
                className="text-foreground/40 transition-colors hover:text-foreground/70"
              >
                <Info className="h-3.5 w-3.5" />
              </TooltipTrigger>
              <TooltipContent>
                Yerel geliştirme ortamında IP çözümlenemediği için çoğu trafik &quot;Bilinmiyor&quot; görünebilir, bu
                normaldir.
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <p className="text-xs text-foreground/60">Son {days} gün · ülkeye göre ziyaretçi sayısı</p>

        {error ? (
          <Alert variant="error" className="mt-4">
            {error}
          </Alert>
        ) : countries === null ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner className="h-6 w-6 text-primary" />
          </div>
        ) : total === 0 ? (
          <EmptyState icon={Globe} title="Henüz veri yok" className="mt-4 border-none p-6" />
        ) : (
          <ul className="mt-4 space-y-3">
            {countries
              .slice()
              .sort((a, b) => b.count - a.count)
              .map((item) => {
                const widthPercent = maxCount > 0 ? Math.max((item.count / maxCount) * 100, 4) : 0;
                return (
                  <li key={item.country} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        {countryLabel(item.country)}
                        {item.country === "UNKNOWN" && <Info className="h-3 w-3 text-foreground/40" />}
                      </span>
                      <span className="tabular-nums text-foreground/60">{item.count.toLocaleString("tr-TR")}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${widthPercent}%` }}
                      />
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </Card>
    </motion.div>
  );
}
