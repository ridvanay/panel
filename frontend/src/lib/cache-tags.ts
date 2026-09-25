/**
 * Sunucu tarafı veri fetch'lerinin önbellek etiketleri. Backend bir admin kaydından sonra
 * `POST /api/revalidate` ile `{ tags: [...] }` gönderir (bkz. `backend/src/lib/revalidate.ts`
 * `CACHE_TAGS` — iki liste BİREBİR aynı olmalı, `tests/unit/cache-tags.test.ts` kaymayı yakalar).
 * Etiket yenilenince yalnızca o veriyi kullanan sayfalar bir sonraki ziyarette yeniden üretilir;
 * `revalidate: 60` yedek olarak kalır.
 */
export const CACHE_TAGS = {
  settings: "settings",
  appearance: "appearance",
  navigation: "navigation",
  locales: "locales",
  modules: "modules",
  pages: "pages",
  specialties: "specialties",
  doctors: "doctors",
  contactPage: "contact-page",
  blog: "blog",
  telehealthTheme: "telehealth-theme",
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

/** Slider başına etiket — slider hem sayfa bloklarında hem blog/sayfa kısa kodlarında kullanılır. */
export function sliderCacheTag(sliderId: string): string {
  return `slider:${sliderId}`;
}

/** `/api/revalidate`'in kabul ettiği etiket biçimi (backend'den gelen girdi doğrulaması). */
export const CACHE_TAG_PATTERN = /^[a-z0-9:-]{1,100}$/;
