import type { Prisma, PrismaClient, SiteRole } from "@prisma/client";
import { ConflictError } from "./errors";

/**
 * Paket G (2026-10-19) — ADMIN/MANAGER için zorunlu 2FA. Anahtar `SiteSettings.staffTwoFactorRequiredAt`:
 *   - `null` → KAPALI (varsayılan; deploy sonrası hiçbir şey değişmez),
 *   - gelecekte → bekleme süresi (personel uyarı şeridi görür, erişim kısıtlanmaz),
 *   - geçmişte → AKTİF: 2FA'sı kapalı ADMIN/MANAGER `requireSiteRole` kullanan `/admin/*` uçlarında
 *     403 `TWO_FACTOR_SETUP_REQUIRED` alır (bkz. middleware/site-rbac.ts). 2FA kurulum/oturum uçları
 *     (`/admin/settings/security/2fa`, `/sessions`), `/auth/*` ve `/users/*` bu kapıdan geçmez.
 *
 * Kilitlenme önlemleri: anahtarı yalnızca 2FA'sı etkin ADMIN açabilir (settings.routes.ts), en kısa
 * bekleme süresi 7 gün, anahtar doluyken son 2FA'lı aktif ADMIN'in 2FA'sı kapatılamaz / hesabı
 * pasifleştirilemez (`assertNotLastTwoFactorAdmin`). Acil durum: `scripts/reset-user-2fa.ts`.
 */

export const STAFF_TWO_FACTOR_ROLES: readonly SiteRole[] = ["ADMIN", "MANAGER"];
export const STAFF_TWO_FACTOR_MIN_GRACE_DAYS = 7;

type Db = Pick<PrismaClient, "siteSettings" | "user"> | Prisma.TransactionClient;

export async function getStaffTwoFactorRequiredAt(db: Db): Promise<Date | null> {
  const settings = await db.siteSettings.findUnique({ where: { id: "singleton" }, select: { staffTwoFactorRequiredAt: true } });
  return settings?.staffTwoFactorRequiredAt ?? null;
}

export function isStaffTwoFactorEnforced(requiredAt: Date | null, now: Date = new Date()): boolean {
  return requiredAt !== null && requiredAt.getTime() <= now.getTime();
}

export function isStaffRole(role: SiteRole): boolean {
  return STAFF_TWO_FACTOR_ROLES.includes(role);
}

/** `/auth/me` ve guard için tek karar noktası. */
export function requiresStaffTwoFactorSetup(
  user: { role: SiteRole; twoFactorEnabled: boolean },
  requiredAt: Date | null,
  now: Date = new Date()
): boolean {
  return isStaffRole(user.role) && !user.twoFactorEnabled && isStaffTwoFactorEnforced(requiredAt, now);
}

/**
 * Anahtar doluyken (bekleme süresi dahil) hedef, 2FA'sı etkin SON aktif ADMIN ise onun 2FA'sının
 * kapatılması, rolünün düşürülmesi, askıya alınması ya da silinmesi engellenir — aksi hâlde zorunluluk
 * devreye girdiğinde anahtarı yönetebilecek kimse kalmaz.
 */
export async function assertNotLastTwoFactorAdmin(db: Db, targetUserId: string): Promise<void> {
  const requiredAt = await getStaffTwoFactorRequiredAt(db);
  if (requiredAt === null) return;
  const target = await db.user.findUnique({ where: { id: targetUserId }, select: { role: true, status: true, twoFactorEnabled: true } });
  if (!target || target.role !== "ADMIN" || target.status !== "ACTIVE" || !target.twoFactorEnabled) return;
  const others = await db.user.count({
    where: { role: "ADMIN", status: "ACTIVE", twoFactorEnabled: true, id: { not: targetUserId } },
  });
  if (others === 0) {
    throw new ConflictError(
      "Personel için zorunlu 2FA açıkken iki adımlı doğrulaması etkin son yönetici bu işlemle devre dışı bırakılamaz. Önce başka bir yöneticinin 2FA kurmasını sağlayın ya da zorunluluğu kapatın."
    );
  }
}
