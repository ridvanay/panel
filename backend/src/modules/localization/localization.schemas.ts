import { z } from "zod";

/**
 * §10.5 Çoklu Dil & Yerelleştirme — `/admin/locales/{code}` path param. Format doğrulaması
 * BİLEREK BURADA YAPILMAZ (`LOCALE_CODE_PATTERN` regex'i) — bilinmeyen/hatalı bir `code`
 * route handler'da `404 NOT_FOUND` üretmeli, şema seviyesinde `422` DEĞİL (tutarlı hata
 * semantiği: "kaynak yok" ile "girdi bozuk" birbirine karışmamalı).
 */
export const LocaleCodeParamSchema = z.object({
  code: z.string().min(1),
});

/**
 * `POST /admin/locales` — `code` route handler'da normalize edilir (küçük harf, `_` → `-`,
 * bkz. lib/localization.ts::normalizeLocaleCode) ve `LOCALE_CODE_PATTERN`'e karşı doğrulanır.
 * `isDefault` BİLEREK YOKTUR — yeni eklenen bir dil asla doğrudan varsayılan OLAMAZ, bu yalnızca
 * `PATCH /admin/locales/{code}` ile (tek transaction'lı devir) yapılabilir.
 */
export const LocaleUpsertRequestSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  nativeLabel: z.string().min(1),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  hreflang: z.string().nullable().optional(),
});

/** `PATCH /admin/locales/{code}` — `code` KASITLI olarak yoktur (değiştirilemez). */
export const LocaleUpdateRequestSchema = z.object({
  label: z.string().min(1).optional(),
  nativeLabel: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  hreflang: z.string().nullable().optional(),
});
