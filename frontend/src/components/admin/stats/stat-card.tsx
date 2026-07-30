import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

interface StatCardProps {
  label: string;
  value: string;
  delta?: { value: string; direction: "up" | "down"; isGood?: boolean };
}

export function StatCard({ label, value, delta }: StatCardProps) {
  const deltaIsGood = delta ? (delta.isGood ?? delta.direction === "up") : undefined;

  return (
    <Card>
      <p className="text-sm text-foreground/60">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-foreground">{value}</p>
      {delta && (
        <p
          className={cn(
            "mt-1 text-xs font-medium",
            deltaIsGood ? "text-success" : "text-danger"
          )}
        >
          {delta.direction === "up" ? "↑" : "↓"} {delta.value}
        </p>
      )}
    </Card>
  );
}
