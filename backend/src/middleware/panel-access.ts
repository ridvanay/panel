import { requireSiteRole } from "./site-rbac";
import { ROLES_PANEL } from "../lib/site-roles";

/**
 * `.claude/architect-scope-rbac-5-tier.md` §4.2 — `/admin/*` kapısının TABAN ÇİZGİSİ.
 * `requireSiteRole(...ROLES_PANEL)` ile eşdeğerdir (ADMIN|MANAGER|EDITOR); CUSTOMER/USER
 * her `/admin/*` ucunda 403 alır. Her `/admin/*` prefix'iyle kayıtlı plugin kendi scope'unda
 * `app.addHook("preHandler", requirePanelAccess())` çağırır — İSTİSNA (yalnızca 2 tane, §4.3):
 * `/admin/settings/security/2fa` ve `/admin/settings/security/sessions` (self-servis, 5 rolün
 * hepsi `authenticated` ile erişir, bu guard EKLENMEZ).
 *
 * Uç-bazlı `requireSiteRole(...)` guard'ları BUNUN YERİNE GEÇMEZ (derinlemesine savunma) —
 * panel kapısı yalnızca taban çizgisidir, §5.3 tablosundaki daha dar roller ayrıca uygulanır.
 */
export function requirePanelAccess() {
  return requireSiteRole(...ROLES_PANEL);
}
