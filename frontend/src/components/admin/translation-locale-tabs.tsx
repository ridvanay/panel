"use client";

import { useEffect, useState } from "react";
import * as localesApi from "@/lib/api/locales";
import type { Locale, TextTranslations } from "@/lib/api/types";
import { LocaleTabs, type LocaleStatus } from "@/components/admin/locale-tabs";

/**
 * Paket O (2026-10-23) — menü, footer ve uzmanlık formlarının dil sekmeleri. Sayfa düzenleyicisindeki
 * `LocaleTabs` deseni kullanılır; FARK: bu modellerde kanonik metin İngilizcedir (EN sekmesi = kanonik
 * kolon), diğer TÜM diller — varsayılan dil TR dahil — `translations.<dil>` altında tutulur. Boş
 * bırakılan alan sitede EN metne düşer.
 */
export const CANONICAL_LOCALE_CODE = "en";

const FALLBACK_CANONICAL: Locale = {
  code: CANONICAL_LOCALE_CODE,
  label: "İngilizce",
  nativeLabel: "English",
  isDefault: true,
  enabled: true,
  sortOrder: -1,
  hreflang: null,
};

/** EN (kanonik) önce, ardından diğer diller (`sortOrder`); kapalı diller de çevrilebilir. */
export function orderTranslationLocales(locales: Locale[]): Locale[] {
  const canonical = locales.find((l) => l.code === CANONICAL_LOCALE_CODE) ?? FALLBACK_CANONICAL;
  const others = locales.filter((l) => l.code !== CANONICAL_LOCALE_CODE).sort((a, b) => a.sortOrder - b.sortOrder);
  // `isDefault` LocaleTabs'te yalnızca "kaynak sekme — durum ikonu yok" anlamında kullanılır.
  return [{ ...canonical, isDefault: true }, ...others.map((l) => ({ ...l, isDefault: false }))];
}

export function useTranslationLocales(): Locale[] {
  const [locales, setLocales] = useState<Locale[]>([]);
  useEffect(() => {
    let cancelled = false;
    localesApi
      .listAdminLocales()
      .then((data) => {
        if (!cancelled) setLocales(orderTranslationLocales(data));
      })
      .catch(() => {
        if (!cancelled) setLocales([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return locales;
}

export function isCanonicalLocale(code: string): boolean {
  return code === CANONICAL_LOCALE_CODE;
}

export function getTranslation(translations: TextTranslations | undefined, locale: string, field: string): string {
  return translations?.[locale]?.[field] ?? "";
}

/** Değişmez güncelleme; boş metin alanı ve boş dil kaydı silinir (boş = EN'e düş). */
export function setTranslation(translations: TextTranslations | undefined, locale: string, field: string, value: string): TextTranslations {
  const next: TextTranslations = { ...(translations ?? {}) };
  const entry = { ...(next[locale] ?? {}) };
  if (value.trim()) entry[field] = value;
  else delete entry[field];
  if (Object.keys(entry).length) next[locale] = entry;
  else delete next[locale];
  return next;
}

/** Sekme ikonu: tüm alanlar dolu → çevrildi; bazıları → kısmen; hiçbiri → çevrilmedi (EN gösterilir). */
export interface TranslationEntry {
  translations?: TextTranslations;
  fields: string[];
}

export function translationStatus(entries: TranslationEntry[], locale: string): LocaleStatus {
  let filled = 0;
  let total = 0;
  for (const { translations, fields } of entries) {
    for (const field of fields) {
      total++;
      if (getTranslation(translations, locale, field).trim()) filled++;
    }
  }
  if (total === 0 || filled === 0) return "untranslated";
  return filled === total ? "translated" : "partial";
}

export function TranslationLocaleTabs({
  locales,
  value,
  onValueChange,
  entries,
}: {
  locales: Locale[];
  value: string;
  onValueChange: (code: string) => void;
  /** Durum ikonu için bu sekmenin kapsadığı kayıtlar ve çevrilecek alanları. */
  entries: TranslationEntry[];
}) {
  if (locales.length <= 1) return null;
  return (
    <div className="space-y-1.5" data-testid="translation-locale-tabs">
      <LocaleTabs locales={locales} value={value} onValueChange={onValueChange} statusFor={(code) => translationStatus(entries, code)} />
      <p className="text-xs text-foreground/60">
        {isCanonicalLocale(value)
          ? "EN kanonik metindir. Diğer dillerde boş bırakılan alan sitede EN metinle gösterilir."
          : "Bu dildeki metin. Boş bırakırsanız sitede EN metin gösterilir."}
      </p>
    </div>
  );
}
