import type { LanguageSupportSettings, Locale, TelehealthThemeSettings } from "@/lib/api/types";

/**
 * Paket V — "Kendi dilinizde destek" bölümü (backend `modules/telehealth/lib/language-support.ts`).
 *
 * DOĞRULUK KURALI: yalnızca `supportLanguages` içindeki diller listelenir; liste boşsa `null` döner ve
 * bölüm (anasayfa bandı, profil/sihirbaz rozeti, footer satırı) HİÇ render edilmez. Tercüman cümlesi
 * yalnızca `interpreterIncluded=true` iken.
 */
export const DEFAULT_LANGUAGE_SUPPORT: LanguageSupportSettings = { supportLanguages: [], supportHours: {}, interpreterIncluded: false };

export interface SupportLanguage {
  code: string;
  /** Dilin kendi dilindeki adı (ör. "Deutsch", "العربية"). */
  nativeName: string;
}

export interface ResolvedLanguageSupport {
  languages: SupportLanguage[];
  /** Aktif dilin destek saatleri; yoksa EN; o da yoksa `null`. */
  hours: string | null;
  interpreterIncluded: boolean;
}

/** Site dil listesindeki `nativeLabel`, yoksa tarayıcı/Node `Intl.DisplayNames` ile dilin kendi adı. */
export function nativeLanguageName(code: string, locales: Pick<Locale, "code" | "nativeLabel">[] = []): string {
  const known = locales.find((l) => l.code === code)?.nativeLabel;
  if (known) return known;
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    if (name && name.toLowerCase() !== code) return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    // Geçersiz/tanınmayan kod — kodun kendisi gösterilir.
  }
  return code.toUpperCase();
}

export function resolveLanguageSupport(
  settings: Pick<TelehealthThemeSettings, "languageSupport"> | null | undefined,
  lang: string,
  locales: Pick<Locale, "code" | "nativeLabel">[] = []
): ResolvedLanguageSupport | null {
  const support = settings?.languageSupport ?? DEFAULT_LANGUAGE_SUPPORT;
  const codes = [...new Set((support.supportLanguages ?? []).filter((c) => typeof c === "string" && c.trim()))];
  if (codes.length === 0) return null;
  const hours = support.supportHours?.[lang]?.trim() || support.supportHours?.en?.trim() || null;
  return {
    languages: codes.map((code) => ({ code, nativeName: nativeLanguageName(code, locales) })),
    hours,
    interpreterIncluded: support.interpreterIncluded === true,
  };
}
