"use client";

import { useMemo, useState } from "react";
import type { DoctorProfile, Specialty } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Paket Q — çoklu doktor seçimi: arama, uzmanlığa göre filtre (birincil ya da ek uzmanlık),
 * "Tümünü seç" yalnızca filtrelenmiş görünür doktorları seçer.
 */
export function BulkDoctorPicker({
  doctors,
  specialties,
  selected,
  onChange,
  idPrefix,
}: {
  doctors: DoctorProfile[];
  specialties: Specialty[];
  selected: string[];
  onChange: (ids: string[]) => void;
  idPrefix: string;
}) {
  const [search, setSearch] = useState("");
  const [specialtyId, setSpecialtyId] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR");
    return doctors.filter((d) => {
      if (q && !`${d.title} ${d.fullName} ${d.slug}`.toLocaleLowerCase("tr-TR").includes(q)) return false;
      if (specialtyId && d.specialtyId !== specialtyId && !(d.additionalSpecialties ?? []).some((s) => s.id === specialtyId)) return false;
      return true;
    });
  }, [doctors, search, specialtyId]);

  const selectedSet = new Set(selected);
  const toggle = (id: string) => onChange(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const selectAllVisible = () => onChange([...new Set([...selected, ...visible.map((d) => d.id)])]);

  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-3" data-testid={`${idPrefix}-doctor-picker`}>
      <legend className="px-1 text-sm font-medium">Doktorlar ({selected.length} seçili)</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input aria-label="Doktor ara" placeholder="Doktor ara…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select
          aria-label="Uzmanlığa göre filtrele"
          value={specialtyId}
          onChange={(e) => setSpecialtyId(e.target.value)}
          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
        >
          <option value="">Tüm uzmanlıklar</option>
          {specialties.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={selectAllVisible} disabled={visible.length === 0}>
          Tümünü seç ({visible.length})
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])} disabled={selected.length === 0}>
          Seçimi temizle
        </Button>
      </div>
      <ul className="max-h-64 space-y-1 overflow-y-auto pe-1">
        {visible.map((d) => (
          <li key={d.id}>
            <label className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-foreground/5">
              <input type="checkbox" checked={selectedSet.has(d.id)} onChange={() => toggle(d.id)} />
              <span className="flex-1">
                {d.title} {d.fullName}
              </span>
              {d.specialty && <span className="text-xs text-foreground/50">{d.specialty.name}</span>}
            </label>
          </li>
        ))}
        {visible.length === 0 && <li className="text-sm text-foreground/50">Eşleşen doktor yok.</li>}
      </ul>
    </fieldset>
  );
}
