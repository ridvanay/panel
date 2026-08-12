import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type AlertVariant = "error" | "success" | "info" | "warning";

const styles: Record<AlertVariant, string> = {
  error: "border-danger/30 bg-danger/10 text-danger",
  success: "border-success/30 bg-success/10 text-success",
  info: "border-border bg-surface-muted text-foreground",
  // design-notes-appearance-panel.md §9 — Özel CSS uyarısı için (--warning token'ı badge.tsx'in
  // "warning" tonuyla ORTAK, bkz. globals.css).
  warning: "border-warning/30 bg-warning/10 text-warning",
};

export function Alert({
  variant = "info",
  children,
  className,
}: {
  variant?: AlertVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn("rounded-md border px-4 py-3 text-sm", styles[variant], className)}
    >
      {children}
    </div>
  );
}
