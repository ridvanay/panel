import { Check, Columns2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * §10.17.3 v2 — bir leaf bloğun sadece iki hali vardır: kendi başına ("full") ya da bir satırın
 * İLK üyesi olarak ("row", 2 sütunlu bir `columns` konteynerine sarmalanır). Satırı 3, 4, 6…
 * sütuna büyütmek artık bu menüden DEĞİL, satırın kendi "+" butonundan yapılır (bkz.
 * builder-canvas.tsx::AddColumnMenu) — bu yüzden sabit bir "3 Sütun" seçeneği YOKTUR.
 */
export type LayoutValue = "full" | "row";

const LAYOUT_ICON: Record<LayoutValue, typeof Square> = {
  full: Square,
  row: Columns2,
};

const LAYOUT_LABEL: Record<LayoutValue, string> = {
  full: "Tam Genişlik",
  row: "2 Sütun",
};

/**
 * §10.17.7 madde 1 — her blok/`columns` konteynerinin KENDİ başlık satırındaki bir
 * `DropdownMenu`. Üst seviyede tekil bir blokta "Tam Genişlik" aktif/check'li ve tıklanamaz.
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
        {(["full", "row"] as LayoutValue[]).map((value) => {
          const Icon = LAYOUT_ICON[value];
          const isCurrent = value === current;
          return (
            <DropdownMenuItem
              key={value}
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
