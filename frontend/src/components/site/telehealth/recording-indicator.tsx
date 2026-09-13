import { Badge } from "@/components/ui/badge";
import type { RecordingStatus } from "@/lib/api/types";

/**
 * `.claude/architect-scope-telehealth-recording.md` F2 — `status === "RECORDING"` olduğu SÜRECE
 * sürekli görünen rozet (kaybolan toast DEĞİL). `payment-status-badge.tsx` (§12.4) desenindeki
 * gibi mevcut `Badge` primitive'inin `tone="danger" solid` varyantı — yeni bir renk/font tokeni
 * İCAT EDİLMEZ.
 */
export function RecordingIndicator({ status }: { status: RecordingStatus | undefined }) {
  if (status !== "RECORDING") return null;

  return (
    <span role="status">
      <Badge tone="danger" solid size="sm" className="gap-1.5 shadow-sm">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
        Bu görüşme kaydediliyor
      </Badge>
    </span>
  );
}
