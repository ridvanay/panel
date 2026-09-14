import { TELEHEALTH_THEME_DEFAULTS, TelehealthThemeSettings, TelehealthThemeSettingsSchema } from "../../../schemas/entities";

/**
 * `SiteModule.settings` bir `Json` alanıdır (tip güvenliği YOK — DB'de bozuk/eski/şekli
 * uyuşmayan bir JSON varsa `TelehealthThemeSettingsSchema.safeParse` BAŞARISIZ olabilir).
 * Bu yardımcı HER ZAMAN geçerli bir `TelehealthThemeSettings` döner: doğrulanamayan/eksik
 * alanlar SESSİZCE varsayılana düşer, hiçbir çağıran uç bu yüzden 500 VERMEZ (admin `GET`/`PATCH`
 * VE public `GET /telehealth/theme` — üçü de bu tek fonksiyonu kullanır).
 */
export function parseTelehealthTheme(raw: unknown): TelehealthThemeSettings {
  const parsed = TelehealthThemeSettingsSchema.partial().safeParse(raw);
  const stored = parsed.success ? parsed.data : {};
  return { ...TELEHEALTH_THEME_DEFAULTS, ...stored };
}
