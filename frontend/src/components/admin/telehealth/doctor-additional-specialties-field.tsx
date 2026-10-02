"use client";

import type { Specialty } from "@/lib/api/types";

/**
 * `docs/prompts/2026-10-02-wm-health-icerik-guncellemesi.md` madde 4 (`DoctorAdditionalSpecialty`)
 * — admin doktor formunda "Ek uzmanlıklar" çoklu seçimi. Birincil uzmanlık (`primarySpecialtyId`)
 * bu listede SEÇİLEMEZ (backend zaten `422` ile reddediyor, burada baştan engellenir). En fazla
 * `MAX_ADDITIONAL_SPECIALTIES` seçim — limite ulaşılınca kalan checkbox'lar devre dışı kalır.
 * Sunucu sözleşmesiyle AYNI "tam değiştirme" deseni: `onChange` her değişiklikte TÜM id listesini
 * geri verir (bkz. `DoctorSocialLinksEditor`).
 */

export const MAX_ADDITIONAL_SPECIALTIES = 5;

export function DoctorAdditionalSpecialtiesField({
  specialties,
  primarySpecialtyId,
  selectedIds,
  onChange,
}: {
  specialties: Specialty[];
  /** Formdaki o anki BİRİNCİL uzmanlık id'si (boş string = uzmanlıksız). */
  primarySpecialtyId: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const limitReached = selectedIds.length >= MAX_ADDITIONAL_SPECIALTIES;

  function toggle(specialtyId: string, checked: boolean) {
    if (checked) {
      if (limitReached) return;
      onChange([...selectedIds, specialtyId]);
    } else {
      onChange(selectedIds.filter((id) => id !== specialtyId));
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="block text-sm font-medium text-foreground">Ek uzmanlıklar</span>
        <span className="text-xs text-foreground/50">
          {selectedIds.length}/{MAX_ADDITIONAL_SPECIALTIES} seçildi
        </span>
      </div>
      <p className="text-xs text-foreground/60">
        Doktor profil sayfasında birincil uzmanlığın yanında rozet olarak gösterilir; uzmanlık sayfası/filtresinde de
        bu uzmanlıklarla eşleşir.
      </p>

      {specialties.length === 0 ? (
        <p className="text-xs text-foreground/50">Henüz tanımlı uzmanlık yok.</p>
      ) : (
        <div className="flex flex-wrap gap-3 rounded-lg border border-border p-3">
          {specialties.map((specialty) => {
            const isPrimary = !!primarySpecialtyId && specialty.id === primarySpecialtyId;
            const checked = selectedIds.includes(specialty.id);
            const disabled = isPrimary || (!checked && limitReached);
            return (
              <label
                key={specialty.id}
                className={`flex items-center gap-1.5 text-sm ${
                  disabled ? "text-foreground/40" : "text-foreground/80"
                }`}
                title={isPrimary ? "Birincil uzmanlık burada seçilemez" : undefined}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  aria-label={`${specialty.name} ek uzmanlık olarak seç`}
                  onChange={(e) => toggle(specialty.id, e.target.checked)}
                />
                {specialty.name}
                {isPrimary && <span className="text-xs text-foreground/40">(birincil)</span>}
              </label>
            );
          })}
        </div>
      )}

      {limitReached && <p className="text-xs text-warning">En fazla {MAX_ADDITIONAL_SPECIALTIES} uzmanlık seçebilirsiniz.</p>}
    </div>
  );
}
