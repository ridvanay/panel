import type { SiteRole } from "@prisma/client";

/**
 * `.claude/architect-scope-rbac-5-tier.md` §5.4 — merkezi rol listesi sabitleri.
 * §5.3 tablosundaki her satır BUNLARI kullanır; serbest dizi yazımı yalnızca dokümanda
 * "istisna" olarak işaretlenmiş satırlarda kabul edilir (örn. `POST /admin/pages` →
 * yalnızca `ROLES_ADMIN`, §6.1; Katman 2 sayfa uçları → `ROLES_ADMIN_MANAGER`, §6.2).
 */
export const ROLES_ADMIN = ["ADMIN"] as const satisfies readonly SiteRole[]; // (a)(b)(c)(d)(f)
export const ROLES_ADMIN_MANAGER = ["ADMIN", "MANAGER"] as const satisfies readonly SiteRole[]; // panel operasyonu
export const ROLES_PANEL = ["ADMIN", "MANAGER", "EDITOR"] as const satisfies readonly SiteRole[]; // içerik + panel kapısı
