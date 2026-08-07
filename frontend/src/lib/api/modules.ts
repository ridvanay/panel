import { apiFetch } from "./client";
import type { PublicModule, SiteModule } from "./types";

/** `GET /admin/modules` — authenticated, tüm roller görebilir. */
export function listModules(): Promise<SiteModule[]> {
  return apiFetch<SiteModule[]>("/admin/modules");
}

/** `PATCH /admin/modules/:key` — yalnızca ADMIN (backend 403 döner, UI ayrıca disable eder). */
export function updateModule(key: string, enabled: boolean): Promise<SiteModule> {
  return apiFetch<SiteModule>(`/admin/modules/${key}`, { method: "PATCH", body: { enabled } });
}

/** `GET /modules` — public, auth gerektirmez (`apiFetch` token varsa ekler, yoksa sorun değil). */
export function listPublicModules(): Promise<PublicModule[]> {
  return apiFetch<PublicModule[]>("/modules");
}
