/**
 * Admin panel "chrome" dili — namespace başına ayrılmış sözlük dosyaları burada birleştirilir
 * (bkz. `.claude/architect-scope-i18n.md` §7.3: "tek dictionaries.ts yerine namespace başına
 * dosya"). Yeni bir namespace eklemek için: `./<namespace>.ts` dosyası oluştur, aşağıya import
 * edip merge et — mevcut tüketiciler (`useT()`) DEĞİŞMEDEN yeni anahtarları görür.
 */
import type { AdminLocale, Dictionary } from "./types";
import { navDictionary } from "./nav";
import { commonDictionary } from "./common";
import { topbarDictionary } from "./topbar";
import { breadcrumbDictionary } from "./breadcrumb";
import { commandPaletteDictionary } from "./command-palette";
import { shortcutsDictionary } from "./shortcuts";
import { localeManagerDictionary } from "./locale-manager";

export type { AdminLocale, Dictionary };

const namespaces = [
  navDictionary,
  commonDictionary,
  topbarDictionary,
  breadcrumbDictionary,
  commandPaletteDictionary,
  shortcutsDictionary,
  localeManagerDictionary,
];

function mergeLocale(locale: AdminLocale): Dictionary {
  return namespaces.reduce<Dictionary>((acc, ns) => ({ ...acc, ...ns[locale] }), {});
}

export const dictionaries: Record<AdminLocale, Dictionary> = {
  tr: mergeLocale("tr"),
  en: mergeLocale("en"),
};
