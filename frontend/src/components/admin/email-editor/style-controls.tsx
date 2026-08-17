import type { ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorField } from "@/components/admin/appearance/color-field";
import { cn } from "@/lib/utils";
import { EMAIL_BLOCK_SPACING_PX } from "@/lib/email-blocks/registry";
import type { EmailBlockAlign, EmailBlockSpacing } from "@/lib/api/types";

/** design-notes §A.4 — mikro bölüm başlığı, appearance-polish ile AYNI sınıf. */
export function StyleSectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold tracking-wide text-foreground/40 uppercase">{children}</p>;
}

/** Bölüm ayracı — ilk bölüm hariç her bölümün üstünde. */
export function StyleSection({ title, children, first }: { title: string; children: ReactNode; first?: boolean }) {
  return (
    <div className={cn("space-y-2.5", !first && "border-t border-border/60 pt-4")}>
      <StyleSectionLabel>{title}</StyleSectionLabel>
      {children}
    </div>
  );
}

const ALIGN_ICON = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;
const ALIGN_LABEL: Record<EmailBlockAlign, string> = { left: "Sola hizala", center: "Ortala", right: "Sağa hizala" };

export function AlignControl({ value, onChange }: { value: EmailBlockAlign; onChange: (v: EmailBlockAlign) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5">
      {(["left", "center", "right"] as EmailBlockAlign[]).map((align) => {
        const Icon = ALIGN_ICON[align];
        const active = align === value;
        return (
          <Button
            key={align}
            type="button"
            size="icon-xs"
            variant={active ? "secondary" : "ghost"}
            aria-pressed={active}
            aria-label={ALIGN_LABEL[align]}
            onClick={() => onChange(align)}
          >
            <Icon className="h-3 w-3" />
          </Button>
        );
      })}
    </div>
  );
}

const SPACING_LABEL: Record<EmailBlockSpacing, string> = { none: "Yok", sm: "S", md: "M", lg: "L" };

export function SpacingControl({
  paddingY,
  paddingX,
  onChange,
}: {
  paddingY: EmailBlockSpacing;
  paddingX: EmailBlockSpacing;
  onChange: (patch: { paddingY?: EmailBlockSpacing; paddingX?: EmailBlockSpacing }) => void;
}) {
  return (
    <div className="space-y-2">
      {(
        [
          { key: "paddingY" as const, label: "Dikey", value: paddingY },
          { key: "paddingX" as const, label: "Yatay", value: paddingX },
        ]
      ).map((row) => (
        <div key={row.key} className="space-y-1">
          <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5 w-fit">
            {(["none", "sm", "md", "lg"] as EmailBlockSpacing[]).map((token) => {
              const active = token === row.value;
              return (
                <Button
                  key={token}
                  type="button"
                  size="xs"
                  variant={active ? "secondary" : "ghost"}
                  aria-pressed={active}
                  onClick={() => onChange({ [row.key]: token } as { paddingY?: EmailBlockSpacing; paddingX?: EmailBlockSpacing })}
                >
                  {SPACING_LABEL[token]}
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-foreground/50">
            {row.label}: {EMAIL_BLOCK_SPACING_PX[row.value]}px
          </p>
        </div>
      ))}
    </div>
  );
}

/** Nullable renk alanları için `ColorField` + "Temizle" (X) eklentisi — `ColorField`'ın KENDİSİNE dokunmaz. */
export function NullableColorField({
  id,
  label,
  value,
  onChange,
  checkAgainst,
  fallback = "#000000",
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  checkAgainst?: string;
  fallback?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <ColorField id={id} label={label} value={value ?? fallback} onChange={onChange} checkAgainst={value ? checkAgainst : undefined} />
        </div>
        {value !== null && (
          <Button type="button" variant="ghost" size="icon-xs" title="Varsayılana dön" aria-label={`${label} — varsayılana dön`} onClick={() => onChange(null)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function DividerThicknessControl({ value, onChange }: { value: 1 | 2 | 4; onChange: (v: 1 | 2 | 4) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5 w-fit">
      {([1, 2, 4] as const).map((thickness) => {
        const active = thickness === value;
        return (
          <Button
            key={thickness}
            type="button"
            size="icon-xs"
            variant={active ? "secondary" : "ghost"}
            aria-pressed={active}
            aria-label={`Kalınlık: ${thickness}px`}
            onClick={() => onChange(thickness)}
          >
            <span className="block w-4 rounded-full bg-current" style={{ height: `${thickness}px` }} aria-hidden />
          </Button>
        );
      })}
    </div>
  );
}

export function ButtonRadiusControl({ value, onChange }: { value: "none" | "sm" | "full"; onChange: (v: "none" | "sm" | "full") => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5 w-fit">
      {(["none", "sm", "full"] as const).map((radius) => {
        const active = radius === value;
        return (
          <Button
            key={radius}
            type="button"
            size="icon-xs"
            variant={active ? "secondary" : "ghost"}
            aria-pressed={active}
            aria-label={`Köşe: ${radius}`}
            onClick={() => onChange(radius)}
          >
            <span
              className={cn(
                "block h-4 w-4 border-2 border-current",
                radius === "none" && "rounded-none",
                radius === "sm" && "rounded-[4px]",
                radius === "full" && "rounded-full"
              )}
              aria-hidden
            />
          </Button>
        );
      })}
    </div>
  );
}
