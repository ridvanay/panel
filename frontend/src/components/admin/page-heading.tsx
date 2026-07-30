import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeadingProps {
  icon: ComponentType<LucideProps>;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

/**
 * Admin sayfaları için ikonlu başlık rozeti. `settings/page.tsx`'teki görsel dili
 * (rounded-lg bg-primary/10 ikon rozeti + border-b) diğer sayfalara taşımak için ortak bileşen.
 */
export function PageHeading({ icon: Icon, title, description, actions, className }: PageHeadingProps) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-border pb-6", className)}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && <p className="mt-1 text-sm text-foreground/60">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
