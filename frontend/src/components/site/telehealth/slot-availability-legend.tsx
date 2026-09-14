import { cn } from "@/lib/utils";

/**
 * ui-designer — randevu sihirbazının "Tarih & Saat" adımı için SAF SUNUM lejant şeridi. Prop
 * dışında hiçbir state/hook İÇERMEZ.
 *
 * Ton kaynağı:
 * - "Müsait" → `availability-calendar.tsx`'teki `SELECTION_PILL_AVAILABLE`/müsait takvim günü
 *   hücresiyle (`border-primary/20 bg-primary/5`) AYNI aile — burada biraz daha belirgin
 *   `bg-primary/10 border-primary/30` kullanılır (küçük bir lejant swatch'ının kart yüzeyinde
 *   ayırt edilebilir kalması için).
 * - "Dolu" → dolu slot hücresiyle (`border-border/60 bg-muted`, `text-foreground/40`) BİREBİR
 *   aynı ton.
 * - "Hafta Sonu" → proje şu an takvimde hafta sonu günlerini AYRI renklendirmiyor (frontend-agent
 *   bu görevden SONRA `availability-calendar.tsx`'i yeniden yapılandırırken hafta sonu günü
 *   hücrelerini bu legend'daki tonla EŞLEŞTİRMELİDİR). Yeni bir renk İCAT EDİLMEDİ — mevcut
 *   `--site-secondary` marka tokenından türetildi (bkz. `cookie-consent-banner.tsx` ve
 *   `doctors/[slug]/page.tsx`'teki AYNI `bg-[var(--site-secondary)]` deseni; Tailwind'in
 *   `bg-secondary` semantik sınıfı `.site-scope` içinde `--site-surface`'a çözüldüğü için
 *   BİLİNÇLİ olarak KULLANILMADI, ham `--site-secondary` değişkenine referans verildi).
 *
 * data-notes: "Hafta Sonu" işareti şu an SADECE bu lejantta vardır. frontend-agent takvim
 * ızgarasında hafta sonu (Cmt/Paz) günü hücrelerini `bg-[var(--site-secondary)]/10
 * border-[var(--site-secondary)]/30` (+ ince bir üst çizgi/nokta rozeti) ile işaretlediğinde bu
 * lejant görsel olarak DOĞRU referans kaynağı olur; aksi halde lejant "yetim" (karşılığı olmayan)
 * bir girdi içerir.
 */
export function SlotAvailabilityLegend({ className }: { className?: string }) {
  return (
    <div
      data-testid="slot-availability-legend"
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-foreground/70", className)}
    >
      <LegendItem
        swatchClassName="border-primary/30 bg-primary/10"
        label="Müsait"
      />
      <LegendItem
        swatchClassName="border-border/60 bg-muted"
        label="Dolu"
        labelClassName="text-foreground/40"
      />
      <LegendItem
        swatchClassName="border-[var(--site-secondary)]/30 bg-[var(--site-secondary)]/10"
        label="Hafta Sonu"
      />
    </div>
  );
}

function LegendItem({
  swatchClassName,
  label,
  labelClassName,
}: {
  swatchClassName: string;
  label: string;
  labelClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn("h-3 w-3 shrink-0 rounded-[var(--site-radius)] border", swatchClassName)}
      />
      <span className={cn("font-medium", labelClassName)}>{label}</span>
    </span>
  );
}
