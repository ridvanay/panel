import type { SiteRole } from "@prisma/client";

/**
 * `.claude/architect-scope-rbac-5-tier.md` §3 — TEK türetme noktası (revize edildi; eski
 * `advancedBuilderEnabled` bayrağı KALDIRILDI, bkz. §3.1/§3.2). "Gelişmiş Düzenleyici"
 * (advanced page builder) yeteneği artık SAF bir rol türevidir: yalnızca `ADMIN` `true` alır.
 * Bu fonksiyon SAF/senkrondur, DB'ye erişmez; HİÇBİR route bu ifadeyi kendi başına KOPYALAMAZ.
 */
export function canUseAdvancedBuilder(user: { role: SiteRole }): boolean {
  return user.role === "ADMIN";
}
