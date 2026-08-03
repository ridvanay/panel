import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SeoScoreIssue } from "@/lib/api/types";

export function seoScoreTone(score: number): "danger" | "warning" | "success" {
  if (score < 50) return "danger";
  if (score < 80) return "warning";
  return "success";
}

interface SeoScoreBadgeProps {
  score: number;
  issues: SeoScoreIssue[];
  /** Popover içindeki başlık/liste için erişilebilir isim (örn. sayfa/yazı başlığı). */
  entityLabel: string;
}

/**
 * SEO tamlık skoru rozeti — tıklanınca kriter kırılımını gösteren bir Popover açar
 * (Tooltip değil: click-to-toggle semantiği ve klavye ile odaklanabilirlik için).
 */
export function SeoScoreBadge({ score, issues, entityLabel }: SeoScoreBadgeProps) {
  return (
    <Popover>
      <PopoverTrigger render={<button type="button" aria-label={`${entityLabel} SEO skoru: ${score}/100`} className="cursor-pointer" />}>
        <Badge tone={seoScoreTone(score)} size="lg" solid>{score}</Badge>
      </PopoverTrigger>
      <PopoverContent>
        <p className="text-sm font-medium text-foreground">SEO Tamlık Skoru: {score}/100</p>
        {issues.length === 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Tüm SEO kriterleri karşılanıyor
          </p>
        ) : (
          <ul className="space-y-1">
            {issues.map((issue) => (
              <li key={issue.code} className="flex items-start gap-1.5 text-sm text-foreground/80">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                {issue.label}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
