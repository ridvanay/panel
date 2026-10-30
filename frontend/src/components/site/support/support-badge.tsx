import { Globe } from "lucide-react";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { ResolvedLanguageSupport } from "@/lib/language-support";
import { cn } from "@/lib/utils";

/**
 * Paket V — doktor profili ve randevu sihirbazındaki küçük rozet ("🌐 Support in 9 languages").
 * Desteklenen dil yoksa render edilmez. `title` desteklenen dillerin adlarını listeler.
 */
export function SupportBadge({ support, label, className }: { support: ResolvedLanguageSupport | null; label: string; className?: string }) {
  if (!support) return null;
  return (
    <span
      data-testid="support-badge"
      title={support.languages.map((l) => l.nativeName).join(", ")}
      className={cn("inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground/80", className)}
    >
      <Globe className="h-3.5 w-3.5 text-[var(--site-primary)]" aria-hidden="true" />
      {formatSiteString(label, { count: support.languages.length })}
    </span>
  );
}
