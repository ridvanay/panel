import { Check, Square, Unlink2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * §8.4 mimar dokümanı — v3'te `LayoutValue = "full" | "row"` ikilisi KALDIRILDI (bir bloğun
 * "durumu" artık yoktur, konteynerler serbestçe iç içe geçebilir). Bu menü artık TEK bir eylem
 * sunar, düğümün tipine göre:
 *   - içerik bloğu (`mode="wrap"`) → "Konteynere Sar" (`wrapInContainer`)
 *   - konteyner (`mode="unwrap"`) → "Konteyneri Kaldır" (`unwrapContainer`, veri kaybı onayı
 *     ÇAĞIRAN TARAFTA — bkz. `builder-canvas.tsx::needsConfirmToUnwrap`)
 */
export type LayoutMenuMode = "wrap" | "unwrap";

const MODE_ICON = { wrap: Square, unwrap: Unlink2 } as const;
const MODE_LABEL: Record<LayoutMenuMode, string> = { wrap: "Konteynere Sar", unwrap: "Konteyneri Kaldır" };

export function LayoutMenu({ mode, onSelect }: { mode: LayoutMenuMode; onSelect: () => void }) {
  const Icon = MODE_ICON[mode];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Düzen" />}>
        <Icon className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={onSelect}>
          <Icon className="h-4 w-4 text-foreground/50" />
          {MODE_LABEL[mode]}
          <Check className="ml-auto h-4 w-4 opacity-0" aria-hidden />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
