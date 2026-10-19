import type { PrismaClient, SiteRole } from "@prisma/client";
import { STAFF_TWO_FACTOR_ROLES } from "./staff-two-factor";

/**
 * Paket G (2026-10-19) — ACİL DURUM (break-glass) 2FA sıfırlaması. Yalnızca sunucuda shell/docker
 * erişimi olan operatörün `scripts/reset-user-2fa.ts` ile çalıştırması içindir; HTTP'den erişilemez.
 * Kullanım senaryosu: authenticator'ını ve yedek kodlarını kaybeden yönetici (UI'daki admin→admin
 * sıfırlama yasağı — security-review ORTA-2 — bilinçli olarak korunur).
 *
 * Güvenlik kuralları:
 *   - varsayılan KURU ÇALIŞMA: `confirmEmail` hedef e-postayla birebir aynı değilse hiçbir şey yazılmaz,
 *   - hedef yalnızca ADMIN/MANAGER (`allowNonStaff` olmadan diğer roller reddedilir),
 *   - etki: 2FA + secret + son adım + yedek kodlar silinir, tüm refresh token'lar iptal,
 *     `sessionsValidAfter` = şimdi (açık access token'lar da düşer),
 *   - audit: `actorId: null`, operatör adı + işletim sistemi kullanıcısı + hostname.
 * Şifreye dokunulmaz. Zorunlu 2FA açıksa yönetici bir sonraki girişte kurulum sayfasına yönlendirilir.
 */

export const BREAK_GLASS_AUDIT_ACTION = "security.2fa_break_glass_reset";

export class BreakGlassError extends Error {}

export interface BreakGlassInput {
  email: string;
  operator: string;
  /** Gerçek çalıştırma için hedef e-postanın AYNEN tekrar yazılması; yoksa kuru çalışma. */
  confirmEmail?: string;
  allowNonStaff?: boolean;
  osUser: string;
  hostname: string;
  now?: Date;
}

export interface BreakGlassResult {
  dryRun: boolean;
  user: { id: string; email: string; role: SiteRole; twoFactorEnabled: boolean; backupCodeCount: number; activeRefreshTokens: number };
}

export async function resetUserTwoFactorBreakGlass(prisma: PrismaClient, input: BreakGlassInput): Promise<BreakGlassResult> {
  const email = input.email.trim().toLowerCase();
  const operator = input.operator.trim();
  if (!email) throw new BreakGlassError("--email zorunlu.");
  if (operator.length < 3) throw new BreakGlassError("--operator zorunlu (en az 3 karakter; kim çalıştırıyor?).");

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, status: true, twoFactorEnabled: true },
  });
  if (!user || user.status === "DELETED") throw new BreakGlassError(`Kullanıcı bulunamadı: ${email}`);
  if (!STAFF_TWO_FACTOR_ROLES.includes(user.role) && !input.allowNonStaff) {
    throw new BreakGlassError(`Hedef rolü ${user.role}; bu araç yalnızca ADMIN/MANAGER içindir (diğerleri için panelden sıfırlayın).`);
  }

  const [backupCodeCount, activeRefreshTokens] = await Promise.all([
    prisma.backupCode.count({ where: { userId: user.id, usedAt: null } }),
    prisma.refreshToken.count({ where: { userId: user.id, revoked: false } }),
  ]);
  const summary = { id: user.id, email: user.email, role: user.role, twoFactorEnabled: user.twoFactorEnabled, backupCodeCount, activeRefreshTokens };

  const confirmed = input.confirmEmail !== undefined && input.confirmEmail.trim().toLowerCase() === email;
  if (!confirmed) return { dryRun: true, user: summary };

  const now = input.now ?? new Date();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorVerifiedAt: null,
        twoFactorLastUsedStep: null,
        sessionsValidAfter: now,
      },
    }),
    prisma.backupCode.deleteMany({ where: { userId: user.id } }),
    prisma.refreshToken.updateMany({ where: { userId: user.id, revoked: false }, data: { revoked: true } }),
    prisma.auditLog.create({
      data: {
        actorId: null,
        actorEmail: null,
        action: BREAK_GLASS_AUDIT_ACTION,
        targetType: "User",
        targetId: user.id,
        metadata: { email: user.email, role: user.role, operator, osUser: input.osUser, hostname: input.hostname, revokedSessionCount: activeRefreshTokens },
      },
    }),
  ]);
  return { dryRun: false, user: summary };
}

/** Salt okunur — zorunluluğu açmadan önce 2FA'sı kapalı personeli görmek için. */
export async function listStaffTwoFactorStatus(prisma: PrismaClient) {
  const [settings, staff] = await Promise.all([
    prisma.siteSettings.findUnique({ where: { id: "singleton" }, select: { staffTwoFactorRequiredAt: true } }),
    prisma.user.findMany({
      where: { role: { in: [...STAFF_TWO_FACTOR_ROLES] }, status: { not: "DELETED" } },
      select: { email: true, role: true, status: true, twoFactorEnabled: true, lastLoginAt: true },
      orderBy: [{ role: "asc" }, { email: "asc" }],
    }),
  ]);
  return { requiredAt: settings?.staffTwoFactorRequiredAt ?? null, staff };
}
