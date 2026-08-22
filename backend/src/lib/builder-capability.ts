import type { SiteRole } from "@prisma/client";

/**
 * §10.20 — TEK türetme yardımcısı (bkz. `.claude/architect-scope-page-editor-roles.md` §1.5).
 * "Gelişmiş Düzenleyici" (advanced page builder) yeteneği ROLDEN BAĞIMSIZ, kullanıcı başına
 * verilen bir bayraktır (`User.advancedBuilderEnabled`). Etkin yetenek ise BU fonksiyonla
 * türetilir ve HİÇBİR route bu ifadeyi kendi başına KOPYALAMAZ (i18n işindeki `applyLocale`
 * kopyalanması hatasının tekrarı önlenir).
 *
 * ADMIN için depolanan değere BAKILMAKSIZIN her zaman `true` döner — kilitlenme güvenliği
 * (bir yöneticinin kendi/tüm hesapların yeteneğini kapatıp geri dönüş yolu bırakmaması riski,
 * bkz. §1.5). Bu fonksiyon SAF/senkrondur, DB'ye erişmez.
 */
export function canUseAdvancedBuilder(user: { role: SiteRole; advancedBuilderEnabled: boolean }): boolean {
  return user.role === "ADMIN" || user.advancedBuilderEnabled === true;
}
