"use client";

import { Badge } from "@/components/ui/badge";
import { requestStatusLabel, type CrmRequestStatus } from "@/lib/api/crm";

/** Paket AJ-4 - Danışma Talepleri ekranlarının ortak parçaları (durum rozeti). Admin paneli Türkçe. */
const STATUS_TONE: Record<CrmRequestStatus, "neutral" | "primary" | "success" | "danger" | "warning"> = {
  new: "primary",
  contacted: "neutral",
  planning: "warning",
  converted: "success",
  closed: "danger",
};

export function RequestStatusBadge({ status }: { status: CrmRequestStatus | null }) {
  if (!status) return <Badge tone="neutral">-</Badge>;
  return <Badge tone={STATUS_TONE[status]}>{requestStatusLabel(status)}</Badge>;
}
