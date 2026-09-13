"use client";

import { Plus, Trash2 } from "lucide-react";
import type { DoctorCvEntry, DoctorCvEntryKind } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §1.3/§1.4 —
 * `DoctorProfile.cvEntries` tekrarlayıcı form alanları. `admin/telehealth/weekly-availability-
 * editor.tsx` İLE AYNI "kontrollü liste + `onChange(list)`" deseni (YENİ bir liste-yönetim
 * kütüphanesi İCAT EDİLMEZ). Sunucu bu diziyi TAMAMEN değiştirir (kısmi birleştirme YOK) — bu
 * yüzden `onChange` her değişiklikte TÜM diziyi geri verir.
 */

const KIND_OPTIONS: { value: DoctorCvEntryKind; label: string }[] = [
  { value: "EDUCATION", label: "Eğitim" },
  { value: "EXPERIENCE", label: "Deneyim" },
  { value: "CERTIFICATE", label: "Sertifika" },
  { value: "MEMBERSHIP", label: "Üyelik" },
  { value: "AWARD", label: "Ödül" },
];

const MAX_CV_ENTRIES = 60;

const EMPTY_ENTRY: DoctorCvEntry = {
  kind: "EDUCATION",
  title: "",
  organization: "",
  location: "",
  startYear: new Date().getUTCFullYear(),
  endYear: null,
  description: "",
};

export function DoctorCvEntriesEditor({ entries, onChange }: { entries: DoctorCvEntry[]; onChange: (entries: DoctorCvEntry[]) => void }) {
  function addEntry() {
    if (entries.length >= MAX_CV_ENTRIES) return;
    onChange([...entries, { ...EMPTY_ENTRY }]);
  }

  function removeEntry(index: number) {
    onChange(entries.filter((_, i) => i !== index));
  }

  function updateEntry(index: number, patch: Partial<DoctorCvEntry>) {
    onChange(entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  }

  return (
    <div className="space-y-3">
      {entries.length === 0 && <p className="text-xs text-foreground/50">Henüz özgeçmiş öğesi eklenmedi.</p>}

      {entries.map((entry, index) => (
        <div key={index} className="space-y-3 rounded-[var(--site-radius)] border border-border p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium text-foreground/70">
                Tür
                <Select value={entry.kind} onChange={(e) => updateEntry(index, { kind: e.target.value as DoctorCvEntryKind })}>
                  {KIND_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="space-y-1 text-xs font-medium text-foreground/70">
                Başlık
                <Input value={entry.title} maxLength={160} onChange={(e) => updateEntry(index, { title: e.target.value })} />
              </label>
              <label className="space-y-1 text-xs font-medium text-foreground/70">
                Kurum
                <Input value={entry.organization} maxLength={160} onChange={(e) => updateEntry(index, { organization: e.target.value })} />
              </label>
              <label className="space-y-1 text-xs font-medium text-foreground/70">
                Konum (opsiyonel)
                <Input
                  value={entry.location ?? ""}
                  maxLength={120}
                  onChange={(e) => updateEntry(index, { location: e.target.value || null })}
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-foreground/70">
                Başlangıç Yılı
                <Input
                  type="number"
                  min={1950}
                  value={entry.startYear}
                  onChange={(e) => updateEntry(index, { startYear: Number(e.target.value) })}
                />
              </label>
              <div className="space-y-1 text-xs font-medium text-foreground/70">
                Bitiş Yılı
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1950}
                    disabled={entry.endYear === null}
                    value={entry.endYear ?? ""}
                    onChange={(e) => updateEntry(index, { endYear: e.target.value ? Number(e.target.value) : null })}
                  />
                  <label className="flex shrink-0 items-center gap-1 text-xs font-normal text-foreground/60">
                    <input
                      type="checkbox"
                      checked={entry.endYear === null}
                      onChange={(e) => updateEntry(index, { endYear: e.target.checked ? null : new Date().getUTCFullYear() })}
                    />
                    Devam ediyor
                  </label>
                </div>
              </div>
              <label className="space-y-1 text-xs font-medium text-foreground/70 sm:col-span-2">
                Açıklama (opsiyonel, düz metin)
                <Textarea
                  value={entry.description ?? ""}
                  maxLength={500}
                  rows={2}
                  onChange={(e) => updateEntry(index, { description: e.target.value || null })}
                />
              </label>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Özgeçmiş öğesini kaldır" onClick={() => removeEntry(index)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={entries.length >= MAX_CV_ENTRIES} onClick={addEntry}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Özgeçmiş Öğesi Ekle
      </Button>
    </div>
  );
}
