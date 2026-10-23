"use client";

import { useState } from "react";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { useTranslationLocales } from "@/components/admin/translation-locale-tabs";
import type { Media } from "@/lib/api/types";
import type { Slide, SlideLocaleMedia } from "@/lib/sliders/types";

/**
 * Paket O (2026-10-23) — "Dile özel görsel": görsele gömülü yazı (ör. "OUR HEALTH SERVICE…") dile göre
 * değişsin diye her dil için opsiyonel arka plan görseli. Seçim YALNIZCA medya kütüphanesinden
 * (`MediaSelectField`); dış URL alanı yoktur (backend de yalnızca kütüphane id'si kabul eder).
 * Dilin masaüstü görseli yoksa o dilde varsayılan görseller gösterilir; tablet/mobil boşsa dilin
 * masaüstü görseli kullanılır.
 */
export function SlideLocaleImages({ slide, onUpdate }: { slide: Slide; onUpdate: (patch: Partial<Slide>) => void }) {
  const locales = useTranslationLocales();
  const [selected, setSelected] = useState("");
  const translations = slide.translations ?? {};
  const locale = selected || locales[0]?.code || "";
  const entry = translations[locale];

  function updateEntry(patch: { bgMedia?: Media | null; bgTabletMedia?: Media | null; bgMobileMedia?: Media | null }) {
    const next = { ...translations };
    const merged = { bgMedia: entry?.bgMedia ?? null, bgTabletMedia: entry?.bgTabletMedia ?? null, bgMobileMedia: entry?.bgMobileMedia ?? null, ...patch };
    // Masaüstü görseli olmayan dil kaydı anlamsız (tablet/mobil onun yedeği) → kaldırılır.
    if (merged.bgMedia) next[locale] = merged as SlideLocaleMedia;
    else delete next[locale];
    onUpdate({ translations: next });
  }

  if (locales.length === 0) return null;
  const configured = Object.keys(translations);

  return (
    <div className="space-y-3 rounded-md border border-border p-3" data-testid="slide-locale-images">
      <div>
        <p className="text-sm font-medium text-foreground">Dile özel görsel</p>
        <p className="mt-1 text-xs text-foreground/50">
          Görselde yazı varsa her dil için ayrı görsel seçin. Seçilmeyen dillerde yukarıdaki görseller gösterilir. Yalnızca medya kütüphanesinden seçilebilir.
        </p>
        {configured.length > 0 && (
          <p className="mt-1 text-xs text-foreground/70">Tanımlı diller: {configured.map((code) => code.toUpperCase()).join(", ")}</p>
        )}
      </div>
      <Field id="slide-locale-image-lang" label="Dil">
        {(inputProps) => (
          <Select {...inputProps} value={locale} onChange={(e) => setSelected(e.target.value)}>
            {locales.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code.toUpperCase()} — {l.nativeLabel}
                {translations[l.code] ? " ✓" : ""}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <MediaSelectField
        id={`slide-locale-bgMedia-${locale}`}
        label={`Masaüstü görseli (${locale.toUpperCase()})`}
        value={entry?.bgMedia ?? null}
        onChange={(media) => updateEntry({ bgMedia: media })}
      />
      {entry && (
        <>
          <MediaSelectField
            id={`slide-locale-bgTabletMedia-${locale}`}
            label={`Tablet görseli (${locale.toUpperCase()})`}
            hint="Boş bırakılırsa bu dilin masaüstü görseli kullanılır."
            value={entry.bgTabletMedia}
            onChange={(media) => updateEntry({ bgTabletMedia: media })}
          />
          <MediaSelectField
            id={`slide-locale-bgMobileMedia-${locale}`}
            label={`Mobil görseli (${locale.toUpperCase()})`}
            hint="Boş bırakılırsa bu dilin tablet, o da yoksa masaüstü görseli kullanılır."
            value={entry.bgMobileMedia}
            onChange={(media) => updateEntry({ bgMobileMedia: media })}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => updateEntry({ bgMedia: null })}>
            {locale.toUpperCase()} görselini kaldır
          </Button>
        </>
      )}
    </div>
  );
}

/** `UpdateSlideRequest.translations` — Media nesnelerinden yalnızca kütüphane id'leri. */
export function toSlideTranslationsRequest(translations: Slide["translations"]) {
  return Object.fromEntries(
    Object.entries(translations ?? {}).map(([code, media]) => [
      code,
      { bgMediaId: media.bgMedia.id, bgTabletMediaId: media.bgTabletMedia?.id ?? null, bgMobileMediaId: media.bgMobileMedia?.id ?? null },
    ])
  );
}
