import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { AnimatedCounter } from "@/components/admin/stats/animated-counter";

export interface StatCardDelta {
  value: string;
  direction: "up" | "down";
  isGood?: boolean;
}

interface StatCardProps {
  label: string;
  value: string;
  /**
   * Opsiyonel: `value` zaten tr-TR formatlı bir sayıysa otomatik
   * parse edilir, ama belirsiz durumlar için (örn. büyük/ondalıklı
   * sayılar) doğrudan ham sayıyı burada verebilirsin.
   */
  numericValue?: number;
  delta?: StatCardDelta;
}

/** "1.234" gibi tr-TR binlik ayraçlı bir string'i sayıya çevirir. */
function parseLocaleNumber(value: string): number | null {
  if (!/^-?[\d.]+$/.test(value)) return null; // "—" gibi placeholder'ları veya beklenmeyen formatları ele
  const cleaned = value.replace(/\./g, ""); // tr-TR binlik ayracı "."
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function StatCard({ label, value, numericValue, delta }: StatCardProps) {
  const deltaIsGood = delta ? (delta.isGood ?? delta.direction === "up") : undefined;
  const parsedValue = numericValue ?? parseLocaleNumber(value);

  return (
    <Card interactive className="relative overflow-hidden transition-shadow duration-300 hover:shadow-lg">
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full blur-2xl transition-opacity duration-300",
          delta === undefined
            ? "bg-primary/10"
            : deltaIsGood
              ? "bg-success/20"
              : "bg-danger/20"
        )}
      />
      <p className="relative text-sm text-foreground/60">{label}</p>
      <p className="relative mt-2 text-3xl font-semibold text-foreground">
        {parsedValue !== null ? <AnimatedCounter value={parsedValue} /> : value}
      </p>
      {delta && (
        <p
          className={cn(
            "relative mt-1 inline-flex items-center gap-1 text-xs font-medium",
            deltaIsGood ? "text-success" : "text-danger"
          )}
        >
          {delta.direction === "up" ? "↑" : "↓"} {delta.value}
        </p>
      )}
    </Card>
  );
}
