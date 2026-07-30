import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-surface/70 p-6 shadow-sm backdrop-blur-xl transition-all duration-300 hover:border-border hover:shadow-md",
        className
      )}
      {...props}
    />
  );
}
