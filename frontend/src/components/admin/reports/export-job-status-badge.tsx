import { Badge } from "@/components/ui/badge";
import type { ExportJobStatus } from "@/lib/api/types";
import { EXPORT_JOB_STATUS_LABELS, EXPORT_JOB_STATUS_TONES } from "./export-labels";

export function ExportJobStatusBadge({ status }: { status: ExportJobStatus }) {
  return (
    <Badge tone={EXPORT_JOB_STATUS_TONES[status]} solid>
      {EXPORT_JOB_STATUS_LABELS[status]}
    </Badge>
  );
}
