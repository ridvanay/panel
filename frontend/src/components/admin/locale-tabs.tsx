"use client";

import { CheckCircle2, Circle, CircleDashed } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Locale } from "@/lib/api/types";

/**
 * Paylaşılan çeviri sekmesi bileşeni — design-notes-i18n.md §2. `pages`, `blog`, `products`,
 * `portfolio` editörlerinin daha önce KOPYALADIĞI yerel `LocaleToggle`'ların (sabit `["TR","EN"]`)
 * YERİNİ alır; dil listesi `GET /admin/locales`'ten DİNAMİK gelir — sabit dil sekmesi GÖMÜLMEZ.
 */
export type LocaleStatus = "translated" | "partial" | "untranslated";

const STATUS_LABEL: Record<LocaleStatus, string> = {
  translated: "Çevrildi",
  partial: "Kısmen çevrildi",
  untranslated: "Çevrilmedi — varsayılan dil gösterilecek",
};

function LocaleStatusIcon({ status, tooltip }: { status: LocaleStatus; tooltip: string }) {
  const icon =
    status === "translated" ? (
      <CheckCircle2 className="h-3 w-3 text-success" aria-hidden="true" />
    ) : status === "partial" ? (
      <CircleDashed className="h-3 w-3 text-warning" aria-hidden="true" />
    ) : (
      <Circle className="h-3 w-3 text-foreground/30" aria-hidden="true" />
    );

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{icon}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export interface LocaleTabsProps {
  /** `GET /admin/locales`'ten — `sortOrder` sıralı, devre dışı diller DAHİL edilebilir (çağıran filtreler). */
  locales: Locale[];
  /** Seçili dil kodu (küçük harf). */
  value: string;
  onValueChange: (code: string) => void;
  /**
   * Varsayılan olmayan her sekme için çeviri durumu — kaydedilmiş veriye göre hesaplanır
   * (autosave/snapshot sonrası; anlık taslak yazımı sekme ikonunu titretmemeli).
   */
  statusFor: (code: string) => LocaleStatus;
  /** Kısmi çeviri tooltip'inde "{dolu}/{toplam} alan" göstermek için — opsiyonel. */
  partialDetailFor?: (code: string) => string | undefined;
}

export function LocaleTabs({ locales, value, onValueChange, statusFor, partialDetailFor }: LocaleTabsProps) {
  return (
    <Tabs value={value} onValueChange={(v) => onValueChange(String(v))}>
      <TabsList variant="line" className="flex-nowrap overflow-x-auto">
        {locales.map((l) => {
          const status = statusFor(l.code);
          const detail = status === "partial" ? partialDetailFor?.(l.code) : undefined;
          const tooltip = detail ? `${STATUS_LABEL[status]} (${detail})` : STATUS_LABEL[status];
          return (
            <TabsTrigger key={l.code} value={l.code} className="min-w-16 shrink-0 justify-center gap-1.5">
              <span className="uppercase">{l.code}</span>
              {/* Varsayılan dil sekmesi hiçbir zaman durum ikonu TAŞIMAZ — "kaynak dil" olduğunun
                  kendisi zaten bir sinyaldir (design-notes-i18n.md §2.2). */}
              {!l.isDefault && <LocaleStatusIcon status={status} tooltip={tooltip} />}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
