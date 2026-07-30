import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "primary" | "success" | "danger";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-muted text-foreground/70",
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  danger: "bg-danger/10 text-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", toneClasses[tone])}>
      {children}
    </span>
  );
}
