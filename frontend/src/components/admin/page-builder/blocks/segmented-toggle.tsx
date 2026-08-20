import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

/**
 * `container-settings-panel.tsx::SegmentedToggle`nin küçük bir yerel kopyası — page-builder
 * İÇİ (cross-feature DEĞİL) paylaşım, yeni blok editörleri (Başlık/Buton/Ayırıcı) arasında.
 * İkon opsiyoneldir (container ayarlarındaki sürümden fark — bazı seçenekler salt metin).
 */
export function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; icon?: LucideIcon }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex w-fit flex-wrap items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5">
      {options.map(({ value: optionValue, label, icon: Icon }) => {
        const active = optionValue === value;
        return (
          <Button
            key={optionValue}
            type="button"
            size="xs"
            variant={active ? "secondary" : "ghost"}
            aria-pressed={active}
            onClick={() => onChange(optionValue)}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {label}
          </Button>
        );
      })}
    </div>
  );
}
