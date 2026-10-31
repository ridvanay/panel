import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** Salt-okunur yıldız göstergesi — `label` ekran okuyucuya tek parça okunur (yıldızlar `aria-hidden`). */
export function StarRating({ rating, label, className }: { rating: number; label: string; className?: string }) {
  const filled = Math.round(rating);
  return (
    <span role="img" aria-label={label} className={cn("inline-flex items-center gap-0.5", className)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} aria-hidden="true" className={cn("h-4 w-4", n <= filled ? "fill-current text-warning" : "text-foreground/25")} />
      ))}
    </span>
  );
}
