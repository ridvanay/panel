import { apiFetchPage } from "./client";
import type { AuditLog, AuditStatus, Page } from "./types";

export function listAuditLogs(params: {
  cursor?: string;
  status?: AuditStatus;
  action?: string;
}): Promise<Page<AuditLog>> {
  return apiFetchPage<AuditLog>("/admin/logs", {
    query: { cursor: params.cursor, limit: 50, status: params.status, action: params.action },
  });
}
