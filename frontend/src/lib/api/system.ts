import { apiFetch } from "./client";
import type { SystemHealthDto } from "./types";

export function getSystemHealth(): Promise<SystemHealthDto> {
  return apiFetch<SystemHealthDto>("/admin/health");
}
