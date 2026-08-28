"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Architect §6.5 BAĞLAYICI UX kuralı — tablet/mobil görünümündeyken düzenlenen HER alan-grubunun
 * yanında "bu cihazda geçersiz kılındı" göstergesi + "override'ı kaldır" düğmesi.
 */
export function DeviceOverrideBadge({ overridden, onRemove }: { overridden: boolean; onRemove: () => void }) {
  if (!overridden) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone="primary" size="sm">
        Bu cihazda geçersiz kılındı
      </Badge>
      <Button type="button" variant="ghost" size="xs" onClick={onRemove}>
        Kaldır
      </Button>
    </span>
  );
}
