import { Badge } from "@/components/ui/badge";
import type { ImportJobStatus } from "@/lib/api/types";
import { IMPORT_JOB_STATUS_LABELS, IMPORT_JOB_STATUS_TONES } from "./import-labels";

export function ImportJobStatusBadge({ status }: { status: ImportJobStatus }) {
  return (
    <Badge tone={IMPORT_JOB_STATUS_TONES[status]} solid>
      {IMPORT_JOB_STATUS_LABELS[status]}
    </Badge>
  );
}
