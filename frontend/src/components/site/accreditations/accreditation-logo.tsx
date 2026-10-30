import type { PublicAccreditation } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Paket V — yönetici tarafından yüklenen resmi logo (medya kütüphanesi). Logo yoksa adı metin olarak
 * gösterilir; logo çizilmez/üretilmez.
 */
export function AccreditationLogo({ badge, className }: { badge: PublicAccreditation; className?: string }) {
  if (!badge.logoUrl) {
    return <span className={cn("text-xs font-semibold text-foreground/70", className)}>{badge.name}</span>;
  }
  // Medya kütüphanesi URL'si; logolar küçük olduğu için düz `<img>` yeterli.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={badge.logoUrl} alt={badge.logoAlt ?? badge.name} loading="lazy" decoding="async" className={cn("w-auto object-contain", className)} />;
}
