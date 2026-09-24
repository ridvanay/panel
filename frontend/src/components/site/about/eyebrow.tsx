import { cn } from "@/lib/utils";

/**
 * Bölüm başlığı üstündeki küçük etiket — büyük harf, 13px, kalın, 0.14em harf aralığı, primary
 * renk. Solunda (ortalı varyantta iki yanında) 28×3px `--about-accent` çizgisi.
 */
export function Eyebrow({ children, align = "start", className }: { children: string; align?: "start" | "center"; className?: string }) {
  const line = <span className="h-[3px] w-7 shrink-0 rounded-full bg-[var(--about-accent)]" aria-hidden="true" />;
  return (
    <p
      className={cn(
        "flex items-center gap-3 text-[13px] font-bold uppercase tracking-[0.14em] text-primary",
        align === "center" && "justify-center",
        className
      )}
    >
      {line}
      <span>{children}</span>
      {align === "center" && line}
    </p>
  );
}
