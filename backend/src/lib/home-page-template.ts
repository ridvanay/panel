/**
 * "Anasayfa" şablonu — `home-page` blok tipinin sabitleri. `about-page` ile AYNI desen: şablon
 * ayrı bir `Page` kolonu DEĞİLDİR; sayfanın `blocks` dizisinde (ve `translations.<locale>.blocks`'ta)
 * TEK kök düğüm olarak duran bir `home-page` bloğudur. Herhangi bir slug'da olabilir; Ayarlar'daki
 * mevcut "Anasayfa" seçimiyle (`SiteSettings.homePageId`) anasayfa yapılır — şema değişikliği YOK.
 *
 * **Ayna (frontend):** `frontend/src/lib/home-page.ts` — sınırlar BİREBİR aynı olmak ZORUNDADIR.
 * İkon listesi Hakkımızda şablonuyla ortaktır (`ABOUT_ICON_KEYS`).
 */
export const HOME_PAGE_BLOCK_TYPE = "home-page";

export const HOME_MIN_TRUST_ITEMS = 1;
export const HOME_MAX_TRUST_ITEMS = 4;
export const HOME_MIN_STEPS = 2;
export const HOME_MAX_STEPS = 4;
export const HOME_MIN_DOCTORS = 1;
export const HOME_MAX_DOCTORS = 8;
export const HOME_DEFAULT_DOCTORS = 3;
export const HOME_SPECIALTY_COLUMNS = [3, 4, 6] as const;
export const HOME_DEFAULT_SPECIALTY_COLUMNS = 6;
