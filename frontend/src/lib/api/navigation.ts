import { apiFetch } from "./client";
import type { NavigationConfigDto, UpdateNavigationConfigRequest } from "./types";

export function getNavigationConfig(): Promise<NavigationConfigDto> {
  return apiFetch<NavigationConfigDto>("/admin/navigation");
}

export function updateNavigationConfig(payload: UpdateNavigationConfigRequest): Promise<NavigationConfigDto> {
  return apiFetch<NavigationConfigDto>("/admin/navigation", { method: "PUT", body: payload });
}
