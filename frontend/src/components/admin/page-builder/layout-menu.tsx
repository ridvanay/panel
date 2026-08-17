import { Check, Columns2, Columns3, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type LayoutValue = "full" | 2 | 3;

const LAYOUT_ICON: Record<LayoutValue, typeof Square> = {
  full: Square,
  2: Columns2,
  3: Columns3,
};

const LAYOUT_LABEL: Record<LayoutValue, string> = {
  full: "Tam Genişlik",
  2: "2 Sütun",
  3: "3 Sütun",
};

/**
 * §10.17.7 madde 1 — her blok/`columns` konteynerinin KENDİ başlık satırındaki bir
 * `DropdownMenu`. Üst seviyede tekil bir blokta "Tam Genişlik" aktif/check'li ve tıklanamaz;
 * `columns` konteynerinin başlığında "Tam Genişlik" seçilince unwrap tetiklenir (çağıran taraf
 * onay diyaloğunu yönetir, bkz. builder-canvas.tsx).
 */
export function LayoutMenu({ current, onSelect }: { current: LayoutValue; onSelect: (value: LayoutValue) => void }) {
  const CurrentIcon = LAYOUT_ICON[current];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Düzen" />}
      >
        <CurrentIcon className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {(["full", 2, 3] as LayoutValue[]).map((value) => {
          const Icon = LAYOUT_ICON[value];
          const isCurrent = value === current;
          return (
            <DropdownMenuItem
              key={String(value)}
              disabled={isCurrent && value === "full"}
              onClick={() => {
                if (!isCurrent) onSelect(value);
              }}
            >
              <Icon className="h-4 w-4 text-foreground/50" />
              {LAYOUT_LABEL[value]}
              {isCurrent && <Check className="ml-auto h-4 w-4" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
