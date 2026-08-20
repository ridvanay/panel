"use client";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { contrastRatio, meetsWcagAa } from "@/lib/site-settings/contrast";

/**
 * design-notes-appearance-panel.md §5 — engellemeyen (non-blocking) WCAG AA (4.5:1) uyarısı.
 * Kaydet butonu bu rozetten ETKİLENMEZ (§10.12.4: kontrast sunucuda zorlanmaz, istemci de
 * zorlamaz — sadece bilgilendirir).
 */
export function ContrastBadge({ foreground, background }: { foreground: string; background: string }) {
  const ratio = contrastRatio(foreground, background);
  if (ratio === null) return null;
  const ok = meetsWcagAa(foreground, background);
  const rounded = ratio.toFixed(2);
  return (
    <Badge tone={ok ? "success" : "warning"} size="sm">
      {ok ? `Kontrast yeterli (${rounded}:1)` : `Düşük kontrast (${rounded}:1) — AA eşiği 4.5:1`}
    </Badge>
  );
}

interface ColorFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (hex: string) => void;
  /** Kontrast kontrolü için karşılaştırılacak diğer renk (örn. buttonColor vs buttonTextColor). */
  checkAgainst?: string;
  /**
   * Hex `<Input>` alanının `maxLength`'i. Varsayılan `7` (`#rrggbb`). Alfa kanallı `#rrggbbaa`
   * (9 karakter) kabul eden alanlar (bkz. `container-settings-panel.tsx::BackgroundControl` —
   * mimar §5.2 `ContainerBackground` regex'i `#rgb|#rrggbb|#rrggbbaa` kabul eder) bunu `9` verir.
   */
  maxLength?: number;
}

/** Native `<input type="color">` (küçük kare swatch) + yanında hex `<Input>` (metin) + opsiyonel WCAG rozeti. */
export function ColorField({ id, label, value, onChange, checkAgainst, maxLength = 7 }: ColorFieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
          aria-label={`${label} — renk seçici`}
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono uppercase"
          maxLength={maxLength}
          aria-label={`${label} — hex kod`}
        />
      </div>
      {checkAgainst && <ContrastBadge foreground={value} background={checkAgainst} />}
    </div>
  );
}
