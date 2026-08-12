import type { NamespaceDictionary } from "./types";

/** `/admin/settings` → "Diller" sekmesi (Dil Yönetimi ekranı). */
export const localeManagerDictionary: NamespaceDictionary = {
  tr: {
    "localeManager.tabLabel": "Diller",
    "localeManager.title": "Diller",
    "localeManager.description": "Sitenizin desteklediği dilleri yönetin. Yeni dil eklemek deploy gerektirmez.",
    "localeManager.addLocale": "Dil Ekle",
    "localeManager.columnLanguage": "Dil",
    "localeManager.columnStatus": "Durum",
    "localeManager.columnDefault": "Varsayılan",
    "localeManager.columnTranslated": "Çevrilmiş içerik",
    "localeManager.columnActions": "İşlemler",
    "localeManager.statusEnabled": "Etkin",
    "localeManager.statusDisabled": "Devre dışı",
    "localeManager.badgeDefault": "Varsayılan",
    "localeManager.makeDefault": "Varsayılan yap",
    "localeManager.contentCount": "{count} içerik",
  },
  en: {
    "localeManager.tabLabel": "Languages",
    "localeManager.title": "Languages",
    "localeManager.description": "Manage the languages your site supports. Adding a new language does not require a deploy.",
    "localeManager.addLocale": "Add Language",
    "localeManager.columnLanguage": "Language",
    "localeManager.columnStatus": "Status",
    "localeManager.columnDefault": "Default",
    "localeManager.columnTranslated": "Translated content",
    "localeManager.columnActions": "Actions",
    "localeManager.statusEnabled": "Enabled",
    "localeManager.statusDisabled": "Disabled",
    "localeManager.badgeDefault": "Default",
    "localeManager.makeDefault": "Make default",
    "localeManager.contentCount": "{count} items",
  },
};
