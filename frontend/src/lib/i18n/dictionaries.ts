/**
 * Admin panel "chrome" (sidebar/topbar) dili — içerik çevirisiyle (ARCHITECTURE.md §10.5,
 * `translations.EN` alanı) KARIŞTIRILMAMALI. Bu sözlük yalnızca sabit arayüz metinlerini
 * kapsar, kasıtlı olarak dar tutulmuştur (bkz. görev kapsamı).
 */
export type AdminLocale = "tr" | "en";

export const dictionaries: Record<AdminLocale, Record<string, string>> = {
  tr: {
    "nav.overview": "Genel Bakış",
    "nav.pages": "Sayfalar",
    "nav.blog": "Blog",
    "nav.stats": "İstatistikler",
    "nav.media": "Medya",
    "nav.navigation": "Navigasyon",
    "nav.users": "Kullanıcılar",
    "nav.system": "Sistem Sağlığı",
    "nav.settings": "Ayarlar",
    "topbar.logout": "Çıkış yap",
    "topbar.language": "Dil",
  },
  en: {
    "nav.overview": "Overview",
    "nav.pages": "Pages",
    "nav.blog": "Blog",
    "nav.stats": "Statistics",
    "nav.media": "Media",
    "nav.navigation": "Navigation",
    "nav.users": "Users",
    "nav.system": "System Health",
    "nav.settings": "Settings",
    "topbar.logout": "Log out",
    "topbar.language": "Language",
  },
};
