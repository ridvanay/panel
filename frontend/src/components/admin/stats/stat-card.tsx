import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export interface StatCardDelta {
  value: string;
  direction: "up" | "down";
  isGood?: boolean;
}

interface StatCardProps {
  label: string;
  value: string;
  delta?: StatCardDelta;
}

export function StatCard({ label, value, delta }: StatCardProps) {
  const deltaIsGood = delta ? (delta.isGood ?? delta.direction === "up") : undefined;

  return (
    <Card className="relative overflow-hidden transition-shadow duration-300 hover:shadow-lg">
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
      <p className="relative mt-2 text-3xl font-semibold text-foreground">{value}</p>
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
