import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "primary" | "success" | "danger" | "warning";
type Size = "sm" | "lg";

const toneClasses: Record<Tone, { soft: string; solid: string }> = {
  neutral: { soft: "bg-surface-muted text-foreground/70", solid: "bg-foreground text-background" },
  primary: { soft: "bg-primary/10 text-primary",           solid: "bg-primary text-primary-foreground" },
  success: { soft: "bg-success/10 text-success",           solid: "bg-success text-success-foreground" },
  danger:  { soft: "bg-danger/10 text-danger",             solid: "bg-danger text-danger-foreground" },
  warning: { soft: "bg-warning/10 text-warning",           solid: "bg-warning text-warning-foreground" },
};

const sizeClasses: Record<Size, string> = {
  sm: "px-2.5 py-0.5 text-xs font-medium",
  lg: "px-3 py-1 text-sm font-semibold",
};

export function Badge({
  tone = "neutral",
  size = "sm",
  solid = false,
  children,
}: {
  tone?: Tone;
  size?: Size;
  solid?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center rounded-full", sizeClasses[size], solid ? toneClasses[tone].solid : toneClasses[tone].soft)}>
      {children}
    </span>
  );
}
