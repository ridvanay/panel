import type { SiteRole } from "@/lib/api/types";

/**
 * Paket G — personel (ADMIN/MANAGER) için zorunlu 2FA'nın istemci tarafı kararı. Sunucu
 * (`/auth/me.twoFactorSetupRequired`, `/admin/*` 403 `TWO_FACTOR_SETUP_REQUIRED`) asıl otoritedir;
 * bu fonksiyon panel kabuğunun yönlendirme/uyarı şeridi için aynı kuralı `now` ile yeniden hesaplar
 * (oturum açıkken tarih geçerse de devreye girsin diye).
 *   - "none": personel değil, 2FA'sı açık ya da zorunluluk kapalı,
 *   - "grace": zorunluluk tarihi ileride — uyarı şeridi,
 *   - "required": tarih geçti — yalnızca 2FA kurulum sayfası açılır.
 */
export type StaffTwoFactorState = "none" | "grace" | "required";

export const STAFF_TWO_FACTOR_SETUP_PATH = "/admin/settings/security";

export function getStaffTwoFactorState(
  user: { role: SiteRole; twoFactorEnabled?: boolean } | null,
  requiredAt: string | null,
  now: number
): StaffTwoFactorState {
  if (!user || (user.role !== "ADMIN" && user.role !== "MANAGER") || user.twoFactorEnabled === true || !requiredAt) return "none";
  return new Date(requiredAt).getTime() <= now ? "required" : "grace";
}
